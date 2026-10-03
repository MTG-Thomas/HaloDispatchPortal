import { useEffect, useRef, useState } from "react";
import { detectNewlyOverdue, overdueIds } from "@/lib/sla-escalation";
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
 * The overdue-id snapshot initializes silently on mount (pre-existing
 * overdue tickets never notify), and each ticket notifies at most once per
 * transition into overdue. No-op when disabled, when the Notification API
 * is unavailable, or when permission is not granted. Returns the tickets
 * that newly breached on the latest evaluation.
 */
export function useSlaOverdueAlerts(
    tickets: EnrichedTicket[],
    now: Date,
    enabled: boolean,
): EnrichedTicket[] {
    const prevIdsRef = useRef<Set<number> | null>(null);
    const [newlyOverdue, setNewlyOverdue] = useState<EnrichedTicket[]>([]);

    useEffect(() => {
        if (prevIdsRef.current === null) {
            prevIdsRef.current = overdueIds(tickets, now);
            return;
        }
        const newly = detectNewlyOverdue(prevIdsRef.current, tickets, now);
        prevIdsRef.current = overdueIds(tickets, now);
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
