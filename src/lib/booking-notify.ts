import type { BookingRequestSummary } from "@/lib/book-api";

/**
 * Customer-activity notification helpers for the dispatcher booking queue.
 *
 * The Worker list endpoint is the only source of truth for link views
 * (`clickedAt`) and bookings (`status: "booked"`); these pure helpers derive
 * unread state and notification events from consecutive list snapshots so the
 * polling hook stays thin. No Halo fields are touched here.
 */

export type BookingActivityKind = "viewed" | "booked";

export interface BookingActivityEvent {
    rid: string;
    ticketId: number;
    kind: BookingActivityKind;
}

/** Customer has interacted with this link (viewed it or booked through it). */
export function hasCustomerActivity(summary: BookingRequestSummary): boolean {
    return summary.clickedAt !== null || summary.status === "booked";
}

/**
 * Transitions between two list snapshots. A row that flips to `booked`
 * reports `booked` only (it implies a view); a row that stays `pending` but
 * gains its first `clickedAt` reports `viewed`. Rows unknown to the previous
 * snapshot report their current activity, if any — a link that was viewed or
 * booked between polls still surfaces exactly once.
 */
export function detectBookingActivity(
    previous: ReadonlyMap<string, BookingRequestSummary>,
    current: readonly BookingRequestSummary[],
): BookingActivityEvent[] {
    const events: BookingActivityEvent[] = [];
    for (const row of current) {
        const prev = previous.get(row.rid);
        if (!prev) {
            if (row.status === "booked") {
                events.push({ rid: row.rid, ticketId: row.ticketId, kind: "booked" });
            } else if (row.clickedAt !== null) {
                events.push({ rid: row.rid, ticketId: row.ticketId, kind: "viewed" });
            }
            continue;
        }
        if (prev.status !== "booked" && row.status === "booked") {
            events.push({ rid: row.rid, ticketId: row.ticketId, kind: "booked" });
        } else if (prev.clickedAt === null && row.clickedAt !== null) {
            events.push({ rid: row.rid, ticketId: row.ticketId, kind: "viewed" });
        }
    }
    return events;
}

/**
 * Fold fresh activity events into the unread set, dropping rids that left
 * the list (e.g. a resend that replaced them). Order is stable: existing
 * unread first, then newly active rids.
 */
export function mergeUnreadRids(
    unread: readonly string[],
    events: readonly BookingActivityEvent[],
    current: readonly BookingRequestSummary[],
): string[] {
    const live = new Set(current.map((row) => row.rid));
    const next = unread.filter((rid) => live.has(rid));
    const seen = new Set(next);
    for (const event of events) {
        if (live.has(event.rid) && !seen.has(event.rid)) {
            seen.add(event.rid);
            next.push(event.rid);
        }
    }
    return next;
}
