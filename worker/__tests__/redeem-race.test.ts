// @vitest-environment node
import { describe, expect, it, vi, afterEach } from "vitest";
import worker, { redeemConflict, type BookingEnv } from "../entry";
import {
    CLAIM_TTL_MS,
    claimBookingForRedeem,
    createBookingRequest,
    getBookingRequest,
    markBookingBooked,
    markBookingSeriesBooked,
    sealTokenPair,
    setBookingStatus,
    type KeyValueClient,
} from "../kv";
import { resetRateLimitsForTests } from "../ratelimit";
import { fakeKv } from "./fake-kv";

/**
 * Concurrent-redeem regression suite. Two overlapping confirms on one link
 * must produce exactly one set of Halo appointments: the loser answers 409
 * without writing to Halo. The Halo stub gates overlapping appointment
 * POSTs behind a barrier so the overlap is deterministic, not timing luck —
 * with no claim protocol both requests sail through check-then-act and the
 * barrier proves they were inside the Halo write together.
 */

const SECRET = "test-secret-for-redeem-race";
const RESOURCE = "https://halo.test";
const AUTH = "https://auth.test";

const GOOD_PAIR = { access_token: "dispatcher-access", refresh_token: "dispatcher-refresh" };

function env(): BookingEnv {
    return {
        SECRET,
        BOOKING_REQUESTS: fakeKv(),
        HALO_RESOURCE_SERVER: RESOURCE,
        HALO_AUTH_SERVER: AUTH,
        HALO_CLIENT_ID: "client-1",
    };
}

let ipCounter = 0;
function freshIp(): string {
    ipCounter += 1;
    return `10.99.0.${ipCounter}`;
}

function nextWeekdays(count: number): string[] {
    const now = new Date();
    const dates: string[] = [];
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    while (dates.length < count) {
        if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
            dates.push(day.toISOString().slice(0, 10));
        }
        day.setUTCDate(day.getUTCDate() + 1);
    }
    return dates;
}

interface HaloStub {
    posts: { url: string; body: unknown }[];
    /** How many appointment POSTs overlapped inside the barrier. */
    maxOverlap: number;
    /** Appointment-list GETs served (proves live validation ran). */
    appointmentReads: number;
}

function stubHalo(created: unknown[] = [{ id: 555 }]): HaloStub {
    const stub: HaloStub = { posts: [], maxOverlap: 0, appointmentReads: 0 };
    let inFlight = 0;
    let arrivals = 0;
    let release!: () => void;
    const bothHere = new Promise<void>((resolve) => {
        release = resolve;
    });
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (method === "POST" && url === `${AUTH}/token`) {
            return Response.json({ access_token: "refreshed-access", expires_in: 3600 });
        }
        if (method === "POST" && url === `${RESOURCE}/api/appointment`) {
            stub.posts.push({ url, body: JSON.parse((init?.body as string) ?? "null") });
            arrivals += 1;
            inFlight += 1;
            stub.maxOverlap = Math.max(stub.maxOverlap, inFlight);
            if (arrivals >= 2) {
                release();
            }
            try {
                // Overlap deterministically when both confirms reach the Halo
                // write; a serialized loser never arrives, so time out and
                // let the lone writer through.
                await Promise.race([bothHere, new Promise((resolve) => setTimeout(resolve, 50))]);
            } finally {
                inFlight -= 1;
            }
            return Response.json(created);
        }
        if (url.includes("/api/agent")) {
            return Response.json([
                { id: 7, name: "Dana Dispatcher" },
                { id: 9, name: "Nina Booker" },
            ]);
        }
        if (url.includes("/api/Tickets/")) {
            return Response.json({
                id: 42,
                summary: "Printer down",
                client_id: 100,
                site_id: 200,
                user_id: 300,
            });
        }
        if (url.includes("/api/Appointment") || url.includes("/api/appointment")) {
            stub.appointmentReads += 1;
            return Response.json([]);
        }
        return new Response("unexpected halo call", { status: 500 });
    });
    return stub;
}

afterEach(() => {
    vi.unstubAllGlobals();
    resetRateLimitsForTests();
});

async function mint(
    testEnv: BookingEnv,
    overrides: Record<string, unknown> = {},
): Promise<{ rid: string; token: string }> {
    const response = await worker.fetch(
        new Request("https://portal.test/api/book/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json", "cf-connecting-ip": freshIp() },
            body: JSON.stringify({
                ticketId: 42,
                agentIds: [7, 9],
                appointmentTypeId: 3,
                haloTokenPair: { ...GOOD_PAIR },
                ...overrides,
            }),
        }),
        testEnv,
    );
    expect(response.status).toBe(201);
    return (await response.json()) as { rid: string; token: string };
}

