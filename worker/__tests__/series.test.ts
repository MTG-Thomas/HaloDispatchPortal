// @vitest-environment node
import { describe, expect, it, vi, afterEach } from "vitest";
import worker, { MAX_SERIES_OCCURRENCES, type BookingEnv } from "../entry";
import { getBookingRequest } from "../kv";
import { verifyBookingToken } from "../token";
import { resetRateLimitsForTests } from "../ratelimit";
import { fakeKv } from "./fake-kv";

const SECRET = "test-secret-for-series";
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

let ipCounter = 1000;
function freshIp(): string {
    ipCounter += 1;
    return `10.11.0.${ipCounter % 250}`;
}

/** Next `count` weekday dates (UTC, YYYY-MM-DD), starting tomorrow. */
function nextWeekdays(count: number): string[] {
    const out: string[] = [];
    const day = new Date(Date.now() + 24 * 60 * 60 * 1000);
    day.setUTCHours(0, 0, 0, 0);
    while (out.length < count) {
        const weekday = day.getUTCDay();
        if (weekday !== 0 && weekday !== 6) {
            out.push(day.toISOString().slice(0, 10));
        }
        day.setUTCDate(day.getUTCDate() + 1);
    }
    return out;
}

interface HaloStub {
    appointments: unknown[];
    createdIds: number[];
    posts: { url: string; body: unknown }[];
}

