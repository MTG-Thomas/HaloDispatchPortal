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
    loadDispatcherSession,
    saveDispatcherSession,
    hasDispatcherSession,
    restoreDispatcherSession,
    logout,
    SESSION_STORAGE_KEY,
    TOKEN_EXPIRY_SKEW_MS,
} from "../authService";
import { savePkceRequest, loadPkceRequest } from "../pkce";
import type { HaloTokens, AuthConfig } from "../types";

const CONFIG: AuthConfig = {
    authServer: "https://tenant.halopsa.com/auth",
    clientId: "test-client",
    redirectUri: "http://localhost:5173/auth/callback",
};

const SESSION_REF = { sessionId: "sess-1", expiresAt: "2026-11-02T00:00:00.000Z" };

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

interface MockResponse {
    ok: boolean;
    status: number;
    statusText: string;
    json: () => Promise<unknown>;
}

function jsonResponse(body: unknown, status = 200): MockResponse {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? "OK" : "Error",
        json: async () => body,
    };
}

/**
 * Route-aware fetch stub: Halo token calls answer from `halo`, BFF session
 * calls from `vault`. Every BFF URL hit is recorded in `vaultCalls`.
 */
function mockRoutedFetch(
    options: {
        halo?: MockResponse | ((init?: RequestInit) => MockResponse);
        vault?: MockResponse | ((url: string, init?: RequestInit) => MockResponse);
        vaultCalls?: string[];
    } = {},
) {
    const vaultCalls = options.vaultCalls ?? [];
    const impl = vi.fn(async (url: unknown, init?: RequestInit) => {
        const target = String(url);
        if (target === `${CONFIG.authServer}/token`) {
            return typeof options.halo === "function"
                ? (options.halo as (init?: RequestInit) => MockResponse)(init)
                : (options.halo ?? jsonResponse(tokens()));
        }
        vaultCalls.push(`${init?.method ?? "GET"} ${target}`);
        return typeof options.vault === "function"
            ? options.vault(target, init)
            : (options.vault ?? jsonResponse(SESSION_REF, 201));
    });
    vi.stubGlobal("fetch", impl);
    return { impl, vaultCalls };
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
        loadTokens()!.obtained_at = Date.now() - (3600 - 29) * 1000;
        expect(isTokenExpiringSoon()).toBe(true);
        expect(isAuthenticated()).toBe(false);
    });

    it("treats tokens just outside the skew window as fresh", () => {
        saveTokens(tokens());
        loadTokens()!.obtained_at = Date.now() - (3600 - 31) * 1000;
        expect(isTokenExpiringSoon()).toBe(false);
    });

    it("treats expired tokens as expiring", () => {
        saveTokens(tokens());
        loadTokens()!.obtained_at = Date.now() - 3700 * 1000;
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

describe("authService vault persistence", () => {
    beforeEach(() => {
        clearTokens();
    });

    it("never writes tokens to storage", () => {
        saveTokens(tokens());
        saveDispatcherSession(SESSION_REF);
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i) as string;
            const value = localStorage.getItem(key) as string;
            expect(value).not.toContain("access");
            expect(value).not.toContain("refresh");
        }
        expect(localStorage.getItem("halo-dispatch-tokens")).toBeNull();
    });

    it("persists only the session id and expiry", () => {
        saveDispatcherSession(SESSION_REF);
        expect(loadDispatcherSession()).toEqual(SESSION_REF);
        expect(hasDispatcherSession()).toBe(true);
        expect(JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) as string)).toEqual(
            SESSION_REF,
        );
    });

    it("rejects corrupt or shapeless session refs", () => {
        for (const bad of [
            "{not json",
            JSON.stringify({ sessionId: "", expiresAt: "2026-11-02T00:00:00.000Z" }),
            JSON.stringify({ sessionId: "s" }),
            JSON.stringify({ sessionId: "s", expiresAt: 42 }),
        ]) {
            localStorage.setItem(SESSION_STORAGE_KEY, bad);
            expect(loadDispatcherSession()).toBeNull();
            expect(hasDispatcherSession()).toBe(false);
        }
    });

    it("adopts a pre-vault persisted set once, then deletes the legacy key", () => {
        localStorage.setItem("halo-dispatch-tokens", JSON.stringify(tokens()));
        expect(loadTokens()?.access_token).toBe("access");
        expect(localStorage.getItem("halo-dispatch-tokens")).toBeNull();
        // Adopted into memory: still readable without storage.
        expect(loadTokens()?.access_token).toBe("access");
    });

    it("deletes an unparseable legacy key instead of adopting it", () => {
        localStorage.setItem("halo-dispatch-tokens", "{not json");
        expect(loadTokens()).toBeNull();
        expect(localStorage.getItem("halo-dispatch-tokens")).toBeNull();
    });

    it("clearTokens clears memory, session, and legacy storage", () => {
        saveTokens(tokens());
        saveDispatcherSession(SESSION_REF);
        localStorage.setItem("halo-dispatch-tokens", JSON.stringify(tokens()));
        clearTokens();
        expect(loadTokens()).toBeNull();
        expect(loadDispatcherSession()).toBeNull();
        expect(localStorage.getItem("halo-dispatch-tokens")).toBeNull();
    });

    it("logout clears local state and expires the server session", () => {
        saveTokens(tokens());
        saveDispatcherSession(SESSION_REF);
        const { impl } = mockRoutedFetch({ vault: jsonResponse({ ok: true }) });
        logout();
        expect(loadTokens()).toBeNull();
        expect(loadDispatcherSession()).toBeNull();
        expect(impl).toHaveBeenCalledOnce();
        const [url, init] = impl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/api/book/sessions/current");
        expect(init.method).toBe("DELETE");
    });
});

