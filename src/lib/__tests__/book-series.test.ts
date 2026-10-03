import { describe, it, expect, vi, afterEach } from "vitest";
import {
    BookApiError,
    confirmBookingSeries,
    fetchBookingRequests,
    fetchBookSlots,
    mintBookingRequest,
    resendBookingRequest,
    type BookingRequestSummary,
    type BookSeriesResult,
} from "../book-api";

function makeToken(rid: string): string {
    const payload = btoa(JSON.stringify({ rid, ticketId: 42, agentIds: [7], exp: 9999999999 }))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    return `${payload}.fakesignature`;
}

const TOKEN = makeToken("rid-series-1");
const SESSION = "test-session-id";

function mockFetchOnce(status: number, body: unknown) {
    const impl = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", impl);
    return impl;
}

function summary(overrides: Partial<BookingRequestSummary> = {}): BookingRequestSummary {
    return {
        rid: "rid-1",
        status: "pending",
        ticketId: 42,
        agentIds: [7],
        appointmentTypeId: 3,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        exp: 9_999_999_999,
        clickedAt: null,
        bookedAppointmentId: null,
        viewCount: 0,
        ...overrides,
    };
}

function seriesResult(overrides: Partial<BookSeriesResult> = {}): BookSeriesResult {
    return {
        index: 0,
        occurrence: "2026-10-06",
        ok: true,
        appointmentId: 701,
        error: null,
        agentId: 7,
        start: "2026-10-06T13:00:00.000Z",
        end: "2026-10-06T13:30:00.000Z",
        ...overrides,
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("series mint", () => {
    it("sends occurrences for a series request", async () => {
        const impl = mockFetchOnce(201, {
            rid: "rid-9",
            token: "tok-9",
            expiresAt: "2026-10-10T00:00:00.000Z",
        });
        await mintBookingRequest({
            ticketId: 42,
            agentIds: [7],
            appointmentTypeId: 3,
            sessionId: SESSION,
            occurrences: ["2026-10-06", "2026-10-13"],
        });
        const [, init] = impl.mock.calls[0] as unknown as [string, RequestInit];
        expect(JSON.parse(init.body as string)).toMatchObject({
            occurrences: ["2026-10-06", "2026-10-13"],
        });
    });

    it("omits occurrences for single-book mints", async () => {
        const impl = mockFetchOnce(201, {
            rid: "rid-9",
            token: "tok-9",
            expiresAt: "2026-10-10T00:00:00.000Z",
        });
        await mintBookingRequest({
            ticketId: 42,
            agentIds: [7],
            appointmentTypeId: 3,
            sessionId: SESSION,
        });
        const [, init] = impl.mock.calls[0] as unknown as [string, RequestInit];
        expect(JSON.parse(init.body as string)).not.toHaveProperty("occurrences");
    });

    it("carries occurrences forward on resend", async () => {
        const fresh = { rid: "rid-new", token: "tok-new", expiresAt: "2026-10-10T00:00:00.000Z" };
        const impl = vi.fn();
        impl.mockResolvedValueOnce(new Response(JSON.stringify(fresh), { status: 201 }));
        impl.mockResolvedValueOnce(
            new Response(JSON.stringify(summary({ status: "cancelled" })), { status: 200 }),
        );
        vi.stubGlobal("fetch", impl);
        await resendBookingRequest({
            previous: summary({ occurrences: ["2026-10-06", "2026-10-13"] }),
            sessionId: SESSION,
        });
        const [, mintInit] = impl.mock.calls[0] as unknown as [string, RequestInit];
        expect(JSON.parse(mintInit.body as string)).toMatchObject({
            occurrences: ["2026-10-06", "2026-10-13"],
        });
    });
});

describe("series slots offer", () => {
    it("parses per-occurrence options", async () => {
        const body = {
            rid: "rid-series-1",
            ticketId: 42,
            appointmentTypeId: 3,
            expiresAt: "2026-10-10T00:00:00.000Z",
            firstView: false,
            agents: [{ id: 7, name: "Dana" }],
            days: [{ date: "2026-10-06", slots: [{ agentId: 7, start: "s", end: "e" }] }],
            durationMin: 30,
            utcOffset: 0,
            occurrences: [
                { date: "2026-10-06", slots: [{ agentId: 7, start: "s", end: "e" }] },
                { date: "2026-10-13", slots: [] },
            ],
        };
        mockFetchOnce(200, body);
        const result = await fetchBookSlots({ token: TOKEN });
        expect(result).toEqual(body);
        expect(result.occurrences).toHaveLength(2);
    });
});

describe("series confirm", () => {
    const bookings = [
        {
            agentId: 7,
            start: "2026-10-06T13:00:00.000Z",
            end: "2026-10-06T13:30:00.000Z",
            occurrence: "2026-10-06",
        },
        {
            agentId: 7,
            start: "2026-10-13T13:00:00.000Z",
            end: "2026-10-13T13:30:00.000Z",
            occurrence: "2026-10-13",
        },
    ];

    it("POSTs the bookings array and parses the all-ok envelope", async () => {
        const envelope = {
            rid: "rid-series-1",
            appointmentIds: [701, 702],
            results: [seriesResult(), seriesResult({ index: 1, appointmentId: 702 })],
        };
        const impl = mockFetchOnce(201, envelope);
        const result = await confirmBookingSeries({ token: TOKEN, bookings, utcOffset: -300 });
        expect(result).toEqual(envelope);
        const [url, init] = impl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/api/book/requests/rid-series-1/book");
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body as string)).toEqual({
            token: TOKEN,
            bookings,
            utcOffset: -300,
        });
    });

    it("resolves partial success (207) with per-occurrence results", async () => {
        const envelope = {
            rid: "rid-series-1",
            appointmentIds: [701],
            results: [
                seriesResult(),
                seriesResult({
                    index: 1,
                    occurrence: "2026-10-13",
                    ok: false,
                    appointmentId: null,
                    error: "slot-taken",
                }),
            ],
        };
        mockFetchOnce(207, envelope);
        const result = await confirmBookingSeries({ token: TOKEN, bookings });
        expect(result.appointmentIds).toEqual([701]);
        expect(result.results[1]).toMatchObject({ ok: false, error: "slot-taken" });
    });

    it("carries per-occurrence results on total-failure errors", async () => {
        const results = [
            seriesResult({ ok: false, appointmentId: null, error: "slot-taken" }),
            seriesResult({
                index: 1,
                occurrence: "2026-10-13",
                ok: false,
                appointmentId: null,
                error: "slot-taken",
            }),
        ];
        mockFetchOnce(409, { error: "slot-taken", rid: "rid-series-1", results });
        const error = await confirmBookingSeries({ token: TOKEN, bookings }).catch(
            (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(BookApiError);
        expect((error as BookApiError).code).toBe("slot-taken");
        expect((error as BookApiError).seriesResults).toEqual(results);
    });

    it("throws invalid-token without fetching for malformed tokens", async () => {
        const impl = vi.fn(async () => new Response("{}", { status: 200 }));
        vi.stubGlobal("fetch", impl);
        await expect(confirmBookingSeries({ token: "junk", bookings })).rejects.toMatchObject({
            code: "invalid-token",
        });
        expect(impl).not.toHaveBeenCalled();
    });

    it("rejects malformed success bodies", async () => {
        mockFetchOnce(201, { rid: "rid-series-1" });
        await expect(confirmBookingSeries({ token: TOKEN, bookings })).rejects.toMatchObject({
            code: "network-error",
        });
    });
});

describe("series tracking rows", () => {
    it("parses occurrences and booked ids", async () => {
        const row = {
            ...summary(),
            occurrences: ["2026-10-06", "2026-10-13"],
            bookedAppointmentIds: [701, 702],
        };
        mockFetchOnce(200, { requests: [row] });
        const [parsed] = await fetchBookingRequests(SESSION);
        expect(parsed).toEqual(row);
    });

    it("drops malformed extras but keeps the row", async () => {
        mockFetchOnce(200, {
            requests: [{ ...summary(), occurrences: "nope", bookedAppointmentIds: [701, "x"] }],
        });
        const [parsed] = await fetchBookingRequests(SESSION);
        expect(parsed).toEqual(summary());
    });
});