function stubHalo(appointments: unknown[] = [], agents?: unknown[]): HaloStub {
    const stub: HaloStub = { appointments, createdIds: [], posts: [] };
    let nextId = 700;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (method === "POST" && url === `${AUTH}/token`) {
            return Response.json({ access_token: "refreshed-access", expires_in: 3600 });
        }
        if (method === "POST" && url === `${RESOURCE}/api/appointment`) {
            stub.posts.push({ url, body: JSON.parse((init?.body as string) ?? "null") });
            nextId += 1;
            stub.createdIds.push(nextId);
            return Response.json([{ id: nextId }]);
        }
        if (url.includes("/api/agent")) {
            return Response.json(
                agents ?? [
                    { id: 7, name: "Dana Dispatcher" },
                    { id: 9, name: "Nina Booker" },
                ],
            );
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
): Promise<{ status: number; json: Record<string, unknown> }> {
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
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

async function getSlots(
    testEnv: BookingEnv,
    rid: string,
    token: string,
    query = "",
): Promise<{ status: number; json: Record<string, unknown> }> {
    const response = await worker.fetch(
        new Request(
            `https://portal.test/api/book/requests/${rid}/slots?token=${encodeURIComponent(token)}${query}`,
            { headers: { "cf-connecting-ip": freshIp() } },
        ),
        testEnv,
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
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

interface SlotPick {
    agentId: number;
    start: string;
    end: string;
}

describe("series mint", () => {
    it("accepts occurrences and carries them on the record and token", async () => {
        const testEnv = env();
        const dates = nextWeekdays(2);
        const { status, json } = await mint(testEnv, { occurrences: dates });
        expect(status).toBe(201);
        await expect(
            getBookingRequest(testEnv.BOOKING_REQUESTS, String(json.rid)),
        ).resolves.toMatchObject({ occurrences: dates });
        const verified = await verifyBookingToken(String(json.token), SECRET);
        expect(verified).toMatchObject({ ok: true, payload: { occurrences: dates } });
    });

    it("accepts dates as an alias and sorts the stored occurrences", async () => {
        const testEnv = env();
        const [first, second] = nextWeekdays(2);
        const { status, json } = await mint(testEnv, { dates: [second, first] });
        expect(status).toBe(201);
        await expect(
            getBookingRequest(testEnv.BOOKING_REQUESTS, String(json.rid)),
        ).resolves.toMatchObject({ occurrences: [first, second] });
    });

    it.each([
        ["empty array", []],
        [
            "too many",
            Array.from(
                { length: MAX_SERIES_OCCURRENCES + 1 },
                (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`,
            ),
        ],
        ["bad shape", ["2026-10-06", "not-a-date"]],
        ["impossible date", ["2026-02-30"]],
        ["duplicates", ["2026-10-06", "2026-10-06"]],
        ["not an array", "2026-10-06"],
    ])("rejects %s with 400", async (_label, occurrences) => {
        const { status, json } = await mint(env(), { occurrences });
        expect(status).toBe(400);
        expect(json.error).toBe("Invalid booking request");
        expect(json.details).toContain(
            `occurrences must be an array of 1-${MAX_SERIES_OCCURRENCES} unique YYYY-MM-DD dates`,
        );
    });

    it("still mints single-book requests without occurrences", async () => {
        const testEnv = env();
        const { status, json } = await mint(testEnv);
        expect(status).toBe(201);
        const record = await getBookingRequest(testEnv.BOOKING_REQUESTS, String(json.rid));
        expect(record?.occurrences).toBeUndefined();
    });
});

describe("series slots offer", () => {
    it("offers per-occurrence options for each requested date", async () => {
        const testEnv = env();
        stubHalo();
        const dates = nextWeekdays(3);
        const { json: minted } = await mint(testEnv, { occurrences: dates });
        const rid = String(minted.rid);
        const token = String(minted.token);

        const { status, json } = await getSlots(testEnv, rid, token);
        expect(status).toBe(200);
        const occurrences = json.occurrences as { date: string; slots: SlotPick[] }[];
        expect(occurrences.map((o) => o.date)).toEqual(dates);
        for (const entry of occurrences) {
            expect(entry.slots.length).toBeGreaterThan(0);
            for (const slot of entry.slots) {
                // Every offered option sits on its occurrence date (UTC picker).
                expect(slot.start.slice(0, 10)).toBe(entry.date);
            }
        }
        // The single-book grid stays intact alongside the series grouping.
        expect(Array.isArray(json.days)).toBe(true);
        expect((json.days as unknown[]).length).toBeGreaterThan(0);
    });

    it("omits the occurrences grouping for single-book requests", async () => {
        const testEnv = env();
        stubHalo();
        const { json: minted } = await mint(testEnv);
        const { status, json } = await getSlots(testEnv, String(minted.rid), String(minted.token));
        expect(status).toBe(200);
        expect(json).not.toHaveProperty("occurrences");
    });
});

describe("series book", () => {
    async function seriesLink(
        testEnv: BookingEnv,
        count = 2,
    ): Promise<{ rid: string; token: string; dates: string[] }> {
        const dates = nextWeekdays(count);
        const { json } = await mint(testEnv, { occurrences: dates });
        return { rid: String(json.rid), token: String(json.token), dates };
    }

    async function occurrencePicks(
        testEnv: BookingEnv,
        rid: string,
        token: string,
    ): Promise<{ date: string; slot: SlotPick }[]> {
        const { json } = await getSlots(testEnv, rid, token);
        const occurrences = json.occurrences as { date: string; slots: SlotPick[] }[];
        return occurrences.map((o) => ({ date: o.date, slot: o.slots[0] }));
    }

    it("confirms N appointments and reports per-occurrence results", async () => {
        const testEnv = env();
        const stub = stubHalo();
        const { rid, token } = await seriesLink(testEnv);
        const picks = await occurrencePicks(testEnv, rid, token);

        const { status, json } = await postBook(testEnv, rid, {
            token,
            bookings: picks.map((p) => ({ ...p.slot, occurrence: p.date })),
            utcOffset: 0,
        });
        expect(status).toBe(201);
        expect(json.rid).toBe(rid);
        expect(json.appointmentIds).toEqual([701, 702]);
        const results = json.results as Record<string, unknown>[];
        expect(results).toHaveLength(2);
        expect(results[0]).toMatchObject({ index: 0, ok: true, appointmentId: 701 });
        expect(results[1]).toMatchObject({ index: 1, ok: true, appointmentId: 702 });
        expect(stub.posts).toHaveLength(2);

        const record = await getBookingRequest(testEnv.BOOKING_REQUESTS, rid);
        expect(record?.status).toBe("booked");
        expect(record?.bookedAppointmentIds).toEqual([701, 702]);
        // First-id mirror keeps single-book replay readers working.
        expect(record?.bookedAppointmentId).toBe(701);

        const replay = await postBook(testEnv, rid, {
            token,
            bookings: picks.map((p) => ({ ...p.slot, occurrence: p.date })),
            utcOffset: 0,
        });
        expect(replay.status).toBe(409);
        expect(replay.json).toMatchObject({
            error: "already-booked",
            appointmentId: 701,
            appointmentIds: [701, 702],
        });
        expect(stub.posts).toHaveLength(2);
    });

    it("books best-effort with partial-failure reporting (207)", async () => {
        const testEnv = env();
        const stub = stubHalo();
        const { rid, token } = await seriesLink(testEnv);
        const picks = await occurrencePicks(testEnv, rid, token);
        const first = picks[0].slot;

        // The same slot twice under a mismatched occurrence label: the
        // second selection fails occurrence binding per item.
        const { status, json } = await postBook(testEnv, rid, {
            token,
            bookings: [
                { ...first, occurrence: picks[0].date },
                { ...first, occurrence: picks[1].date },
            ],
            utcOffset: 0,
        });
        expect(status).toBe(207);
        expect(json.appointmentIds).toEqual([701]);
        const results = json.results as Record<string, unknown>[];
        expect(results).toHaveLength(2);
        expect(results[0]).toMatchObject({ index: 0, ok: true, appointmentId: 701 });
        expect(results[1]).toMatchObject({ index: 1, ok: false, error: "invalid-slot" });
        expect(stub.posts).toHaveLength(1);

        const record = await getBookingRequest(testEnv.BOOKING_REQUESTS, rid);
        expect(record?.status).toBe("booked");
        expect(record?.bookedAppointmentIds).toEqual([701]);
    });

    it("keeps the record pending when every occurrence fails", async () => {
        const testEnv = env();
        const stub = stubHalo();
        const { rid, token } = await seriesLink(testEnv);
        const picks = await occurrencePicks(testEnv, rid, token);

        const { status, json } = await postBook(testEnv, rid, {
            token,
            // Unknown agents: per-item invalid-slot, no Halo creates.
            bookings: picks.map((p) => ({
                agentId: 12345,
                start: p.slot.start,
                end: p.slot.end,
                occurrence: p.date,
            })),
            utcOffset: 0,
        });
        expect(status).toBe(400);
        expect(json.error).toBe("invalid-slot");
        const results = json.results as Record<string, unknown>[];
        expect(results).toHaveLength(2);
        expect(results.every((r) => r.ok === false && r.error === "invalid-slot")).toBe(true);
        expect(stub.posts).toHaveLength(0);
        expect((await getBookingRequest(testEnv.BOOKING_REQUESTS, rid))?.status).toBe("pending");
    });

    it("reports taken slots per occurrence when Halo shows them busy", async () => {
        const testEnv = env();
        stubHalo();
        const { rid, token } = await seriesLink(testEnv);
        const picks = await occurrencePicks(testEnv, rid, token);
        const busy = picks[0].slot;

        const stub = stubHalo([
            {
                id: 1,
                agent_id: busy.agentId,
                start_date: busy.start.replace("Z", ""),
                end_date: busy.end.replace("Z", ""),
                allday: false,
            },
        ]);
        const { status, json } = await postBook(testEnv, rid, {
            token,
            bookings: picks.map((p, i) =>
                i === 0 ? { ...busy, occurrence: p.date } : { ...p.slot, occurrence: p.date },
            ),
            utcOffset: 0,
        });
        expect(status).toBe(207);
        const results = json.results as Record<string, unknown>[];
        expect(results[0]).toMatchObject({ index: 0, ok: false, error: "slot-taken" });
        expect(results[1]).toMatchObject({ index: 1, ok: true });
        expect(stub.posts).toHaveLength(1);
    });

    it("rejects single-slot bodies on series links", async () => {
        const testEnv = env();
        const stub = stubHalo();
        const { rid, token } = await seriesLink(testEnv);
        const picks = await occurrencePicks(testEnv, rid, token);

        const { status, json } = await postBook(testEnv, rid, {
            token,
            ...picks[0].slot,
            utcOffset: 0,
        });
        expect(status).toBe(400);
        expect(json.error).toBe("invalid-request");
        expect(stub.posts).toHaveLength(0);
        expect((await getBookingRequest(testEnv.BOOKING_REQUESTS, rid))?.status).toBe("pending");
    });

    it("rejects series bodies on single-book links", async () => {
        const testEnv = env();
        const stub = stubHalo();
        const { json: minted } = await mint(testEnv);
        const rid = String(minted.rid);
        const token = String(minted.token);
        const { json: slots } = await getSlots(testEnv, rid, token);
        const days = slots.days as { slots: SlotPick[] }[];
        const first = days[0].slots[0];
        const second = days[1].slots[0];

        // A single-book capability must not authorize N appointments.
        const { status, json } = await postBook(testEnv, rid, {
            token,
            bookings: [first, second],
            utcOffset: 0,
        });
        expect(status).toBe(400);
        expect(json.error).toBe("invalid-request");
        expect(stub.posts).toHaveLength(0);
        expect((await getBookingRequest(testEnv.BOOKING_REQUESTS, rid))?.status).toBe("pending");
    });

    it("rejects surplus selections beyond the issued occurrences", async () => {
        const testEnv = env();
        const stub = stubHalo();
        const { rid, token } = await seriesLink(testEnv, 2);
        const picks = await occurrencePicks(testEnv, rid, token);

        const { status, json } = await postBook(testEnv, rid, {
            token,
            bookings: [
                { ...picks[0].slot, occurrence: picks[0].date },
                { ...picks[1].slot, occurrence: picks[1].date },
                { ...picks[0].slot, occurrence: picks[0].date },
            ],
            utcOffset: 0,
        });
        expect(status).toBe(400);
        expect(json.error).toBe("invalid-request");
        expect(stub.posts).toHaveLength(0);
        expect((await getBookingRequest(testEnv.BOOKING_REQUESTS, rid))?.status).toBe("pending");
    });

    it("fails unknown and duplicate occurrences per item", async () => {
        const testEnv = env();
        const stub = stubHalo();
        const { rid, token } = await seriesLink(testEnv, 2);
        const picks = await occurrencePicks(testEnv, rid, token);

        const { status, json } = await postBook(testEnv, rid, {
            token,
            bookings: [
                { ...picks[0].slot, occurrence: picks[0].date },
                // Well-formed but outside the issued occurrence set
                // (far-future so it can never coincide with issued dates).
                {
                    agentId: 7,
                    start: "2031-06-15T10:00:00.000Z",
                    end: "2031-06-15T10:30:00.000Z",
                    occurrence: "2031-06-15",
                },
            ],
            utcOffset: 0,
        });
        expect(status).toBe(207);
        const results = json.results as Record<string, unknown>[];
        expect(results[0]).toMatchObject({ index: 0, ok: true });
        expect(results[1]).toMatchObject({ index: 1, ok: false, error: "invalid-slot" });
        expect(stub.posts).toHaveLength(1);
    });

    it("fails a repeated occurrence per item", async () => {
        const testEnv = env();
        const stub = stubHalo();
        const { rid, token } = await seriesLink(testEnv, 2);
        const picks = await occurrencePicks(testEnv, rid, token);

        const { status, json } = await postBook(testEnv, rid, {
            token,
            bookings: [
                { ...picks[0].slot, occurrence: picks[0].date },
                { ...picks[0].slot, occurrence: picks[0].date },
            ],
            utcOffset: 0,
        });
        expect(status).toBe(207);
        const results = json.results as Record<string, unknown>[];
        expect(results[0]).toMatchObject({ index: 0, ok: true });
        expect(results[1]).toMatchObject({ index: 1, ok: false, error: "invalid-slot" });
        expect(stub.posts).toHaveLength(1);
    });

    it("validates series selections against agent schedules and buffers", async () => {
        const testEnv = env();
        const dates = nextWeekdays(2);
        const [d0, d1] = dates;
        // Agent 7 works 10:00-12:00 only; agent 9 keeps defaults. Agent 9
        // is busy 10:00-10:30 on the second date; the link buffers 30m.
        const stub = stubHalo(
            [
                {
                    id: 1,
                    agent_id: 9,
                    start_date: `${d1}T10:00:00.000`,
                    end_date: `${d1}T10:30:00.000`,
                    allday: false,
                },
            ],
            [
                { id: 7, name: "Dana Dispatcher", workhour_start: 10, workhour_end: 12 },
                { id: 9, name: "Nina Booker" },
            ],
        );
        const { json: minted } = await mint(testEnv, { occurrences: dates, bufferMin: 30 });
        const rid = String(minted.rid);
        const token = String(minted.token);

        const { status, json } = await postBook(testEnv, rid, {
            token,
            bookings: [
                // Outside agent 7's custom window.
                {
                    agentId: 7,
                    start: `${d0}T09:00:00.000Z`,
                    end: `${d0}T09:30:00.000Z`,
                    occurrence: d0,
                },
                // Back-to-back with the busy block: the buffer takes it.
                {
                    agentId: 9,
                    start: `${d1}T10:30:00.000Z`,
                    end: `${d1}T11:00:00.000Z`,
                    occurrence: d1,
                },
            ],
            utcOffset: 0,
        });
        expect(status).toBe(409);
        expect(json.error).toBe("slot-taken");
        const results = json.results as Record<string, unknown>[];
        expect(results[0]).toMatchObject({ index: 0, ok: false, error: "invalid-slot" });
        expect(results[1]).toMatchObject({ index: 1, ok: false, error: "slot-taken" });
        expect(stub.posts).toHaveLength(0);
        expect((await getBookingRequest(testEnv.BOOKING_REQUESTS, rid))?.status).toBe("pending");
    });

    it("validates the bookings array shape", async () => {
        const testEnv = env();
        stubHalo();
        const { rid, token } = await seriesLink(testEnv);
        for (const bookings of [
            [],
            "nope",
            [{ agentId: 7 }],
            [{ agentId: 7, start: "x", end: "y" }],
        ]) {
            const { status, json } = await postBook(testEnv, rid, { token, bookings });
            expect(status).toBe(400);
            expect(json.error).toBe("invalid-request");
        }
        expect((await getBookingRequest(testEnv.BOOKING_REQUESTS, rid))?.status).toBe("pending");
    });
});
