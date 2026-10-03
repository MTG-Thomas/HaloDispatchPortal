import { describe, it, expect, vi, afterEach } from "vitest";
import {
    BookApiError,
    BookingTrackerError,
    bookingDisplayStatus,
    cancelBookingRequest,
    confirmBooking,
    decodeBookingTokenRid,
    fetchBookingRequests,
    fetchBookingStatus,
    fetchBookSlots,
    isBookingOpen,
    mintBookingRequest,
    resendBookingRequest,
    type BookingRequestSummary,
} from "../book-api";

function makeToken(rid: string): string {
    const payload = btoa(JSON.stringify({ rid, ticketId: 42, agentIds: [7], exp: 9999999999 }))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    return `${payload}.fakesignature`;
}

const TOKEN = makeToken("rid-test-1");

function mockFetchOnce(status: number, body: unknown) {
    const impl = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", impl);
    return impl;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("decodeBookingTokenRid", () => {
    it("extracts the rid from a well-formed token", () => {
        expect(decodeBookingTokenRid(TOKEN)).toBe("rid-test-1");
    });

    it.each(["", "not-a-token", ".sig", "!!!.sig", `${btoa("nope")}.sig`])(
        "rejects malformed tokens: %s",
        (bad) => {
            expect(() => decodeBookingTokenRid(bad)).toThrowError(BookApiError);
            try {
                decodeBookingTokenRid(bad);
            } catch (error) {
                expect((error as BookApiError).code).toBe("invalid-token");
            }
        },
    );

    it("rejects payloads without an rid", () => {
        const token = `${btoa(JSON.stringify({ ticketId: 1 })).replace(/=+$/, "")}.sig`;
        expect(() => decodeBookingTokenRid(token)).toThrowError(BookApiError);
    });
});

describe("fetchBookSlots", () => {
    const slotsBody = {
        rid: "rid-test-1",
        ticketId: 42,
        appointmentTypeId: 3,
        expiresAt: "2026-10-10T00:00:00.000Z",
        firstView: true,
        agents: [{ id: 7, name: "Dana" }],
        days: [{ date: "2026-10-06", slots: [{ agentId: 7, start: "s", end: "e" }] }],
        durationMin: 30,
        utcOffset: 0,
    };

    it("GETs the slots endpoint with the token query param", async () => {
        const impl = mockFetchOnce(200, slotsBody);
        const result = await fetchBookSlots({ token: TOKEN, days: 7, utcOffset: -300 });
        expect(result).toEqual(slotsBody);
        expect(impl).toHaveBeenCalledOnce();
        const [url] = impl.mock.calls[0] as unknown as [string];
        expect(url).toContain("/api/book/requests/rid-test-1/slots?");
        expect(url).toContain(`token=${encodeURIComponent(TOKEN)}`);
        expect(url).toContain("days=7");
        expect(url).toContain("utcOffset=-300");
    });

    it.each([
        [401, { error: "invalid-token" }, "invalid-token"],
        [410, { error: "expired" }, "expired"],
        [410, { error: "cancelled" }, "cancelled"],
        [410, {}, "expired"],
        [409, { error: "already-booked", appointmentId: 99 }, "already-booked"],
        [429, { error: "rate-limited" }, "rate-limited"],
        [502, { error: "halo-unavailable" }, "halo-unavailable"],
        [503, { error: "booking-unavailable" }, "booking-unavailable"],
        [400, { error: "invalid-request" }, "invalid-request"],
        [500, {}, "network-error"],
    ])("maps %s %j to %s", async (status, body, code) => {
        mockFetchOnce(status as number, body);
        const error = await fetchBookSlots({ token: TOKEN }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(BookApiError);
        expect((error as BookApiError).code).toBe(code);
    });

    it("carries the appointment id on already-booked", async () => {
        mockFetchOnce(409, { error: "already-booked", appointmentId: 99 });
        const error = await fetchBookSlots({ token: TOKEN }).catch((e: unknown) => e);
        expect((error as BookApiError).appointmentId).toBe(99);
    });

    it("throws invalid-token without fetching for malformed tokens", async () => {
        const impl = vi.fn(async () => new Response("{}", { status: 200 }));
        vi.stubGlobal("fetch", impl);
        await expect(fetchBookSlots({ token: "junk" })).rejects.toMatchObject({
            code: "invalid-token",
        });
        expect(impl).not.toHaveBeenCalled();
    });

    it("maps transport failures to network-error", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new TypeError("fetch failed");
            }),
        );
        await expect(fetchBookSlots({ token: TOKEN })).rejects.toMatchObject({
            code: "network-error",
        });
    });

    it("rejects malformed success bodies", async () => {
        mockFetchOnce(200, { nope: true });
        await expect(fetchBookSlots({ token: TOKEN })).rejects.toMatchObject({
            code: "network-error",
        });
    });
});

