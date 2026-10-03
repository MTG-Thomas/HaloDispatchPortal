import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    loadTokens,
    saveTokens,
    clearTokens,
    clearProcessedCodes,
    isTokenExpiringSoon,
    isAuthenticated,
    getTokenExpiresAt,
    ensureFreshToken,
    startAuth,
    handleCallback,
    refreshToken,
    TOKEN_EXPIRY_SKEW_MS,
} from "../authService";
import { savePkceRequest, loadPkceRequest } from "../pkce";
import type { HaloTokens, AuthConfig } from "../types";

const CONFIG: AuthConfig = {
    authServer: "https://tenant.halopsa.com/auth",
    clientId: "test-client",
    redirectUri: "http://localhost:5173/auth/callback",
};

function tokens(overrides: Partial<HaloTokens> = {}): HaloTokens {
    return {
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "all:standard offline_access",
        ...overrides,
    };
}

describe("authService token expiry", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
        clearTokens();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("stamps obtained_at on save", () => {
        saveTokens(tokens());
        expect(loadTokens()?.obtained_at).toBe(Date.now());
    });

    it("treats a fresh token as authenticated", () => {
        saveTokens(tokens());
        expect(isTokenExpiringSoon()).toBe(false);
        expect(isAuthenticated()).toBe(true);
    });

    it("treats tokens inside the skew window as expiring", () => {
        // 29s of life left: inside the 30s skew window.
        saveTokens(tokens());
        const stored = loadTokens()!;
        stored.obtained_at = Date.now() - (3600 - 29) * 1000;
        localStorage.setItem("halo-dispatch-tokens", JSON.stringify(stored));
        expect(isTokenExpiringSoon()).toBe(true);
        expect(isAuthenticated()).toBe(false);
    });

    it("treats tokens just outside the skew window as fresh", () => {
        saveTokens(tokens());
        const stored = loadTokens()!;
        stored.obtained_at = Date.now() - (3600 - 31) * 1000;
        localStorage.setItem("halo-dispatch-tokens", JSON.stringify(stored));
        expect(isTokenExpiringSoon()).toBe(false);
    });

    it("treats expired tokens as expiring", () => {
        saveTokens(tokens());
        const stored = loadTokens()!;
        stored.obtained_at = Date.now() - 3700 * 1000;
        localStorage.setItem("halo-dispatch-tokens", JSON.stringify(stored));
        expect(isTokenExpiringSoon()).toBe(true);
    });

    it("treats legacy tokens without obtained_at as expired", () => {
        localStorage.setItem(
            "halo-dispatch-tokens",
            JSON.stringify(tokens({ obtained_at: undefined })),
        );
        expect(getTokenExpiresAt(loadTokens()!)).toBeNull();
        expect(isTokenExpiringSoon()).toBe(true);
    });

    it("treats invalid expires_in as expired", () => {
        saveTokens(tokens({ expires_in: 0 }));
        expect(isTokenExpiringSoon()).toBe(true);
    });

    it("treats missing tokens as expired", () => {
        expect(isTokenExpiringSoon(null)).toBe(true);
        expect(isTokenExpiringSoon()).toBe(true);
        expect(isAuthenticated()).toBe(false);
    });

    it("exposes a 30s skew constant", () => {
        expect(TOKEN_EXPIRY_SKEW_MS).toBe(30_000);
    });
});