async function getSlots(
    testEnv: BookingEnv,
    rid: string,
    token: string,
): Promise<Record<string, unknown>> {
    const response = await worker.fetch(
        new Request(
            `https://portal.test/api/book/requests/${rid}/slots?token=${encodeURIComponent(token)}`,
            { headers: { "cf-connecting-ip": freshIp() } },
        ),
        testEnv,
    );
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, unknown>;
}

async function postBook(
    testEnv: BookingEnv,
    rid: string,
    body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
    const response = await worker.fetch(
        new Request(`https://portal.test/api/book/requests/${rid}/book`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "cf-connecting-ip": freshIp() },
            body: JSON.stringify(body),
        }),
        testEnv,
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

describe("concurrent redeem", () => {
    it("two overlapping single confirms create exactly one Halo appointment", async () => {
        const testEnv = env();
        const stub = stubHalo();
        const { rid, token } = await mint(testEnv);
        const slots = await getSlots(testEnv, rid, token);
        const slot = (
            slots.days as { slots: { agentId: number; start: string; end: string }[] }[]
        )[0].slots[0];
        const body = { token, ...slot, utcOffset: 0 };

        const [first, second] = await Promise.all([
            postBook(testEnv, rid, body),
            postBook(testEnv, rid, body),
        ]);

        expect(stub.posts).toHaveLength(1);
        expect([first.status, second.status].sort()).toEqual([201, 409]);
        const loser = first.status === 409 ? first : second;
        expect(loser.json).toMatchObject({ error: "already-booked", appointmentId: 555 });
        const record = await getBookingRequest(testEnv.BOOKING_REQUESTS, rid);
        expect(record?.status).toBe("booked");
        expect(record?.bookedAppointmentId).toBe(555);
    });

    it("two overlapping series confirms create one appointment per occurrence", async () => {
        const testEnv = env();
        const stub = stubHalo([{ id: 701 }, { id: 702 }]);
        const dates = nextWeekdays(2);
        const { rid, token } = await mint(testEnv, { occurrences: dates });
        const slots = await getSlots(testEnv, rid, token);
        const occurrences = slots.occurrences as {
            date: string;
            slots: { agentId: number; start: string; end: string }[];
        }[];
        expect(occurrences).toHaveLength(2);
        const body = {
            token,
            bookings: occurrences.map((o) => ({ ...o.slots[0], occurrence: o.date })),
            utcOffset: 0,
        };

        const [first, second] = await Promise.all([
            postBook(testEnv, rid, body),
            postBook(testEnv, rid, body),
        ]);

        expect(stub.posts).toHaveLength(2);
        expect([first.status, second.status].sort()).toEqual([201, 409]);
        const loser = first.status === 409 ? first : second;
        expect(loser.json.error).toBe("already-booked");
        const record = await getBookingRequest(testEnv.BOOKING_REQUESTS, rid);
        expect(record?.status).toBe("booked");
        expect(record?.bookedAppointmentIds).toHaveLength(2);
    });

    it("releases the claim when validation fails so the customer can retry", async () => {
        const testEnv = env();
        const stub = stubHalo();
        const { rid, token } = await mint(testEnv);
        const slots = await getSlots(testEnv, rid, token);
        const slot = (
            slots.days as { slots: { agentId: number; start: string; end: string }[] }[]
        )[0].slots[0];

        // Long-past slot: passes parsing, fails live validation after claiming.
        const bad = await postBook(testEnv, rid, {
            token,
            agentId: slot.agentId,
            start: "2020-01-06T09:00:00.000Z",
            end: "2020-01-06T09:30:00.000Z",
            utcOffset: 0,
        });
        expect(bad.status).toBe(400);
        expect(bad.json.error).toBe("invalid-slot");
        expect(stub.posts).toHaveLength(0);

        const record = await getBookingRequest(testEnv.BOOKING_REQUESTS, rid);
        expect(record?.status).toBe("pending");
        expect(record?.claimId).toBeUndefined();

        const retry = await postBook(testEnv, rid, { token, ...slot, utcOffset: 0 });
        expect(retry.status).toBe(201);
        expect(stub.posts).toHaveLength(1);
    });

    it("series all-invalid validation releases the claim for corrected retries", async () => {
        const testEnv = env();
        const stub = stubHalo([{ id: 701 }, { id: 702 }]);
        const dates = nextWeekdays(2);
        const { rid, token } = await mint(testEnv, { occurrences: dates });

        // 03:00Z picks pass semantic checks (issued dates, valid agent and
        // duration) but fail live business-hours validation after claiming.
        const bad = await postBook(testEnv, rid, {
            token,
            bookings: dates.map((date) => ({
                agentId: 7,
                start: `${date}T03:00:00.000Z`,
                end: `${date}T03:30:00.000Z`,
                occurrence: date,
            })),
            utcOffset: 0,
        });
        expect(bad.status).toBe(400);
        expect(bad.json.error).toBe("invalid-slot");
        expect(stub.posts).toHaveLength(0);
        // Live re-check ran: this reached valid.length === 0, not the
        // earlier semantic rejection.
        expect(stub.appointmentReads).toBeGreaterThan(0);

        const record = await getBookingRequest(testEnv.BOOKING_REQUESTS, rid);
        expect(record?.status).toBe("pending");
        expect(record?.claimId).toBeUndefined();

        // Corrected retry books instead of failing booking-in-progress.
        const slots = await getSlots(testEnv, rid, token);
        const occurrences = slots.occurrences as {
            date: string;
            slots: { agentId: number; start: string; end: string }[];
        }[];
        const retry = await postBook(testEnv, rid, {
            token,
            bookings: occurrences.map((o) => ({ ...o.slots[0], occurrence: o.date })),
            utcOffset: 0,
        });
        expect(retry.status).toBe(201);
        expect(stub.posts).toHaveLength(2);
    });

    it("takes over a stale claim instead of blocking the confirm", async () => {
        const testEnv = env();
        stubHalo();
        const { rid, token } = await mint(testEnv);
        const slots = await getSlots(testEnv, rid, token);
        const slot = (
            slots.days as { slots: { agentId: number; start: string; end: string }[] }[]
        )[0].slots[0];

        // Simulate a worker that died mid-redeem: live claim, ancient stamp.
        await claimBookingForRedeem(
            testEnv.BOOKING_REQUESTS,
            rid,
            "crashed-worker-claim",
            new Date(Date.now() - CLAIM_TTL_MS - 1000),
        );

        const booked = await postBook(testEnv, rid, { token, ...slot, utcOffset: 0 });
        expect(booked.status).toBe(201);
        expect(booked.json).toMatchObject({ rid, appointmentId: 555 });
    });
});

