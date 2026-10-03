// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import worker, { type BookingEnv } from "../entry";
import { createBookingRequest, sealTokenPair, type HaloTokenPair } from "../kv";
import { resetRateLimitsForTests } from "../ratelimit";
import { createDispatcherSession, deleteDispatcherSession } from "../session";
import { fakeKv } from "./fake-kv";

beforeEach(() => {
    resetRateLimitsForTests();
});

const SECRET = "test-secret-for-list";

const PAIR_A: HaloTokenPair = { access_token: "a-access", refresh_token: "a-refresh" };
const PAIR_B: HaloTokenPair = { access_token: "b-access", refresh_token: "b-refresh" };

function env(): BookingEnv {
    return { SECRET, BOOKING_REQUESTS: fakeKv() };
}

async function seed(
    testEnv: BookingEnv,
    rid: string,
    pair: HaloTokenPair,
    ticketId: number,
    overrides: { exp?: number; createdAt?: Date; sessionId?: string } = {},
): Promise<void> {
    const nowSec = Math.floor(Date.now() / 1000);
    await createBookingRequest(
        testEnv.BOOKING_REQUESTS,
        {
            rid,
            ticketId,
            agentIds: [1],
            appointmentTypeId: 1,
            sealedTokens: await sealTokenPair(pair, SECRET),
            exp: overrides.exp ?? nowSec + 3600,
            ...(overrides.sessionId !== undefined ? { sessionId: overrides.sessionId } : {}),
        },
        overrides.createdAt ?? new Date(),
    );
}

