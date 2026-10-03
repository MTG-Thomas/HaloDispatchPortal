// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type BookingEnv } from "../entry";
import {
    DISPATCHER_SESSION_PREFIX,
    DISPATCHER_SESSION_TTL_SECONDS,
    SessionError,
    createDispatcherSession,
    deleteDispatcherSession,
    dispatcherSessionKey,
    openDispatcherSession,
    refreshDispatcherSession,
} from "../session";
import { openTokenPair, type HaloTokenPair } from "../kv";
import { resetRateLimitsForTests } from "../ratelimit";
import { fakeKv } from "./fake-kv";

beforeEach(() => {
    resetRateLimitsForTests();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const SECRET = "test-secret-for-sessions";
const TENANT = { authServer: "https://auth.test", clientId: "client-1" };

function pair(partial: Partial<HaloTokenPair> = {}): HaloTokenPair {
    return {
        access_token: "session-access",
        refresh_token: "session-refresh",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "all:standard offline_access",
        ...partial,
    };
}

function env(): BookingEnv {
    return { SECRET, BOOKING_REQUESTS: fakeKv() };
}

async function call(
    testEnv: BookingEnv,
    method: string,
    path: string,
    options: { body?: unknown; sessionId?: string } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
    const headers: Record<string, string> = {};
    if (options.sessionId) {
        headers.Authorization = `Bearer ${options.sessionId}`;
    }
    const response = await worker.fetch(
        new Request(`https://portal.test${path}`, {
            method,
            headers: {
                ...headers,
                ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
            },
            ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        }),
        testEnv,
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

describe("dispatcher session store", () => {
    it("creates an opaque session with TTL expiry", async () => {
        const kv = fakeKv();
        const record = await createDispatcherSession(kv, pair(), SECRET);
        expect(record.sessionId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
        expect(record.sessionId).not.toContain("session-access");
        expect(record.exp).toBe(
            Math.floor(Date.parse(record.createdAt) / 1000) + DISPATCHER_SESSION_TTL_SECONDS,
        );
        expect(DISPATCHER_SESSION_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
        expect(dispatcherSessionKey(record.sessionId)).toBe(
            `${DISPATCHER_SESSION_PREFIX}${record.sessionId}`,
        );
        // The sealed record never contains the raw pair.
        const raw = (await kv.get(dispatcherSessionKey(record.sessionId))) as string;
        expect(raw).not.toContain("session-access");
        expect(raw).not.toContain("session-refresh");
        await expect(openTokenPair(record.sealedTokens, SECRET)).resolves.toEqual(pair());
    });

    it("rejects pairs without both tokens", async () => {
        for (const bad of [
            { access_token: "", refresh_token: "r" },
            { access_token: "a", refresh_token: "" },
            {},
        ]) {
            const error = await createDispatcherSession(
                fakeKv(),
                bad as HaloTokenPair,
                SECRET,
            ).catch((e: unknown) => e);
            expect(error).toBeInstanceOf(SessionError);
            expect((error as SessionError).code).toBe("invalid-pair");
        }
    });

    it("opens a live session with its pair", async () => {
        const kv = fakeKv();
        const created = await createDispatcherSession(kv, pair(), SECRET);
        const opened = await openDispatcherSession(kv, created.sessionId, SECRET);
        expect(opened?.record.sessionId).toBe(created.sessionId);
        expect(opened?.pair).toEqual(pair());
    });

    it("returns null for unknown, empty, or corrupt sessions", async () => {
        const kv = fakeKv();
        await expect(openDispatcherSession(kv, "missing", SECRET)).resolves.toBeNull();
        await expect(openDispatcherSession(kv, "", SECRET)).resolves.toBeNull();
        await kv.put(dispatcherSessionKey("corrupt"), "{not json");
        await expect(openDispatcherSession(kv, "corrupt", SECRET)).resolves.toBeNull();
    });

    it("rejects non-UUID session ids before touching KV", async () => {
        const kv = fakeKv();
        const created = await createDispatcherSession(kv, pair(), SECRET);
        const evil = "x".repeat(600);
        await expect(openDispatcherSession(kv, evil, SECRET)).resolves.toBeNull();
        await expect(deleteDispatcherSession(kv, evil)).resolves.toBe(false);
        const error = await refreshDispatcherSession(kv, evil, SECRET).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SessionError);
        expect((error as SessionError).code).toBe("not-found");
        // The live session is untouched.
        await expect(openDispatcherSession(kv, created.sessionId, SECRET)).resolves.toMatchObject({
            record: { sessionId: created.sessionId },
        });
    });

    it("stores tenant endpoints and the pair age at create", async () => {
        const kv = fakeKv();
        const obtained = Date.now() - 60_000;
        const record = await createDispatcherSession(
            kv,
            pair({ obtained_at: obtained }),
            SECRET,
            new Date(),
            { tenant: TENANT },
        );
        expect(record.tenant).toEqual(TENANT);
        expect(record.obtainedAtMs).toBe(obtained);
        // Sessions without tenant metadata cannot rotate (legacy).
        const legacy = await createDispatcherSession(kv, pair(), SECRET);
        expect(legacy.tenant).toBeUndefined();
        expect(legacy.obtainedAtMs).toBeLessThanOrEqual(Date.now());
    });

    it("expires past-exp sessions and deletes them", async () => {
        const kv = fakeKv();
        const created = await createDispatcherSession(kv, pair(), SECRET);
        await expect(
            openDispatcherSession(kv, created.sessionId, SECRET, created.exp + 1),
        ).resolves.toBeNull();
        expect(await kv.get(dispatcherSessionKey(created.sessionId))).toBeNull();
    });

    it("returns null under a rotated secret", async () => {
        const kv = fakeKv();
        const created = await createDispatcherSession(kv, pair(), SECRET);
        await expect(
            openDispatcherSession(kv, created.sessionId, "wrong-secret"),
        ).resolves.toBeNull();
    });

    it("refresh extends a live session without resealing by default", async () => {
        const kv = fakeKv();
        // Backdated two days but still live, so the extension is observable.
        const created = await createDispatcherSession(
            kv,
            pair(),
            SECRET,
            new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        );
        const before = Math.floor(Date.now() / 1000);
        const updated = await refreshDispatcherSession(kv, created.sessionId, SECRET);
        expect(updated.exp).toBeGreaterThan(created.exp);
        expect(updated.exp).toBeGreaterThanOrEqual(before + DISPATCHER_SESSION_TTL_SECONDS);
        expect(updated.exp).toBeLessThanOrEqual(
            Math.floor(Date.now() / 1000) + DISPATCHER_SESSION_TTL_SECONDS,
        );
        expect(updated.sealedTokens).toEqual(created.sealedTokens);
        await expect(openDispatcherSession(kv, created.sessionId, SECRET)).resolves.toMatchObject({
            record: { sessionId: created.sessionId },
        });
    });

    it("refresh reseals when handed a rotated pair", async () => {
        const kv = fakeKv();
        const created = await createDispatcherSession(kv, pair(), SECRET);
        const updated = await refreshDispatcherSession(
            kv,
            created.sessionId,
            SECRET,
            pair({
                access_token: "rotated-access",
                refresh_token: "rotated-refresh",
            }),
        );
        await expect(openTokenPair(updated.sealedTokens, SECRET)).resolves.toMatchObject({
            access_token: "rotated-access",
            refresh_token: "rotated-refresh",
        });
        // Resealing re-stamps the pair age; a bare extend preserves it.
        expect(updated.obtainedAtMs).toBeGreaterThanOrEqual(created.obtainedAtMs ?? 0);
        const extended = await refreshDispatcherSession(kv, created.sessionId, SECRET);
        expect(extended.obtainedAtMs).toBe(updated.obtainedAtMs);
    });

    it("refresh refuses unknown sessions and invalid pairs", async () => {
        const kv = fakeKv();
        const missing = await refreshDispatcherSession(kv, "missing", SECRET).catch(
            (e: unknown) => e,
        );
        expect(missing).toBeInstanceOf(SessionError);
        expect((missing as SessionError).code).toBe("not-found");

        const created = await createDispatcherSession(kv, pair(), SECRET);
        const bad = await refreshDispatcherSession(kv, created.sessionId, SECRET, {
            access_token: "a",
            refresh_token: "",
        }).catch((e: unknown) => e);
        expect(bad).toBeInstanceOf(SessionError);
        expect((bad as SessionError).code).toBe("invalid-pair");
    });

    it("delete is idempotent", async () => {
        const kv = fakeKv();
        const created = await createDispatcherSession(kv, pair(), SECRET);
        await expect(deleteDispatcherSession(kv, created.sessionId)).resolves.toBe(true);
        await expect(openDispatcherSession(kv, created.sessionId, SECRET)).resolves.toBeNull();
        await expect(deleteDispatcherSession(kv, created.sessionId)).resolves.toBe(false);
        await expect(deleteDispatcherSession(kv, "")).resolves.toBe(false);
    });
});

describe("session endpoints", () => {
    it("creates a session from a pair and answers no tokens", async () => {
        const testEnv = env();
        const { status, json } = await call(testEnv, "POST", "/api/book/sessions", {
            body: { haloTokenPair: pair() },
        });
        expect(status).toBe(201);
        expect(typeof json.sessionId).toBe("string");
        expect(typeof json.expiresAt).toBe("string");
        expect(JSON.stringify(json)).not.toContain("session-access");
        expect(JSON.stringify(json)).not.toContain("session-refresh");
        const opened = await openDispatcherSession(
            testEnv.BOOKING_REQUESTS,
            String(json.sessionId),
            SECRET,
        );
        expect(opened?.pair).toEqual(pair());
    });

    it("returns 400 for invalid create bodies", async () => {
        const testEnv = env();
        for (const body of [
            {},
            { haloTokenPair: { access_token: "a" } },
            { haloTokenPair: { access_token: "", refresh_token: "r" } },
            { haloTokenPair: pair(), tenant: { authServer: "http://plain.test", clientId: "c" } },
            { haloTokenPair: pair(), tenant: { authServer: "not-a-url", clientId: "c" } },
            { haloTokenPair: pair(), tenant: { authServer: "https://auth.test", clientId: "" } },
            { haloTokenPair: pair(), tenant: "nope" },
        ]) {
            const { status, json } = await call(testEnv, "POST", "/api/book/sessions", { body });
            expect(status).toBe(400);
            expect(json.error).toBe("Invalid session request");
        }
    });

    it("stores tenant endpoints from the create body", async () => {
        const testEnv = env();
        const { status, json } = await call(testEnv, "POST", "/api/book/sessions", {
            body: { haloTokenPair: pair(), tenant: TENANT },
        });
        expect(status).toBe(201);
        const opened = await openDispatcherSession(
            testEnv.BOOKING_REQUESTS,
            String(json.sessionId),
            SECRET,
        );
        expect(opened?.record.tenant).toEqual(TENANT);
    });

    it("uses a live session to hand access credentials back for memory restore", async () => {
        const testEnv = env();
        const created = await createDispatcherSession(
            testEnv.BOOKING_REQUESTS,
            pair(),
            SECRET,
            new Date(),
            { tenant: TENANT },
        );
        const { status, json } = await call(testEnv, "GET", "/api/book/sessions/current", {
            sessionId: created.sessionId,
        });
        expect(status).toBe(200);
        expect(json.sessionId).toBe(created.sessionId);
        expect(typeof json.expiresAt).toBe("string");
        expect(json.haloAccessToken).toMatchObject({ access_token: "session-access" });
        expect(JSON.stringify(json)).not.toContain("session-refresh");
        expect(json.haloTokenPair).toBeUndefined();
    });

    it("use answers 401 without a credential or for a dead session", async () => {
        const testEnv = env();
        expect((await call(testEnv, "GET", "/api/book/sessions/current")).status).toBe(401);
        expect(
            (await call(testEnv, "GET", "/api/book/sessions/current", { sessionId: "dead" }))
                .status,
        ).toBe(401);
    });

    it("use does not extend the session TTL", async () => {
        const testEnv = env();
        const created = await createDispatcherSession(testEnv.BOOKING_REQUESTS, pair(), SECRET);
        const { json } = await call(testEnv, "GET", "/api/book/sessions/current", {
            sessionId: created.sessionId,
        });
        expect(json.expiresAt).toBe(new Date(created.exp * 1000).toISOString());
    });

    it("refresh extends with or without a replacement pair, answering no tokens", async () => {
        const testEnv = env();
        // Backdated two days but still live, so the extension is observable.
        const created = await createDispatcherSession(
            testEnv.BOOKING_REQUESTS,
            pair(),
            SECRET,
            new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        );
        const bare = await call(testEnv, "POST", "/api/book/sessions/refresh", {
            sessionId: created.sessionId,
        });
        expect(bare.status).toBe(200);
        expect(Date.parse(String(bare.json.expiresAt))).toBeGreaterThan(created.exp * 1000);
        expect(JSON.stringify(bare.json)).not.toContain("session-access");

        const rotated = await call(testEnv, "POST", "/api/book/sessions/refresh", {
            sessionId: created.sessionId,
            body: {
                haloTokenPair: pair({
                    access_token: "rotated-access",
                    refresh_token: "rotated-refresh",
                }),
            },
        });
        expect(rotated.status).toBe(200);
        expect(JSON.stringify(rotated.json)).not.toContain("rotated-access");
        const opened = await openDispatcherSession(
            testEnv.BOOKING_REQUESTS,
            created.sessionId,
            SECRET,
        );
        expect(opened?.pair.access_token).toBe("rotated-access");
    });

    it("refresh answers 400 for invalid JSON or pairs, 401 for dead sessions", async () => {
        const testEnv = env();
        const created = await createDispatcherSession(testEnv.BOOKING_REQUESTS, pair(), SECRET);
        const badPair = await call(testEnv, "POST", "/api/book/sessions/refresh", {
            sessionId: created.sessionId,
            body: { haloTokenPair: { access_token: "a" } },
        });
        expect(badPair.status).toBe(400);

        const response = await worker.fetch(
            new Request("https://portal.test/api/book/sessions/refresh", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${created.sessionId}`,
                    "Content-Type": "application/json",
                },
                body: "{not json",
            }),
            testEnv,
        );
        expect(response.status).toBe(400);

        expect(
            (await call(testEnv, "POST", "/api/book/sessions/refresh", { sessionId: "dead" }))
                .status,
        ).toBe(401);
        expect((await call(testEnv, "POST", "/api/book/sessions/refresh")).status).toBe(401);
    });

    it("rotates the sealed pair inside the Worker and returns access-only creds", async () => {
        const testEnv = env();
        const created = await createDispatcherSession(
            testEnv.BOOKING_REQUESTS,
            pair(),
            SECRET,
            new Date(),
            { tenant: TENANT },
        );
        const seen: string[] = [];
        vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
            seen.push(`${init?.method ?? "GET"} ${String(input)}`);
            expect(String(input)).toBe("https://auth.test/token");
            return Response.json({
                access_token: "rotated-access",
                refresh_token: "rotated-refresh",
                expires_in: 3600,
            });
        });
        const { status, json } = await call(testEnv, "POST", "/api/book/sessions/refresh", {
            sessionId: created.sessionId,
            body: { rotate: true },
        });
        expect(status).toBe(200);
        expect(json.sessionId).toBe(created.sessionId);
        expect(json.haloAccessToken).toMatchObject({ access_token: "rotated-access" });
        expect(JSON.stringify(json)).not.toContain("rotated-refresh");
        expect(seen).toEqual(["POST https://auth.test/token"]);
        // The rotated pair is resealed server-side.
        const opened = await openDispatcherSession(
            testEnv.BOOKING_REQUESTS,
            created.sessionId,
            SECRET,
        );
        expect(opened?.pair.access_token).toBe("rotated-access");
        expect(opened?.pair.refresh_token).toBe("rotated-refresh");
    });

    it("rotation answers 401 for dead or tenant-less sessions", async () => {
        const testEnv = env();
        const legacy = await createDispatcherSession(testEnv.BOOKING_REQUESTS, pair(), SECRET);
        expect(
            (
                await call(testEnv, "POST", "/api/book/sessions/refresh", {
                    sessionId: legacy.sessionId,
                    body: { rotate: true },
                })
            ).status,
        ).toBe(401);
        expect(
            (
                await call(testEnv, "POST", "/api/book/sessions/refresh", {
                    sessionId: "dead",
                    body: { rotate: true },
                })
            ).status,
        ).toBe(401);
    });

    it("rotation answers 502 on Halo failure and keeps the session", async () => {
        const testEnv = env();
        const created = await createDispatcherSession(
            testEnv.BOOKING_REQUESTS,
            pair(),
            SECRET,
            new Date(),
            { tenant: TENANT },
        );
        vi.stubGlobal("fetch", async () => new Response("halo down", { status: 500 }));
        const { status, json } = await call(testEnv, "POST", "/api/book/sessions/refresh", {
            sessionId: created.sessionId,
            body: { rotate: true },
        });
        expect(status).toBe(502);
        expect(json.error).toBe("halo-unavailable");
        await expect(
            openDispatcherSession(testEnv.BOOKING_REQUESTS, created.sessionId, SECRET),
        ).resolves.toMatchObject({ record: { sessionId: created.sessionId } });
    });

    it("expire deletes idempotently and requires a credential", async () => {
        const testEnv = env();
        const created = await createDispatcherSession(testEnv.BOOKING_REQUESTS, pair(), SECRET);
        expect((await call(testEnv, "DELETE", "/api/book/sessions/current")).status).toBe(401);
        const first = await call(testEnv, "DELETE", "/api/book/sessions/current", {
            sessionId: created.sessionId,
        });
        expect(first.status).toBe(200);
        expect(first.json).toEqual({ ok: true });
        await expect(
            openDispatcherSession(testEnv.BOOKING_REQUESTS, created.sessionId, SECRET),
        ).resolves.toBeNull();
        // Second delete still reports ok.
        const second = await call(testEnv, "DELETE", "/api/book/sessions/current", {
            sessionId: created.sessionId,
        });
        expect(second.status).toBe(200);
    });
});
