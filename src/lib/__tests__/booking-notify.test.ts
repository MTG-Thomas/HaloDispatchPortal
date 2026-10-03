import { describe, it, expect } from "vitest";
import { detectBookingActivity, hasCustomerActivity, mergeUnreadRids } from "../booking-notify";
import type { BookingRequestSummary } from "../book-api";

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

function byRid(rows: BookingRequestSummary[]): Map<string, BookingRequestSummary> {
    return new Map(rows.map((row) => [row.rid, row]));
}

describe("hasCustomerActivity", () => {
    it("is false for a freshly sent link", () => {
        expect(hasCustomerActivity(summary())).toBe(false);
    });

    it("is true once viewed or booked", () => {
        expect(hasCustomerActivity(summary({ clickedAt: "2026-10-02T00:00:00.000Z" }))).toBe(true);
        expect(hasCustomerActivity(summary({ status: "booked", bookedAppointmentId: 9 }))).toBe(
            true,
        );
    });
});

describe("detectBookingActivity", () => {
    it("reports viewed when clickedAt appears on a pending row", () => {
        const events = detectBookingActivity(byRid([summary()]), [
            summary({ clickedAt: "2026-10-02T00:00:00.000Z" }),
        ]);
        expect(events).toEqual([{ rid: "rid-1", ticketId: 42, kind: "viewed" }]);
    });

    it("reports booked when a row flips to booked", () => {
        const events = detectBookingActivity(
            byRid([summary({ clickedAt: "2026-10-02T00:00:00.000Z" })]),
            [
                summary({
                    status: "booked",
                    clickedAt: "2026-10-02T00:00:00.000Z",
                    bookedAppointmentId: 9,
                }),
            ],
        );
        expect(events).toEqual([{ rid: "rid-1", ticketId: 42, kind: "booked" }]);
    });

    it("reports booked only when view and booking land between polls", () => {
        const events = detectBookingActivity(byRid([summary()]), [
            summary({
                status: "booked",
                clickedAt: "2026-10-02T00:00:00.000Z",
                bookedAppointmentId: 9,
            }),
        ]);
        expect(events).toEqual([{ rid: "rid-1", ticketId: 42, kind: "booked" }]);
    });

    it("reports current activity for rows missing from the baseline", () => {
        const events = detectBookingActivity(byRid([]), [
            summary({ rid: "rid-new-viewed", clickedAt: "2026-10-02T00:00:00.000Z" }),
            summary({ rid: "rid-new-booked", status: "booked", bookedAppointmentId: 9 }),
            summary({ rid: "rid-new-sent" }),
        ]);
        expect(events).toEqual([
            { rid: "rid-new-viewed", ticketId: 42, kind: "viewed" },
            { rid: "rid-new-booked", ticketId: 42, kind: "booked" },
        ]);
    });

    it("stays silent for dispatcher-side and terminal changes", () => {
        const baseline = byRid([
            summary({ rid: "rid-cancel" }),
            summary({ rid: "rid-expire" }),
            summary({ rid: "rid-clicked", clickedAt: "2026-10-02T00:00:00.000Z" }),
        ]);
        const events = detectBookingActivity(baseline, [
            summary({ rid: "rid-cancel", status: "cancelled" }),
            summary({ rid: "rid-expire", status: "expired" }),
            summary({ rid: "rid-clicked", clickedAt: "2026-10-02T00:00:00.000Z" }),
            summary({ rid: "rid-fresh-resend" }),
        ]);
        expect(events).toEqual([]);
    });
});

describe("mergeUnreadRids", () => {
    it("adds fresh events and keeps existing unread first", () => {
        const current = [summary({ rid: "rid-old" }), summary({ rid: "rid-1" })];
        expect(
            mergeUnreadRids(["rid-old"], [{ rid: "rid-1", ticketId: 42, kind: "viewed" }], current),
        ).toEqual(["rid-old", "rid-1"]);
    });

    it("dedupes repeat events for the same rid", () => {
        const current = [summary()];
        expect(
            mergeUnreadRids(["rid-1"], [{ rid: "rid-1", ticketId: 42, kind: "booked" }], current),
        ).toEqual(["rid-1"]);
    });

    it("drops rids that left the list", () => {
        expect(mergeUnreadRids(["rid-gone", "rid-1"], [], [summary()])).toEqual(["rid-1"]);
    });
});