describe("authService vault restore", () => {
    beforeEach(() => {
        clearTokens();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("short-circuits when memory tokens are fresh", async () => {
        saveTokens(tokens());
        const { impl } = mockRoutedFetch();
        await expect(restoreDispatcherSession()).resolves.toBe(true);
        expect(impl).not.toHaveBeenCalled();
    });

    it("returns false without a persisted session", async () => {
        const { impl } = mockRoutedFetch();
        await expect(restoreDispatcherSession()).resolves.toBe(false);
        expect(impl).not.toHaveBeenCalled();
    });

    it("repopulates memory from the vault session, preserving token age", async () => {
        saveDispatcherSession(SESSION_REF);
        const obtainedAt = Date.now() - 60_000;
        mockRoutedFetch({
            vault: jsonResponse({
                ...SESSION_REF,
                haloAccessToken: {
                    access_token: "access",
                    expires_in: 3600,
                    obtained_at: obtainedAt,
                    token_type: "Bearer",
                    scope: "all:standard offline_access",
                },
            }),
        });
        await expect(restoreDispatcherSession()).resolves.toBe(true);
        const restored = loadTokens()!;
        expect(restored.access_token).toBe("access");
        // The refresh token never leaves the vault: memory is access-only.
        expect(restored.refresh_token).toBeUndefined();
        // No re-stamp: proactive refresh sees the real age.
        expect(restored.obtained_at).toBe(obtainedAt);
    });

    it("clears a dead vault session and fails closed", async () => {
        saveDispatcherSession(SESSION_REF);
        mockRoutedFetch({ vault: jsonResponse({ error: "Unauthorized" }, 401) });
        await expect(restoreDispatcherSession()).resolves.toBe(false);
        expect(loadTokens()).toBeNull();
        expect(loadDispatcherSession()).toBeNull();
    });

    it("keeps the session id on transient vault failures", async () => {
        saveDispatcherSession(SESSION_REF);
        mockRoutedFetch({ vault: jsonResponse({ error: "boom" }, 500) });
        await expect(restoreDispatcherSession()).resolves.toBe(false);
        expect(loadDispatcherSession()).toEqual(SESSION_REF);
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

    it("handleCallback exchanges code, then vaults the pair behind a session id", async () => {
        const { impl } = mockRoutedFetch({
            halo: jsonResponse(tokens()),
            vault: jsonResponse(SESSION_REF, 201),
        });
        savePkceRequest({ state: "s1", verifier: "v".repeat(64) });

        const result = await handleCallback(CONFIG, "code-2", "s1");

        expect(result).toBe(true);
        expect(impl).toHaveBeenCalledTimes(2);
        const [url, init] = impl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe(`${CONFIG.authServer}/token`);
        const body = init.body as URLSearchParams;
        expect(body.get("grant_type")).toBe("authorization_code");
        expect(body.get("code")).toBe("code-2");
        expect(body.get("code_verifier")).toBe("v".repeat(64));
        const [vaultUrl, vaultInit] = impl.mock.calls[1] as unknown as [string, RequestInit];
        expect(vaultUrl).toBe("/api/book/sessions");
        expect(JSON.parse(vaultInit.body as string)).toMatchObject({
            haloTokenPair: { access_token: "access", refresh_token: "refresh" },
        });
        expect(loadTokens()?.access_token).toBe("access");
        // Vaulted from here on: the tenant travels with the create, and the
        // memory refresh token is dropped once the sealed copy exists.
        expect(JSON.parse(vaultInit.body as string)).toMatchObject({
            tenant: { authServer: CONFIG.authServer, clientId: CONFIG.clientId },
        });
        expect(loadTokens()?.refresh_token).toBeUndefined();
        expect(loadDispatcherSession()).toEqual(SESSION_REF);
        expect(loadPkceRequest()).toBeNull();
    });

    it("handleCallback still succeeds when the vault is unreachable", async () => {
        const impl = vi.fn(async (url: unknown) => {
            if (String(url) === `${CONFIG.authServer}/token`) {
                return jsonResponse(tokens());
            }
            throw new TypeError("fetch failed");
        });
        vi.stubGlobal("fetch", impl);
        savePkceRequest({ state: "s1", verifier: "v".repeat(64) });

        expect(await handleCallback(CONFIG, "code-2b", "s1")).toBe(true);
        expect(loadTokens()?.access_token).toBe("access");
        expect(loadDispatcherSession()).toBeNull();
    });

    it("handleCallback processes each authorization code once", async () => {
        const { impl } = mockRoutedFetch({ halo: jsonResponse(tokens()) });

        savePkceRequest({ state: "s1", verifier: "v".repeat(64) });
        expect(await handleCallback(CONFIG, "code-3", "s1")).toBe(true);

        savePkceRequest({ state: "s1", verifier: "v".repeat(64) });
        expect(await handleCallback(CONFIG, "code-3", "s1")).toBe(false);
        // One Halo exchange + one vault create; the replay makes no calls.
        expect(impl).toHaveBeenCalledTimes(2);
    });

    it("handleCallback returns false when the token endpoint rejects", async () => {
        const { impl, vaultCalls } = mockRoutedFetch({
            halo: { ok: false, status: 400, statusText: "Bad Request", json: async () => ({}) },
        });
        savePkceRequest({ state: "s1", verifier: "v".repeat(64) });

        expect(await handleCallback(CONFIG, "code-4", "s1")).toBe(false);
        expect(loadTokens()).toBeNull();
        expect(vaultCalls).toHaveLength(0);
        expect(impl).toHaveBeenCalledTimes(1);
    });

    it("refreshToken keeps the old refresh token when the response omits it", async () => {
        // No-vault (direct) mode: no session id, unreachable BFF.
        saveTokens(tokens({ refresh_token: "old-refresh" }));
        const impl = vi.fn(async (url: unknown) => {
            if (String(url) === `${CONFIG.authServer}/token`) {
                return jsonResponse(tokens({ access_token: "new-access", refresh_token: "" }));
            }
            throw new TypeError("fetch failed");
        });
        vi.stubGlobal("fetch", impl);

        expect(await refreshToken(CONFIG)).toBe(true);
        const stored = loadTokens()!;
        expect(stored.access_token).toBe("new-access");
        expect(stored.refresh_token).toBe("old-refresh");
        expect(typeof stored.obtained_at).toBe("number");
        expect(loadDispatcherSession()).toBeNull();
    });

    it("refreshToken vaults a direct refresh and drops the memory refresh token", async () => {
        saveTokens(tokens({ refresh_token: "old-refresh" }));
        const { impl, vaultCalls } = mockRoutedFetch({
            halo: jsonResponse(tokens({ access_token: "new-access", refresh_token: "" })),
            vault: jsonResponse(SESSION_REF, 201),
        });

        expect(await refreshToken(CONFIG)).toBe(true);
        // Reachable BFF moves the session into vaulted mode from here on.
        expect(loadTokens()?.access_token).toBe("new-access");
        expect(loadTokens()?.refresh_token).toBeUndefined();
        expect(loadDispatcherSession()).toEqual(SESSION_REF);
        expect(vaultCalls).toEqual(["POST /api/book/sessions"]);
        const [, vaultInit] = impl.mock.calls[1] as unknown as [string, RequestInit];
        expect(JSON.parse(vaultInit.body as string)).toMatchObject({
            haloTokenPair: { access_token: "new-access", refresh_token: "old-refresh" },
            tenant: { authServer: CONFIG.authServer, clientId: CONFIG.clientId },
        });
    });

    it("refreshToken rotates inside the Worker when a vault session exists", async () => {
        saveTokens({
            access_token: "stale-access",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "all:standard offline_access",
            obtained_at: Date.now() - 7200_000,
        });
        saveDispatcherSession(SESSION_REF);
        const fresh = { sessionId: "sess-1", expiresAt: "2026-12-02T00:00:00.000Z" };
        const { impl, vaultCalls } = mockRoutedFetch({
            vault: jsonResponse({
                ...fresh,
                haloAccessToken: {
                    access_token: "rotated-access",
                    expires_in: 3600,
                    obtained_at: Date.now(),
                },
            }),
        });

        expect(await refreshToken(CONFIG)).toBe(true);
        // No direct Halo call: rotation stays inside the Worker.
        expect(impl).toHaveBeenCalledTimes(1);
        expect(vaultCalls).toEqual(["POST /api/book/sessions/refresh"]);
        const [, vaultInit] = impl.mock.calls[0] as unknown as [string, RequestInit];
        expect(JSON.parse(vaultInit.body as string)).toEqual({ rotate: true });
        expect(loadTokens()?.access_token).toBe("rotated-access");
        expect(loadTokens()?.refresh_token).toBeUndefined();
        expect(loadDispatcherSession()).toEqual(fresh);
    });

    it("refreshToken drops a dead vault session and fails closed to re-login", async () => {
        saveTokens({
            access_token: "stale-access",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "all:standard offline_access",
            obtained_at: Date.now() - 7200_000,
        });
        saveDispatcherSession(SESSION_REF);
        mockRoutedFetch({ vault: jsonResponse({ error: "Unauthorized" }, 401) });

        expect(await refreshToken(CONFIG)).toBe(false);
        expect(loadDispatcherSession()).toBeNull();
        // Access-only memory has nothing to refresh directly with.
        expect(loadTokens()?.access_token).toBe("stale-access");
    });

    it("refreshToken keeps the session on transient rotation failures", async () => {
        saveTokens({
            access_token: "stale-access",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "all:standard offline_access",
            obtained_at: Date.now() - 7200_000,
        });
        saveDispatcherSession(SESSION_REF);
        mockRoutedFetch({ vault: jsonResponse({ error: "halo-unavailable" }, 502) });

        expect(await refreshToken(CONFIG)).toBe(false);
        expect(loadDispatcherSession()).toEqual(SESSION_REF);
    });

    it("refreshToken falls back to a fresh session when the vault id is stale", async () => {
        saveTokens(tokens());
        saveDispatcherSession(SESSION_REF);
        const fresh = { sessionId: "sess-2", expiresAt: "2026-11-03T00:00:00.000Z" };
        const { vaultCalls } = mockRoutedFetch({
            halo: jsonResponse(tokens({ access_token: "new-access" })),
            vault: (url) =>
                url.endsWith("/refresh")
                    ? jsonResponse({ error: "Unauthorized" }, 401)
                    : jsonResponse(fresh, 201),
        });

        // Rotation 401 drops the stale id; the usable memory pair refreshes
        // directly and vaults behind a fresh session.
        expect(await refreshToken(CONFIG)).toBe(true);
        expect(vaultCalls).toEqual(["POST /api/book/sessions/refresh", "POST /api/book/sessions"]);
        expect(loadDispatcherSession()).toEqual(fresh);
    });

    it("refreshToken clears tokens and session on invalid_grant", async () => {
        // Direct mode: no vault session, so the grant failure clears.
        saveTokens(tokens());
        const { vaultCalls } = mockRoutedFetch({
            halo: {
                ok: false,
                status: 400,
                statusText: "Bad Request",
                json: async () => ({ error: "invalid_grant" }),
            },
        });

        expect(await refreshToken(CONFIG)).toBe(false);
        expect(loadTokens()).toBeNull();
        expect(loadDispatcherSession()).toBeNull();
        expect(vaultCalls).toHaveLength(0);
    });

    it("refreshToken keeps tokens on a 400 without invalid_grant", async () => {
        saveTokens(tokens());
        const { vaultCalls } = mockRoutedFetch({
            halo: {
                ok: false,
                status: 400,
                statusText: "Bad Request",
                json: async () => ({ error: "invalid_request" }),
            },
        });

        expect(await refreshToken(CONFIG)).toBe(false);
        expect(loadTokens()?.access_token).toBe("access");
        expect(vaultCalls).toHaveLength(0);
    });

    it("refreshToken keeps tokens when the error body is unreadable", async () => {
        saveTokens(tokens());
        const { vaultCalls } = mockRoutedFetch({
            halo: {
                ok: false,
                status: 500,
                statusText: "Internal Server Error",
                json: async () => {
                    throw new Error("no json");
                },
            },
        });

        expect(await refreshToken(CONFIG)).toBe(false);
        expect(loadTokens()?.access_token).toBe("access");
        expect(vaultCalls).toHaveLength(0);
    });

    it("refreshToken keeps tokens on network failure for later retry", async () => {
        saveTokens(tokens());
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

        expect(await refreshToken(CONFIG)).toBe(false);
        expect(loadTokens()?.access_token).toBe("access");
    });

    it("ensureFreshToken skips refresh for fresh tokens with a session", async () => {
        saveTokens(tokens());
        saveDispatcherSession(SESSION_REF);
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        expect(await ensureFreshToken(CONFIG)).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("ensureFreshToken backfills the vault behind an adopted pair", async () => {
        saveTokens(tokens());
        const { vaultCalls } = mockRoutedFetch({ vault: jsonResponse(SESSION_REF, 201) });

        expect(await ensureFreshToken(CONFIG)).toBe(true);
        expect(vaultCalls).toEqual(["POST /api/book/sessions"]);
        expect(loadDispatcherSession()).toEqual(SESSION_REF);
        expect(loadTokens()?.refresh_token).toBeUndefined();
    });

    it("ensureFreshToken restores memory from the vault after a reload", async () => {
        saveDispatcherSession(SESSION_REF);
        const { vaultCalls } = mockRoutedFetch({
            vault: jsonResponse({
                ...SESSION_REF,
                haloAccessToken: {
                    access_token: "access",
                    expires_in: 3600,
                    obtained_at: Date.now(),
                },
            }),
        });

        expect(await ensureFreshToken(CONFIG)).toBe(true);
        expect(loadTokens()?.access_token).toBe("access");
        expect(loadTokens()?.refresh_token).toBeUndefined();
        // Fresh restore: no rotation needed.
        expect(vaultCalls).toEqual(["GET /api/book/sessions/current"]);
    });

    it("ensureFreshToken returns false with neither memory nor session", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        expect(await ensureFreshToken(CONFIG)).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