describe("confirmBooking", () => {
    const confirmBody = {
        rid: "rid-test-1",
        appointmentId: 555,
        agentId: 7,
        start: "2026-10-06T13:00:00.000Z",
        end: "2026-10-06T13:30:00.000Z",
    };

    it("POSTs the booking with token, agent, and slot", async () => {
        const impl = mockFetchOnce(201, confirmBody);
        const result = await confirmBooking({
            token: TOKEN,
            agentId: 7,
            start: confirmBody.start,
            end: confirmBody.end,
            utcOffset: -300,
        });
        expect(result).toEqual(confirmBody);
        expect(impl).toHaveBeenCalledOnce();
        const [url, init] = impl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/api/book/requests/rid-test-1/book");
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body as string)).toEqual({
            token: TOKEN,
            agentId: 7,
            start: confirmBody.start,
            end: confirmBody.end,
            utcOffset: -300,
        });
    });

    it.each([
        [409, { error: "already-booked", appointmentId: 555 }, "already-booked"],
        [409, { error: "slot-taken" }, "slot-taken"],
        [400, { error: "invalid-slot" }, "invalid-slot"],
        [410, { error: "expired" }, "expired"],
        [429, { error: "rate-limited" }, "rate-limited"],
    ])("maps %s %j to %s", async (status, body, code) => {
        mockFetchOnce(status as number, body);
        const error = await confirmBooking({
            token: TOKEN,
            agentId: 7,
            start: "2026-10-06T13:00:00.000Z",
            end: "2026-10-06T13:30:00.000Z",
        }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(BookApiError);
        expect((error as BookApiError).code).toBe(code);
    });

    it("maps transport failures to network-error", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new TypeError("fetch failed");
            }),
        );
        await expect(
            confirmBooking({ token: TOKEN, agentId: 7, start: "s", end: "e" }),
        ).rejects.toMatchObject({ code: "network-error" });
    });
});

