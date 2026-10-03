import { useEffect, useRef, useState } from "react";
import { overdueIds } from "@/lib/sla-escalation";
import type { EnrichedTicket } from "@/types/halo";

function notificationsAvailable(): boolean {
    return typeof Notification !== "undefined";
}

function sameTicketIds(a: readonly EnrichedTicket[], b: readonly EnrichedTicket[]): boolean {
    return a.length === b.length && a.every((ticket, index) => ticket.id === b[index].id);
}

/**
 * Opt-in browser notifications for tickets that newly breach SLA.
 *
 * Each observed ticket baselines silently on first sight (pre-existing or
 * newly loaded overdue tickets never notify), and a ticket notifies only
 * on a previously-observed non-overdue -> overdue transition — at most
 * once per transition. Removing and reloading an overdue ticket
 * re-baselines it instead of re-alerting. No-op when disabled, when the
 * Notification API is unavailable, or when permission is not granted.
 * Returns the tickets that newly breached on the latest evaluation.
 */
export function useSlaOverdueAlerts(
    tickets: EnrichedTicket[],
    now: Date,
    enabled: boolean,
): EnrichedTicket[] {
    const observedRef = useRef<Map<number, boolean> | null>(null);
    const [newlyOverdue, setNewlyOverdue] = useState<EnrichedTicket[]>([]);

    useEffect(() => {
        const current = overdueIds(tickets, now);
        const prev = observedRef.current;
        if (prev === null) {
            observedRef.current = new Map(
                tickets.map((ticket) => [ticket.id, current.has(ticket.id)] as const),
            );
            return;
        }
        const seen = new Set<number>();
        const newly: EnrichedTicket[] = [];
        for (const ticket of tickets) {
            if (seen.has(ticket.id)) continue;
            seen.add(ticket.id);
            if (prev.get(ticket.id) === false && current.has(ticket.id)) {
                newly.push(ticket);
            }
        }
        observedRef.current = new Map(
            tickets.map((ticket) => [ticket.id, current.has(ticket.id)] as const),
        );
        // Bail out on unchanged ids: the effect re-runs whenever `now`
        // identity churns, and an unconditional fresh array would loop.
        setNewlyOverdue((prev) => (sameTicketIds(prev, newly) ? prev : newly));
        if (enabled && newly.length > 0 && notificationsAvailable()) {
            if (Notification.permission === "granted") {
                for (const ticket of newly) {
                    new Notification(`Ticket #${ticket.id} breached SLA`, {
                        body: ticket.summary,
                        tag: `sla-overdue-${ticket.id}`,
                    });
                }
            }
        }
    }, [tickets, now, enabled]);

    return newlyOverdue;
}

/** Request browser-notification permission; resolves false where unsupported. */
export async function requestOverdueAlertPermission(): Promise<boolean> {
    if (!notificationsAvailable()) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return (await Notification.requestPermission()) === "granted";
}