describe("redeemConflict", () => {
    async function seed(kv: KeyValueClient, rid: string): Promise<void> {
        await createBookingRequest(kv, {
            rid,
            ticketId: 42,
            agentIds: [7],
            appointmentTypeId: 3,
            sealedTokens: await sealTokenPair({ access_token: "a", refresh_token: "r" }, SECRET),
            exp: Math.floor(Date.now() / 1000) + 3600,
        });
    }

    it("reports the record's actual state to race losers", async () => {
        const kv = fakeKv();

        await seed(kv, "rid-booked");
        await markBookingBooked(kv, "rid-booked", 555);
        const booked = await redeemConflict(kv, "rid-booked", false);
        expect(booked.status).toBe(409);
        expect(await booked.json()).toMatchObject({
            error: "already-booked",
            appointmentId: 555,
        });

        await seed(kv, "rid-series");
        await markBookingSeriesBooked(kv, "rid-series", [701, 702]);
        const series = await redeemConflict(kv, "rid-series", true);
        expect(series.status).toBe(409);
        expect(await series.json()).toMatchObject({
            error: "already-booked",
            appointmentId: 701,
            appointmentIds: [701, 702],
        });

        await seed(kv, "rid-cancelled");
        await setBookingStatus(kv, "rid-cancelled", "cancelled");
        const cancelled = await redeemConflict(kv, "rid-cancelled", false);
        expect(cancelled.status).toBe(410);
        expect(await cancelled.json()).toMatchObject({ error: "cancelled" });

        await seed(kv, "rid-expired");
        await setBookingStatus(kv, "rid-expired", "expired");
        const expired = await redeemConflict(kv, "rid-expired", false);
        expect(expired.status).toBe(410);
        expect(await expired.json()).toMatchObject({ error: "expired" });

        await seed(kv, "rid-claimed");
        await claimBookingForRedeem(kv, "rid-claimed", "foreign-claim");
        const busy = await redeemConflict(kv, "rid-claimed", false);
        expect(busy.status).toBe(409);
        expect(await busy.json()).toMatchObject({ error: "booking-in-progress" });

        const missing = await redeemConflict(kv, "rid-missing", false);
        expect(missing.status).toBe(404);
    });
});