describe("authService OAuth flow", () => {
    beforeEach(() => {
        clearTokens();
        clearProcessedCodes();
        sessionStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("startAuth rejects missing configuration", async () => {
        await expect(startAuth({ authServer: "", clientId: "", redirectUri: "" })).rejects.toThrow(
            "Missing required configuration",
        );
    });

    it("startAuth rejects a non-https auth server", async () => {
        await expect(
            startAuth({ ...CONFIG, authServer: "http://evil.example.com" }),
        ).rejects.toThrow("Invalid auth server URL");
    });

    it("startAuth stores PKCE material before redirect", async () => {
        // jsdom cannot navigate; the redirect is a no-op there.
        await startAuth(CONFIG);
        const pkce = loadPkceRequest();
        expect(pkce?.state).toBeTruthy();
        expect(pkce?.verifier).toHaveLength(64);
    });

    it("handleCallback rejects state mismatch without exchanging", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        savePkceRequest({ state: "expected", verifier: "v".repeat(64) });

        const result = await handleCallback(CONFIG, "code-1", "wrong-state");

        expect(result).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(loadTokens()).toBeNull();
        // Single-use material is cleared even on rejection.
        expect(loadPkceRequest()).toBeNull();
    });

    it("handleCallback rejects a missing state without exchanging", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        expect(await handleCallback(CONFIG, "code-1", null)).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("handleCallback exchanges code with PKCE verifier on state match", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => tokens(),
        });
        vi.stubGlobal("fetch", fetchMock);
        savePkceRequest({ state: "s1", verifier: "v".repeat(64) });

        const result = await handleCallback(CONFIG, "code-2", "s1");

        expect(result).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`${CONFIG.authServer}/token`);
        const body = init.body as URLSearchParams;
        expect(body.get("grant_type")).toBe("authorization_code");
        expect(body.get("code")).toBe("code-2");
        expect(body.get("code_verifier")).toBe("v".repeat(64));
        expect(loadTokens()?.access_token).toBe("access");
        expect(loadPkceRequest()).toBeNull();
    });

    it("handleCallback processes each authorization code once", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => tokens(),
        });
        vi.stubGlobal("fetch", fetchMock);

        savePkceRequest({ state: "s1", verifier: "v".repeat(64) });
        expect(await handleCallback(CONFIG, "code-3", "s1")).toBe(true);

        savePkceRequest({ state: "s1", verifier: "v".repeat(64) });
        expect(await handleCallback(CONFIG, "code-3", "s1")).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("handleCallback returns false when the token endpoint rejects", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: false,
            status: 400,
            statusText: "Bad Request",
        });
        vi.stubGlobal("fetch", fetchMock);
        savePkceRequest({ state: "s1", verifier: "v".repeat(64) });

        expect(await handleCallback(CONFIG, "code-4", "s1")).toBe(false);
        expect(loadTokens()).toBeNull();
    });

    it("refreshToken keeps the old refresh token when the response omits it", async () => {
        saveTokens(tokens({ refresh_token: "old-refresh" }));
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => tokens({ access_token: "new-access", refresh_token: "" }),
        });
        vi.stubGlobal("fetch", fetchMock);

        expect(await refreshToken(CONFIG)).toBe(true);
        const stored = loadTokens()!;
        expect(stored.access_token).toBe("new-access");
        expect(stored.refresh_token).toBe("old-refresh");
        expect(typeof stored.obtained_at).toBe("number");
    });

    it("refreshToken clears tokens on invalid_grant", async () => {
        saveTokens(tokens());
        const fetchMock = vi.fn().mockResolvedValue({
            ok: false,
            status: 400,
            statusText: "Bad Request",
            json: async () => ({ error: "invalid_grant" }),
        });
        vi.stubGlobal("fetch", fetchMock);

        expect(await refreshToken(CONFIG)).toBe(false);
        expect(loadTokens()).toBeNull();
    });

    it("refreshToken keeps tokens on a 400 without invalid_grant", async () => {
        saveTokens(tokens());
        const fetchMock = vi.fn().mockResolvedValue({
            ok: false,
            status: 400,
            statusText: "Bad Request",
            json: async () => ({ error: "invalid_request" }),
        });
        vi.stubGlobal("fetch", fetchMock);

        expect(await refreshToken(CONFIG)).toBe(false);
        expect(loadTokens()?.access_token).toBe("access");
    });

    it("refreshToken keeps tokens when the error body is unreadable", async () => {
        saveTokens(tokens());
        const fetchMock = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
            json: async () => {
                throw new Error("no json");
            },
        });
        vi.stubGlobal("fetch", fetchMock);

        expect(await refreshToken(CONFIG)).toBe(false);
        expect(loadTokens()?.access_token).toBe("access");
    });

    it("refreshToken keeps tokens on network failure for later retry", async () => {
        saveTokens(tokens());
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

        expect(await refreshToken(CONFIG)).toBe(false);
        expect(loadTokens()?.access_token).toBe("access");
    });

    it("ensureFreshToken skips refresh for fresh tokens", async () => {
        saveTokens(tokens());
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        expect(await ensureFreshToken(CONFIG)).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
