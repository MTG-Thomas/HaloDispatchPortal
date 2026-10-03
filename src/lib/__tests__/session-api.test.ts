import { describe, it, expect, vi, afterEach } from "vitest";
import {
    DispatcherSessionError,
    SESSION_API_BASE,
    createDispatcherSession,
    expireDispatcherSession,
    fetchDispatcherSession,
    refreshDispatcherSession,
} from "../session-api";

const PAIR = { access_token: "halo-access", refresh_token: "halo-refresh" };
const REF = { sessionId: "sess-1", expiresAt: "2026-11-02T00:00:00.000Z" };

function mockFetchOnce(status: number, body: unknown) {
    const impl = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", impl);
    return impl;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("session-api base", () => {
    it("nests under the booking BFF base", () => {
        expect(SESSION_API_BASE).toBe("/api/book/sessions");
    });
});

describe("createDispatcherSession", () => {
    it("POSTs the pair and returns the session ref", async () => {
        const impl = mockFetchOnce(201, REF);
        const result = await createDispatcherSession(PAIR);
        expect(result).toEqual(REF);
        const [url, init] = impl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/api/book/sessions");
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body as string)).toEqual({ haloTokenPair: PAIR });
    });

    it("keeps the server message on 400", async () => {
        mockFetchOnce(400, { error: "Invalid session request" });
        const error = await createDispatcherSession({
            access_token: "",
            refresh_token: "",
        }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(DispatcherSessionError);
        expect((error as DispatcherSessionError).code).toBe("invalid-request");
        expect((error as DispatcherSessionError).message).toBe("Invalid session request");
    });

    it("rejects malformed success bodies", async () => {
        mockFetchOnce(201, { nope: true });
        await expect(createDispatcherSession(PAIR)).rejects.toMatchObject({
            code: "network-error",
        });
    });

    it("rejects unparseable expiry values", async () => {
        mockFetchOnce(201, { sessionId: "s", expiresAt: "not-a-date" });
        await expect(createDispatcherSession(PAIR)).rejects.toMatchObject({
            code: "network-error",
        });
    });
});

describe("fetchDispatcherSession", () => {
    it("GETs current with the session Bearer [REDACTED] returns the pair", async () => {
        const impl = mockFetchOnce(200, { ...REF, haloTokenPair: PAIR });
        const result = await fetchDispatcherSession("sess-1");
        expect(result).toEqual({ ...REF, haloTokenPair: PAIR });
        const [url, init] = impl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/api/book/sessions/current");
        expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sess-1");
    });

    it("maps 401 to unauthorized", async () => {
        mockFetchOnce(401, { error: "Unauthorized" });
        const error = await fetchDispatcherSession("dead").catch((e: unknown) => e);
        expect(error).toBeInstanceOf(DispatcherSessionError);
        expect((error as DispatcherSessionError).code).toBe("unauthorized");
        expect((error as DispatcherSessionError).message).toMatch(/sign in again/i);
    });

    it("rejects success bodies without a usable pair", async () => {
        mockFetchOnce(200, { ...REF, haloTokenPair: { access_token: "a" } });
        await expect(fetchDispatcherSession("sess-1")).rejects.toMatchObject({
            code: "network-error",
        });
    });
});

describe("refreshDispatcherSession", () => {
    it("POSTs a bare extend without a body", async () => {
        const impl = mockFetchOnce(200, REF);
        const result = await refreshDispatcherSession("sess-1");
        expect(result).toEqual(REF);
        const [url, init] = impl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/api/book/sessions/refresh");
        expect(init.method).toBe("POST");
        expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sess-1");
        expect(init.body).toBeUndefined();
    });

    it("reseals when handed a rotated pair", async () => {
        const impl = mockFetchOnce(200, REF);
        await refreshDispatcherSession("sess-1", { access_token: "new-a", refresh_token: "new-r" });
        const [, init] = impl.mock.calls[0] as unknown as [string, RequestInit];
        expect(JSON.parse(init.body as string)).toEqual({
            haloTokenPair: { access_token: "new-a", refresh_token: "new-r" },
        });
    });

    it("maps 401 to unauthorized", async () => {
        mockFetchOnce(401, { error: "Unauthorized" });
        await expect(refreshDispatcherSession("dead")).rejects.toMatchObject({
            code: "unauthorized",
        });
    });
});

describe("expireDispatcherSession", () => {
    it("DELETEs current and resolves true", async () => {
        const impl = mockFetchOnce(200, { ok: true });
        await expect(expireDispatcherSession("sess-1")).resolves.toBe(true);
        const [url, init] = impl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/api/book/sessions/current");
        expect(init.method).toBe("DELETE");
        expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sess-1");
    });

    it.each([
        ["server error", 500, {}],
        ["unknown session", 401, { error: "Unauthorized" }],
    ])("never rejects (%s)", async (_label, status, body) => {
        mockFetchOnce(status as number, body);
        await expect(expireDispatcherSession("sess-1")).resolves.toBe(false);
    });

    it("never rejects on transport failure", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new TypeError("fetch failed");
            }),
        );
        await expect(expireDispatcherSession("sess-1")).resolves.toBe(false);
    });
});

describe("transport failures", () => {
    it("maps fetch rejections to network-error", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new TypeError("fetch failed");
            }),
        );
        await expect(createDispatcherSession(PAIR)).rejects.toMatchObject({
            code: "network-error",
        });
        await expect(fetchDispatcherSession("s")).rejects.toMatchObject({ code: "network-error" });
        await expect(refreshDispatcherSession("s")).rejects.toMatchObject({
            code: "network-error",
        });
    });

    it("rethows AbortError untouched", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new DOMException("aborted", "AbortError");
            }),
        );
        await expect(createDispatcherSession(PAIR)).rejects.toMatchObject({ name: "AbortError" });
    });

    it("maps 429 to network-error with a retry message", async () => {
        mockFetchOnce(429, { error: "rate-limited" });
        const error = await createDispatcherSession(PAIR).catch((e: unknown) => e);
        expect((error as DispatcherSessionError).code).toBe("network-error");
        expect((error as DispatcherSessionError).message).toMatch(/too many requests/i);
    });
});