describe("dispatcher tracking", () => {
    const ACCESS = "test-access-token";

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
            ...overrides,
        };
    }

    function authHeader(init: RequestInit): string | null {
        return (init.headers as Headers).get("Authorization");
    }

    describe("bookingDisplayStatus", () => {
        it("maps pending without a view to sent", () => {
            expect(bookingDisplayStatus(summary())).toBe("sent");
        });

        it("maps pending with a view to clicked", () => {
            expect(bookingDisplayStatus(summary({ clickedAt: "2026-10-02T00:00:00.000Z" }))).toBe(
                "clicked",
            );
        });

        it("maps stale pending snapshots to expired", () => {
            expect(bookingDisplayStatus(summary({ exp: 1 }))).toBe("expired");
            expect(
                bookingDisplayStatus(summary({ exp: 1, clickedAt: "2026-10-02T00:00:00.000Z" })),
            ).toBe("expired");
        });

        it("maps terminal worker states", () => {
            expect(bookingDisplayStatus(summary({ status: "booked" }))).toBe("booked");
            expect(bookingDisplayStatus(summary({ status: "cancelled" }))).toBe("canceled");
            expect(bookingDisplayStatus(summary({ status: "expired" }))).toBe("expired");
        });

        it("treats only sent/clicked as open", () => {
            expect(isBookingOpen(summary())).toBe(true);
            expect(isBookingOpen(summary({ clickedAt: "2026-10-02T00:00:00.000Z" }))).toBe(true);
            expect(isBookingOpen(summary({ status: "booked" }))).toBe(false);
            expect(isBookingOpen(summary({ status: "cancelled" }))).toBe(false);
            expect(isBookingOpen(summary({ status: "expired" }))).toBe(false);
            expect(isBookingOpen(summary({ exp: 1 }))).toBe(false);
        });
    });

    describe("fetchBookingRequests", () => {
        it("GETs the list with the dispatcher header", async () => {
            const rows = [summary(), summary({ rid: "rid-2", ticketId: 43 })];
            const impl = mockFetchOnce(200, { requests: rows });
            const result = await fetchBookingRequests(ACCESS);
            expect(result).toEqual(rows);
            const [url, init] = impl.mock.calls[0] as unknown as [string, RequestInit];
            expect(url).toBe("/api/book/requests");
            expect(authHeader(init)).toBe(`Bearer ${ACCESS}`);
        });

        it("skips malformed rows instead of failing", async () => {
            mockFetchOnce(200, { requests: [summary(), { nope: true }, null] });
            const result = await fetchBookingRequests(ACCESS);
            expect(result).toEqual([summary()]);
        });

        it("rejects a non-list envelope", async () => {
            mockFetchOnce(200, { requests: "nope" });
            await expect(fetchBookingRequests(ACCESS)).rejects.toMatchObject({
                code: "network-error",
            });
        });

        it("maps 401 to unauthorized", async () => {
            mockFetchOnce(401, { error: "Unauthorized" });
            await expect(fetchBookingRequests(ACCESS)).rejects.toMatchObject({
                code: "unauthorized",
            });
        });

        it("maps transport failures to network-error", async () => {
            vi.stubGlobal(
                "fetch",
                vi.fn(async () => {
                    throw new TypeError("fetch failed");
                }),
            );
            await expect(fetchBookingRequests(ACCESS)).rejects.toMatchObject({
                code: "network-error",
            });
        });
    });

    describe("fetchBookingStatus", () => {
        it("GETs one request's status", async () => {
            const impl = mockFetchOnce(200, summary());
            const result = await fetchBookingStatus("rid-1", ACCESS);
            expect(result).toEqual(summary());
            const [url] = impl.mock.calls[0] as unknown as [string];
            expect(url).toBe("/api/book/requests/rid-1/status");
        });

        it("maps 404 to not-found", async () => {
            mockFetchOnce(404, { error: "Booking request not found" });
            await expect(fetchBookingStatus("rid-x", ACCESS)).rejects.toMatchObject({
                code: "not-found",
            });
        });
    });

    describe("cancelBookingRequest", () => {
        it("POSTs the cancel and returns the terminal state", async () => {
            const terminal = summary({ status: "cancelled" });
            const impl = mockFetchOnce(200, terminal);
            const result = await cancelBookingRequest("rid-1", ACCESS);
            expect(result).toEqual(terminal);
            const [url, init] = impl.mock.calls[0] as unknown as [string, RequestInit];
            expect(url).toBe("/api/book/requests/rid-1/cancel");
            expect(init.method).toBe("POST");
        });

        it("carries the current state on 409", async () => {
            const terminal = summary({ status: "cancelled" });
            mockFetchOnce(409, { error: "Booking request is already final", ...terminal });
            const error = await cancelBookingRequest("rid-1", ACCESS).catch((e: unknown) => e);
            expect(error).toBeInstanceOf(BookingTrackerError);
            expect((error as BookingTrackerError).code).toBe("conflict");
            expect((error as BookingTrackerError).current).toEqual(terminal);
        });
    });

    describe("mintBookingRequest", () => {
        const pair = { access_token: "a", refresh_token: "r" };

        it("POSTs the mint body and returns the link", async () => {
            const impl = mockFetchOnce(201, {
                rid: "rid-9",
                token: "tok-9",
                expiresAt: "2026-10-10T00:00:00.000Z",
            });
            const result = await mintBookingRequest({
                ticketId: 42,
                agentIds: [7],
                appointmentTypeId: 3,
                haloTokenPair: pair,
            });
            expect(result).toEqual({
                rid: "rid-9",
                token: "tok-9",
                expiresAt: "2026-10-10T00:00:00.000Z",
            });
            const [url, init] = impl.mock.calls[0] as unknown as [string, RequestInit];
            expect(url).toBe("/api/book/requests");
            expect(JSON.parse(init.body as string)).toEqual({
                ticketId: 42,
                agentIds: [7],
                appointmentTypeId: 3,
                haloTokenPair: pair,
                dispatcherUtcOffset: -new Date().getTimezoneOffset(),
            });
        });

        it("sends an explicit dispatcher offset when provided", async () => {
            const impl = mockFetchOnce(201, {
                rid: "rid-9",
                token: "tok-9",
                expiresAt: "2026-10-10T00:00:00.000Z",
            });
            await mintBookingRequest({
                ticketId: 42,
                agentIds: [7],
                appointmentTypeId: 3,
                haloTokenPair: pair,
                dispatcherUtcOffset: -300,
            });
            const [, init] = impl.mock.calls[0] as unknown as [string, RequestInit];
            expect(JSON.parse(init.body as string)).toMatchObject({
                dispatcherUtcOffset: -300,
            });
        });

        it("keeps the server message on 400", async () => {
            mockFetchOnce(400, { error: "Invalid booking request" });
            const error = await mintBookingRequest({
                ticketId: 0,
                agentIds: [],
                appointmentTypeId: 0,
                haloTokenPair: pair,
            }).catch((e: unknown) => e);
            expect(error).toBeInstanceOf(BookingTrackerError);
            expect((error as BookingTrackerError).code).toBe("invalid-request");
            expect((error as BookingTrackerError).message).toBe("Invalid booking request");
        });
    });

    describe("resendBookingRequest", () => {
        const pair = { access_token: "a", refresh_token: "r" };
        const fresh = { rid: "rid-new", token: "tok-new", expiresAt: "2026-10-10T00:00:00.000Z" };

        function mockSequence(first: Response, second?: Response | Error) {
            const impl = vi.fn();
            impl.mockResolvedValueOnce(first);
            if (second instanceof Error) {
                impl.mockRejectedValueOnce(second);
            } else if (second) {
                impl.mockResolvedValueOnce(second);
            }
            vi.stubGlobal("fetch", impl);
            return impl;
        }

        it("mints fresh then cancels the live predecessor", async () => {
            const impl = mockSequence(
                new Response(JSON.stringify(fresh), { status: 201 }),
                new Response(JSON.stringify(summary({ status: "cancelled" })), { status: 200 }),
            );
            const result = await resendBookingRequest({
                previous: summary(),
                haloTokenPair: pair,
                accessToken: ACCESS,
            });
            expect(result).toEqual({ ...fresh, oldInvalidated: true });
            expect(impl).toHaveBeenCalledTimes(2);
            const [mintUrl, mintInit] = impl.mock.calls[0] as unknown as [string, RequestInit];
            expect(mintUrl).toBe("/api/book/requests");
            expect(JSON.parse(mintInit.body as string)).toMatchObject({ ticketId: 42 });
            const [cancelUrl] = impl.mock.calls[1] as unknown as [string];
            expect(cancelUrl).toBe("/api/book/requests/rid-1/cancel");
        });

        it("skips the cancel for terminal predecessors", async () => {
            const impl = mockSequence(new Response(JSON.stringify(fresh), { status: 201 }));
            const result = await resendBookingRequest({
                previous: summary({ status: "expired" }),
                haloTokenPair: pair,
                accessToken: ACCESS,
            });
            expect(result).toEqual({ ...fresh, oldInvalidated: true });
            expect(impl).toHaveBeenCalledTimes(1);
        });

        it("counts a raced cancel as invalidated", async () => {
            mockSequence(
                new Response(JSON.stringify(fresh), { status: 201 }),
                new Response(
                    JSON.stringify({ error: "final", ...summary({ status: "expired" }) }),
                    {
                        status: 409,
                    },
                ),
            );
            const result = await resendBookingRequest({
                previous: summary(),
                haloTokenPair: pair,
                accessToken: ACCESS,
            });
            expect(result.oldInvalidated).toBe(true);
        });

        it("still returns the fresh link when the cancel fails", async () => {
            mockSequence(
                new Response(JSON.stringify(fresh), { status: 201 }),
                new TypeError("fetch failed"),
            );
            const result = await resendBookingRequest({
                previous: summary(),
                haloTokenPair: pair,
                accessToken: ACCESS,
            });
            expect(result).toEqual({ ...fresh, oldInvalidated: false });
        });
    });
});
