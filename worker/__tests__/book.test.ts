// @vitest-environment node
import { describe, expect, it, vi, afterEach } from "vitest";
import worker, { type BookingEnv } from "../entry";
import { getBookingRequest } from "../kv";
import { signBookingToken } from "../token";
import { resetRateLimitsForTests } from "../ratelimit";
import { fakeKv } from "./fake-kv";

const SECRET = "test-secret-for-book";
const RESOURCE = "https://halo.test";
const AUTH = "https://auth.test";

const GOOD_PAIR = { access_token: "dispatcher-access", refresh_token: "dispatcher-refresh" };

function goodBody() {
    return {
        ticketId: 42,
        agentIds: [7, 9],
        appointmentTypeId: 3,
        haloTokenPair: { ...GOOD_PAIR },
    };
}

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
    return `10.9.0.${ipCounter}`;
}

interface HaloStub {
    appointments?: unknown[];
    agents?: unknown[];
    ticket?: unknown;
    created?: unknown[];
    /** First appointments GET fails with this status (then succeeds). */
    appointmentsFailFirst?: number;
    calls: { url: string; method: string; body?: string }[];
    posts: { url: string; body: unknown }[];
}

function stubHalo(overrides: Partial<HaloStub> = {}): HaloStub {
    const stub: HaloStub = {
        appointments: [],
        agents: [
            { id: 7, name: "Dana Dispatcher" },
            { id: 9, name: "Nina Booker" },
        ],
        ticket: { id: 42, summary: "Printer down", client_id: 100, site_id: 200, user_id: 300 },
        created: [{ id: 555 }],
        calls: [],
        posts: [],
        ...overrides,
    };
    let appointmentsCalls = 0;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        stub.calls.push({
            url,
            method,
            body: typeof init?.body === "string" ? init.body : undefined,
        });
        if (method === "POST" && url === `${AUTH}/token`) {
            return Response.json({ access_token: "refreshed-access", expires_in: 3600 });
        }
        if (method === "POST" && url === `${RESOURCE}/api/appointment`) {
            stub.posts.push({ url, body: JSON.parse((init?.body as string) ?? "null") });
            return Response.json(stub.created);
        }
        if (url.includes("/api/agent")) {
            return Response.json(stub.agents);
        }
        if (url.includes("/api/Tickets/")) {
            return Response.json(stub.ticket);
        }
        if (url.includes("/api/Appointment") || url.includes("/api/appointment")) {
            appointmentsCalls += 1;
            if (stub.appointmentsFailFirst && appointmentsCalls === 1) {
                return new Response("unauthorized", { status: stub.appointmentsFailFirst });
            }
            return Response.json(stub.appointments);
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
            body: JSON.stringify({ ...goodBody(), ...overrides }),
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
    query = "",
    ip = freshIp(),
): Promise<{ status: number; json: Record<string, unknown> }> {
    const response = await worker.fetch(
        new Request(
            `https://portal.test/api/book/requests/${rid}/slots?token=${encodeURIComponent(token)}${query}`,
            { headers: { "cf-connecting-ip": ip } },
        ),
        testEnv,
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

async function postBook(
    testEnv: BookingEnv,
    rid: string,
    body: unknown,
    ip = freshIp(),
): Promise<{ status: number; json: Record<string, unknown> }> {
    const response = await worker.fetch(
        new Request(`https://portal.test/api/book/requests/${rid}/book`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
            body: JSON.stringify(body),
        }),
        testEnv,
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

describe("slots endpoint", () => {
    it("serves availability and claims first view once", async () => {
        const testEnv = env();
        stubHalo();
        const { rid, token } = await mint(testEnv);

        const first = await getSlots(testEnv, rid, token);
        expect(first.status).toBe(200);
        expect(first.json).toMatchObject({
            rid,
            ticketId: 42,
            appointmentTypeId: 3,
            firstView: true,
            durationMin: 30,
        });
        expect(first.json.agents).toEqual([
            { id: 7, name: "Dana Dispatcher" },
            { id: 9, name: "Nina Booker" },
        ]);
        const days = first.json.days as { date: string; slots: unknown[] }[];
        expect(days.length).toBeGreaterThan(0);
        expect(days[0].slots.length).toBeGreaterThan(0);

        const claimed = await getBookingRequest(testEnv.BOOKING_REQUESTS, rid);
        expect(claimed?.clickedAt).toBeTruthy();
        expect(claimed?.status).toBe("pending");

        const second = await getSlots(testEnv, rid, token);
        expect(second.status).toBe(200);
        expect(second.json.firstView).toBe(false);
    });

    it("rejects invalid tokens and rid mismatches with 401", async () => {
        const testEnv = env();
        stubHalo();
        const { rid, token } = await mint(testEnv);

        expect((await getSlots(testEnv, rid, "junk.token")).status).toBe(401);
        expect((await getSlots(testEnv, rid, `${token}tampered`)).status).toBe(401);
        expect((await getSlots(testEnv, "other-rid", token)).status).toBe(401);

        const noToken = await worker.fetch(
            new Request(`https://portal.test/api/book/requests/${rid}/slots`, {
                headers: { "cf-connecting-ip": freshIp() },
            }),
            testEnv,
        );
        expect(noToken.status).toBe(401);
    });

    it("answers expired tokens with 410 and flips the record", async () => {
        const testEnv = env();
        stubHalo();
        const { rid } = await mint(testEnv);
        const expired = await signBookingToken(
            {
                rid,
                ticketId: 42,
                agentIds: [7, 9],
                appointmentTypeId: 3,
                exp: Math.floor(Date.now() / 1000) - 10,
            },
            SECRET,
        );
        const response = await getSlots(testEnv, rid, expired);
        expect(response.status).toBe(410);
        expect(response.json.error).toBe("expired");
        expect((await getBookingRequest(testEnv.BOOKING_REQUESTS, rid))?.status).toBe("expired");
    });

    it("ignores expired tokens minted for a different request", async () => {
        const testEnv = env();
        stubHalo();
        const first = await mint(testEnv);
        const second = await mint(testEnv);
        const expiredForFirst = await signBookingToken(
            {
                rid: first.rid,
                ticketId: 42,
                agentIds: [7, 9],
                appointmentTypeId: 3,
                exp: Math.floor(Date.now() / 1000) - 10,
            },
            SECRET,
        );
        // Cross-rid replay: 401, and neither record flips.
        const response = await getSlots(testEnv, second.rid, expiredForFirst);
        expect(response.status).toBe(401);
        expect(response.json.error).toBe("invalid-token");
        expect((await getBookingRequest(testEnv.BOOKING_REQUESTS, second.rid))?.status).toBe(
            "pending",
        );
        expect((await getBookingRequest(testEnv.BOOKING_REQUESTS, first.rid))?.status).toBe(
            "pending",
        );
    });

    it("answers cancelled and booked records distinctly", async () => {
        const testEnv = env();
        stubHalo();
        const { rid, token } = await mint(testEnv);
        const cancel = await worker.fetch(
            new Request(`https://portal.test/api/book/requests/${rid}/cancel`, {
                method: "POST",
                headers: { Authorization: `Bearer ${GOOD_PAIR.access_token}` },
            }),
            testEnv,
        );
        expect(cancel.status).toBe(200);
        const response = await getSlots(testEnv, rid, token);
        expect(response.status).toBe(410);
        expect(response.json.error).toBe("cancelled");
        // Terminal records are never claimed.
        expect((await getBookingRequest(testEnv.BOOKING_REQUESTS, rid))?.clickedAt).toBeUndefined();
    });

    it("validates days, durationMin, and utcOffset", async () => {
        const testEnv = env();
        stubHalo();
        const { rid, token } = await mint(testEnv);
        for (const query of [
            "&days=0",
            "&days=31",
            "&days=x",
            "&durationMin=20",
            "&utcOffset=9999",
        ]) {
            expect((await getSlots(testEnv, rid, token, query)).status).toBe(400);
        }
        expect((await getSlots(testEnv, rid, token, "&days=3&durationMin=60")).status).toBe(200);
    });

    it("answers 503 without Halo env wiring", async () => {
        const testEnv = env();
        delete testEnv.HALO_RESOURCE_SERVER;
        stubHalo();
        const { rid, token } = await mint(testEnv);
        const response = await getSlots(testEnv, rid, token);
        expect(response.status).toBe(503);
        expect(response.json.error).toBe("booking-unavailable");
    });

    it("answers 502 when Halo is down", async () => {
        const testEnv = env();
        vi.stubGlobal("fetch", async () => new Response("bad", { status: 500 }));
        const { rid, token } = await mint(testEnv);
        const response = await getSlots(testEnv, rid, token);
        expect(response.status).toBe(502);
        expect(response.json.error).toBe("halo-unavailable");
    });

    it("refreshes the sealed pair once on Halo 401 and retries", async () => {
        const testEnv = env();
        const stub = stubHalo({ appointmentsFailFirst: 401 });
        const { rid, token } = await mint(testEnv);
        const response = await getSlots(testEnv, rid, token);
        expect(response.status).toBe(200);
        expect(stub.calls.some((c) => c.url === `${AUTH}/token`)).toBe(true);
    });

    it("offers per-agent working hours and caches the directory", async () => {
        const testEnv = env();
        const stub = stubHalo({
            agents: [
                { id: 7, name: "Dana Dispatcher", workhour_start: 10, workhour_end: 12 },
                { id: 9, name: "Nina Booker" },
            ],
        });
        const { rid, token } = await mint(testEnv);

        const first = await getSlots(testEnv, rid, token);
        expect(first.status).toBe(200);
        type Slot = { agentId: number; start: string; end: string };
        const all = (first.json.days as { slots: Slot[] }[]).flatMap((d) => d.slots);
        const custom = all.filter((s) => s.agentId === 7);
        const fallback = all.filter((s) => s.agentId === 9);
        expect(custom.length).toBeGreaterThan(0);
        for (const slot of custom) {
            expect(new Date(slot.start).getUTCHours()).toBeGreaterThanOrEqual(10);
            const end = new Date(slot.end);
            expect(end.getUTCHours() + end.getUTCMinutes() / 60).toBeLessThanOrEqual(12);
        }
        // Agent 9 has no schedule: falls back to 09:00.
        expect(fallback.some((s) => s.start.endsWith("T09:00:00.000Z"))).toBe(true);

        // The second view reuses the cached directory: no second agent fetch.
        expect((await getSlots(testEnv, rid, token)).status).toBe(200);
        expect(stub.calls.filter((c) => c.url.includes("/api/agent"))).toHaveLength(1);
    });
});

describe("book endpoint", () => {
    it("books once, then replays already-booked without duplicating", async () => {
        const testEnv = env();
        const stub = stubHalo();
        const { rid, token } = await mint(testEnv);
        const slots = await getSlots(testEnv, rid, token);
        const firstDay = (
            slots.json.days as { slots: { agentId: number; start: string; end: string }[] }[]
        )[0];
        const slot = firstDay.slots[0];

        const booked = await postBook(testEnv, rid, { token, ...slot, utcOffset: 0 });
        expect(booked.status).toBe(201);
        expect(booked.json).toMatchObject({
            rid,
            appointmentId: 555,
            agentId: slot.agentId,
            start: slot.start,
            end: slot.end,
        });
        const record = await getBookingRequest(testEnv.BOOKING_REQUESTS, rid);
        expect(record?.status).toBe("booked");
        expect(record?.bookedAppointmentId).toBe(555);

        // Halo saw exactly one appointment create, ticket-linked like dispatch.
        expect(stub.posts).toHaveLength(1);
        const payload = (stub.posts[0].body as Record<string, unknown>[])[0];
        expect(payload).toMatchObject({
            event_type: "a",
            appointment_type_id: 3,
            ticket_id: 42,
            agent_id: slot.agentId,
            subject: "Printer down",
            start_date: slot.start,
            end_date: slot.end,
        });

        const replay = await postBook(testEnv, rid, { token, ...slot, utcOffset: 0 });
        expect(replay.status).toBe(409);
        expect(replay.json).toMatchObject({ error: "already-booked", appointmentId: 555 });
        expect(stub.posts).toHaveLength(1);

        // Slots on a booked link also report already-booked.
        const after = await getSlots(testEnv, rid, token);
        expect(after.status).toBe(409);
        expect(after.json.error).toBe("already-booked");
    });

    it("rejects taken slots with 409 without creating", async () => {
        const testEnv = env();
        stubHalo();
        const { rid, token } = await mint(testEnv);
        const slots = await getSlots(testEnv, rid, token);
        const slot = (
            slots.json.days as { slots: { agentId: number; start: string; end: string }[] }[]
        )[0].slots[0];

        // Someone else grabbed the slot between load and confirm.
        const stub = stubHalo({
            appointments: [
                {
                    id: 1,
                    agent_id: slot.agentId,
                    start_date: slot.start.replace("Z", ""),
                    end_date: slot.end.replace("Z", ""),
                    allday: false,
                },
            ],
        });
        const response = await postBook(testEnv, rid, { token, ...slot, utcOffset: 0 });
        expect(response.status).toBe(409);
        expect(response.json.error).toBe("slot-taken");
        expect(stub.posts).toHaveLength(0);
        expect((await getBookingRequest(testEnv.BOOKING_REQUESTS, rid))?.status).toBe("pending");
    });

    it("validates the booking body", async () => {
        const testEnv = env();
        stubHalo();
        const { rid, token } = await mint(testEnv);
        const slots = await getSlots(testEnv, rid, token);
        const slot = (
            slots.json.days as { slots: { agentId: number; start: string; end: string }[] }[]
        )[0].slots[0];

        // Unknown agent for this request.
        expect((await postBook(testEnv, rid, { token, ...slot, agentId: 12345 })).status).toBe(400);
        // Past slot.
        expect(
            (
                await postBook(testEnv, rid, {
                    token,
                    agentId: slot.agentId,
                    start: "2020-01-06T09:00:00.000Z",
                    end: "2020-01-06T09:30:00.000Z",
                })
            ).status,
        ).toBe(400);
        // Off-grid duration.
        expect(
            (
                await postBook(testEnv, rid, {
                    token,
                    agentId: slot.agentId,
                    start: "2026-10-06T09:00:00.000Z",
                    end: "2026-10-06T09:20:00.000Z",
                })
            ).status,
        ).toBe(400);
        // Grid-aligned but never offered (slots only offers 15/30/45/60).
        const marathon = await postBook(testEnv, rid, {
            token,
            agentId: slot.agentId,
            start: "2026-10-06T09:00:00.000Z",
            end: "2026-10-06T12:00:00.000Z",
        });
        expect(marathon.status).toBe(400);
        expect(marathon.json.error).toBe("invalid-slot");
        // Malformed JSON.
        const malformed = await worker.fetch(
            new Request(`https://portal.test/api/book/requests/${rid}/book`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "cf-connecting-ip": freshIp() },
                body: "{nope",
            }),
            testEnv,
        );
        expect(malformed.status).toBe(400);
    });

    it("requires a valid capability token", async () => {
        const testEnv = env();
        stubHalo();
        const { rid } = await mint(testEnv);
        expect((await postBook(testEnv, rid, { token: "junk", agentId: 7 })).status).toBe(401);
    });

    it("rejects slots outside dispatcher business hours", async () => {
        // 07:00Z Tuesday is 09:00 for a UTC+2 customer but 07:00 for a UTC
        // dispatcher: in-hours for the picker offset, out for the business.
        const body = {
            agentId: 7,
            start: "2026-10-06T07:00:00.000Z",
            end: "2026-10-06T07:30:00.000Z",
            utcOffset: 120,
        };
        const utcEnv = env();
        stubHalo();
        const utc = await mint(utcEnv, { dispatcherUtcOffset: 0 });
        const rejected = await postBook(utcEnv, utc.rid, { token: utc.token, ...body });
        expect(rejected.status).toBe(400);
        expect(rejected.json.error).toBe("invalid-slot");

        // Control: the same slot books when the dispatcher shares the offset.
        const localEnv = env();
        stubHalo();
        const local = await mint(localEnv, { dispatcherUtcOffset: 120 });
        const booked = await postBook(localEnv, local.rid, { token: local.token, ...body });
        expect(booked.status).toBe(201);
    });

    it("rejects bookings outside the agent's working hours", async () => {
        const testEnv = env();
        stubHalo({
            agents: [
                { id: 7, name: "Dana Dispatcher", workhour_start: 10, workhour_end: 12 },
                { id: 9, name: "Nina Booker" },
            ],
        });
        const { rid, token } = await mint(testEnv);
        const slots = await getSlots(testEnv, rid, token);
        type Slot = { agentId: number; start: string; end: string };
        const all = (slots.json.days as { slots: Slot[] }[]).flatMap((d) => d.slots);
        // A 09:00 fallback slot exists for agent 9; the same time is
        // outside agent 7's 10:00-12:00 window.
        const nine = all.find((s) => s.agentId === 9 && s.start.endsWith("T09:00:00.000Z"));
        expect(nine).toBeTruthy();
        const rejected = await postBook(testEnv, rid, {
            token,
            agentId: 7,
            start: nine!.start,
            end: nine!.end,
            utcOffset: 0,
        });
        expect(rejected.status).toBe(400);
        expect(rejected.json.error).toBe("invalid-slot");
    });
});

describe("public rate limiting at the router", () => {
    it("allows 30 then denies with 429, and records a KV timestamp", async () => {
        const testEnv = env();
        stubHalo();
        const { rid, token } = await mint(testEnv);
        const ip = freshIp();
        for (let i = 0; i < 30; i++) {
            const response = await getSlots(testEnv, rid, token, "", ip);
            expect(response.status).toBe(200);
        }
        const limited = await getSlots(testEnv, rid, token, "", ip);
        expect(limited.status).toBe(429);
        expect(limited.json.error).toBe("rate-limited");
        // A different IP is unaffected.
        expect((await getSlots(testEnv, rid, token)).status).toBe(200);
        // KV holds the cross-isolate counter/timestamp.
        expect(await testEnv.BOOKING_REQUESTS.get(`book:rl:${ip}`)).toBeTruthy();
    });
});
