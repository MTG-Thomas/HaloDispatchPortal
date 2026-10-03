/**
 * SLA escalation ("breaching next") helpers — client-only, no API calls.
 *
 * Ordering and alert-transition detection for the dispatch ticket list.
 * SLA state comes from the shared computeSla() helper; within an SLA band,
 * tickets rank by the shared scoreTicket() dispatch score.
 */

import { computeSla, type SlaInfo } from "@/utils/enrich-ticket";
import { scoreTicket, type ScorableTicket } from "@/lib/priority-score";

/** Minimum ticket shape needed for escalation ordering and alert detection. */
export interface EscalationTicket extends ScorableTicket {
    id: number;
}

export type SlaState = SlaInfo["slaState"];

const NULL_DATE_PREFIX = "1899-12-30";

/** Escalation order: overdue first, then warning, then ok, on-hold last. */
export function slaRank(state: SlaState): number {
    switch (state) {
        case "overdue":
            return 0;
        case "warning":
            return 1;
        case "ok":
            return 2;
        case "onhold":
            return 3;
    }
}

function fixByTime(value: string | null | undefined): number {
    if (!value || value.startsWith(NULL_DATE_PREFIX)) return Number.POSITIVE_INFINITY;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

/**
 * "Breaching next" order: SLA band (overdue/warning/ok/on-hold) first, then
 * dispatch score descending, then earliest fix-by date, then id for
 * determinism. Does not mutate the input.
 */
export function sortBreachingNext<T extends EscalationTicket>(tickets: T[], now: Date): T[] {
    return [...tickets].sort((a, b) => {
        const rankA = slaRank(computeSla(a.fixbydate, a.excludefromsla, a.onhold, now).slaState);
        const rankB = slaRank(computeSla(b.fixbydate, b.excludefromsla, b.onhold, now).slaState);
        if (rankA !== rankB) return rankA - rankB;
        const scoreDiff = scoreTicket(b, now) - scoreTicket(a, now);
        if (scoreDiff !== 0) return scoreDiff;
        const dateDiff = fixByTime(a.fixbydate) - fixByTime(b.fixbydate);
        if (dateDiff !== 0) return dateDiff;
        return a.id - b.id;
    });
}

/** Ids of tickets currently overdue per computeSla(). */
export function overdueIds(tickets: EscalationTicket[], now: Date): Set<number> {
    const ids = new Set<number>();
    for (const ticket of tickets) {
        const { slaState } = computeSla(
            ticket.fixbydate,
            ticket.excludefromsla,
            ticket.onhold,
            now,
        );
        if (slaState === "overdue") ids.add(ticket.id);
    }
    return ids;
}

/**
 * Tickets that are overdue now but were not in the previous overdue-id
 * snapshot — i.e. newly breached. First occurrence wins when the same ticket
 * id appears in multiple lists.
 */
export function detectNewlyOverdue<T extends EscalationTicket>(
    prevOverdueIds: ReadonlySet<number>,
    tickets: T[],
    now: Date,
): T[] {
    const seen = new Set<number>();
    const newly: T[] = [];
    for (const ticket of tickets) {
        if (seen.has(ticket.id)) continue;
        seen.add(ticket.id);
        if (prevOverdueIds.has(ticket.id)) continue;
        const { slaState } = computeSla(
            ticket.fixbydate,
            ticket.excludefromsla,
            ticket.onhold,
            now,
        );
        if (slaState === "overdue") newly.push(ticket);
    }
    return newly;
}
