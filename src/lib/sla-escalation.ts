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
 * earliest fix-by date (the next breach ranks first regardless of score),
 * then dispatch score descending to break deadline ties, then id for
 * determinism. Tickets without a valid fix-by date sort after dated ones
 * within their band. Does not mutate the input.
 */
export function sortBreachingNext<T extends EscalationTicket>(
    tickets: T[],
    now: Date,
    priorityBoostMap?: Record<number, number>,
): T[] {
    return [...tickets].sort((a, b) => {
        const rankA = slaRank(computeSla(a.fixbydate, a.excludefromsla, a.onhold, now).slaState);
        const rankB = slaRank(computeSla(b.fixbydate, b.excludefromsla, b.onhold, now).slaState);
        if (rankA !== rankB) return rankA - rankB;
        // Compare without subtraction: missing/invalid dates are +Infinity
        // on both sides, and Infinity - Infinity is NaN (never === 0), which
        // would skip the score and id tie-breaks below.
        const timeA = fixByTime(a.fixbydate);
        const timeB = fixByTime(b.fixbydate);
        if (timeA !== timeB) return timeA < timeB ? -1 : 1;
        const scoreDiff =
            scoreTicket(b, now, priorityBoostMap) - scoreTicket(a, now, priorityBoostMap);
        if (scoreDiff !== 0) return scoreDiff;
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