async function list(
    testEnv: BookingEnv,
    accessToken?: string,
    ip?: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
    const headers: Record<string, string> = {};
    if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
    }
    if (ip) {
        headers["cf-connecting-ip"] = ip;
    }
    const response = await worker.fetch(
        new Request("https://portal.test/api/book/requests", { headers }),
        testEnv,
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

describe("dispatcher list endpoint", () => {
    it("requires a bearer credential but reveals nothing to strangers", async () => {
        const testEnv = env();
        await seed(testEnv, "rid-a1", PAIR_A, 42);

        expect((await list(testEnv)).status).toBe(401);
        expect((await list(testEnv, "wrong-token")).status).toBe(200);
        // Wrong token matches nobody: authenticated shape, zero rows.
        expect((await list(testEnv, "wrong-token")).json).toEqual({ requests: [] });
    });

    it("lists only the caller's own requests, newest first", async () => {
        const testEnv = env();
        await seed(testEnv, "rid-a1", PAIR_A, 42, { createdAt: new Date("2026-01-01T00:00:00Z") });
        await seed(testEnv, "rid-b1", PAIR_B, 43, { createdAt: new Date("2026-01-02T00:00:00Z") });
        await seed(testEnv, "rid-a2", PAIR_A, 44, { createdAt: new Date("2026-01-03T00:00:00Z") });

        const { status, json } = await list(testEnv, "a-access");
        expect(status).toBe(200);
        const requests = json.requests as Record<string, unknown>[];
        expect(requests.map((row) => row.rid)).toEqual(["rid-a2", "rid-a1"]);
        expect(requests[0]).toMatchObject({ status: "pending", ticketId: 44 });
        // Sealed tokens never leak through the list endpoint.
        expect(JSON.stringify(json)).not.toContain("a-access");
        expect(JSON.stringify(json)).not.toContain("a-refresh");
        for (const row of requests) {
            expect(row).not.toHaveProperty("sealedTokens");
            expect(row).toHaveProperty("clickedAt");
        }
    });

    it("returns an empty list for a dispatcher with no requests", async () => {
        const { status, json } = await list(env(), "nobody-access");
        expect(status).toBe(200);
        expect(json).toEqual({ requests: [] });
    });

    it("lists session-bound rows by session id, excluding other sessions", async () => {
        const testEnv = env();
        const mine = await createDispatcherSession(testEnv.BOOKING_REQUESTS, PAIR_A, SECRET);
        const theirs = await createDispatcherSession(testEnv.BOOKING_REQUESTS, PAIR_B, SECRET);
        await seed(testEnv, "rid-mine", PAIR_A, 42, { sessionId: mine.sessionId });
        await seed(testEnv, "rid-theirs", PAIR_B, 43, { sessionId: theirs.sessionId });

        const { status, json } = await list(testEnv, mine.sessionId);
        expect(status).toBe(200);
        const requests = json.requests as Record<string, unknown>[];
        expect(requests.map((row) => row.rid)).toEqual(["rid-mine"]);
        expect(JSON.stringify(json)).not.toContain("a-access");
    });

    it("lets a session id adopt pre-vault rows sealed with the same pair", async () => {
        const testEnv = env();
        const session = await createDispatcherSession(testEnv.BOOKING_REQUESTS, PAIR_A, SECRET);
        await seed(testEnv, "rid-legacy", PAIR_A, 42);

        const { json } = await list(testEnv, session.sessionId);
        const requests = json.requests as Record<string, unknown>[];
        expect(requests.map((row) => row.rid)).toEqual(["rid-legacy"]);
    });

    it("returns an empty list for a dead session id", async () => {
        const testEnv = env();
        await seed(testEnv, "rid-a1", PAIR_A, 42);
        const { status, json } = await list(testEnv, "dead-session-id");
        expect(status).toBe(200);
        expect(json).toEqual({ requests: [] });
    });

    it("drops session-bound rows once the session is deleted", async () => {
        const testEnv = env();
        const session = await createDispatcherSession(testEnv.BOOKING_REQUESTS, PAIR_A, SECRET);
        await seed(testEnv, "rid-mine", PAIR_A, 42, { sessionId: session.sessionId });

        const before = await list(testEnv, session.sessionId);
        expect((before.json.requests as Record<string, unknown>[]).map((row) => row.rid)).toEqual([
            "rid-mine",
        ]);

        await deleteDispatcherSession(testEnv.BOOKING_REQUESTS, session.sessionId);
        const { status, json } = await list(testEnv, session.sessionId);
        expect(status).toBe(200);
        expect(json).toEqual({ requests: [] });
    });

    it("flips past-expiry pending rows to expired", async () => {
        const testEnv = env();
        await seed(testEnv, "rid-old", PAIR_A, 42, {
            exp: Math.floor(Date.now() / 1000) - 10,
        });

        const { json } = await list(testEnv, "a-access");
        const requests = json.requests as Record<string, unknown>[];
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({ rid: "rid-old", status: "expired" });

        // The flip persists: the status endpoint agrees afterwards.
        const statusResponse = await worker.fetch(
            new Request("https://portal.test/api/book/requests/rid-old/status", {
                headers: { Authorization: `Bearer ${PAIR_A.access_token}` },
            }),
            testEnv,
        );
        expect(((await statusResponse.json()) as Record<string, unknown>).status).toBe("expired");
    });

    it("skips corrupt rows instead of failing the listing", async () => {
        const testEnv = env();
        await seed(testEnv, "rid-good", PAIR_A, 42);
        await testEnv.BOOKING_REQUESTS.put("book:req:corrupt", "{not json");

        const { status, json } = await list(testEnv, "a-access");
        expect(status).toBe(200);
        const requests = json.requests as Record<string, unknown>[];
        expect(requests.map((row) => row.rid)).toEqual(["rid-good"]);
    });

    it("rate-limits the full-scan listing per IP", async () => {
        const testEnv = env();
        await seed(testEnv, "rid-a1", PAIR_A, 42);
        for (let i = 0; i < 30; i++) {
            expect((await list(testEnv, "a-access", "10.8.8.8")).status).toBe(200);
        }
        const limited = await list(testEnv, "a-access", "10.8.8.8");
        expect(limited.status).toBe(429);
        expect(limited.json.error).toBe("rate-limited");
        // A different IP is unaffected.
        expect((await list(testEnv, "a-access", "10.8.8.9")).status).toBe(200);
    });
});
