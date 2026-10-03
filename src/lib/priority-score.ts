/**
 * Dispatch priority scoring (client-only, no API calls).
 *
 * Formula — scoreTicket() returns an integer 0-100, the sum of:
 *
 *   SLA        (0-40): overdue 40, warning 25, ok 10, on-hold / excluded /
 *                      no fix-by date 0. State comes from the existing
 *                      computeSla() in src/utils/enrich-ticket.ts.
 *   Age        (0-25): log scale on dateoccurred, saturating at 7 days:
 *                      25 * ln(1 + ageDays) / ln(1 + 7).
 *   Staleness  (0-20): linear on hours since lastactiondate, saturating
 *                      at 48h: 20 * min(1, hoursSinceAction / 48).
 *   Priority   (0-15): boost from priority_id via DEFAULT_PRIORITY_BOOST_MAP.
 *
 * Tuning per tenant: adjust PRIORITY_SCORE_WEIGHTS and pass a tenant
 * priority map as the third argument (Halo priority ids differ per
 * tenant; unknown ids score 0). buildTenantPriorityBoostMap() derives
 * that map from the tenant's priority ids, and resolvePriorityBoostMap()
 * falls back to DEFAULT_PRIORITY_BOOST_MAP when no tenant ids are
 * present. Missing/invalid dates contribute 0 for their component. The
 * Halo "1899-12-30" sentinel counts as no date.
 */

import { computeSla } from "@/utils/enrich-ticket";

/** Tunable weights and saturation points for scoreTicket(). */
export const PRIORITY_SCORE_WEIGHTS = {
    /** Max total for the SLA component. */
    slaMax: 40,
    /** SLA points when computeSla() reports overdue. */
    slaOverdue: 40,
    /** SLA points when computeSla() reports warning (<2h left). */
    slaWarning: 25,
    /** SLA points when computeSla() reports ok with a real fix-by date. */
    slaOk: 10,
    /** SLA points for on-hold, SLA-excluded, or missing fix-by date. */
    slaNone: 0,
    /** Max total for the age component. */
    ageMax: 25,
    /** Age in days at which the age component saturates. */
    ageSaturationDays: 7,
    /** Max total for the staleness component. */
    stalenessMax: 20,
    /** Hours since last action at which staleness saturates. */
    stalenessSaturationHours: 48,
    /** Max total for the priority-boost component. */
    priorityBoostMax: 15,
} as const;

/**
 * Default boost (0-15) per Halo priority_id. Halo's default priorities are
 * 1 (highest) through 4 (lowest); tenants that renumbered priorities should
 * override this map. Unknown ids score 0.
 */
export const DEFAULT_PRIORITY_BOOST_MAP: Record<number, number> = {
    1: 15,
    2: 10,
    3: 5,
    4: 0,
};

/** Minimum ticket shape needed for scoring (Ticket and EnrichedTicket both satisfy this). */
export interface ScorableTicket {
    dateoccurred: string;
    lastactiondate: string;
    fixbydate: string | null | undefined;
    excludefromsla: boolean;
    onhold: boolean;
    priority_id: number;
}

export interface PriorityScoreBreakdown {
    sla: number;
    age: number;
    staleness: number;
    priorityBoost: number;
    total: number;
}

const NULL_DATE_PREFIX = "1899-12-30";
const MS_PER_HOUR = 1000 * 60 * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;

function parseDate(value: string | null | undefined): Date | null {
    if (!value || value.startsWith(NULL_DATE_PREFIX)) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function scoreSla(ticket: ScorableTicket, now: Date): number {
    const { slaOverdue, slaWarning, slaOk, slaNone } = PRIORITY_SCORE_WEIGHTS;
    if (ticket.excludefromsla || ticket.onhold) return slaNone;
    if (!parseDate(ticket.fixbydate)) return slaNone;
    const { slaState } = computeSla(ticket.fixbydate, ticket.excludefromsla, ticket.onhold, now);
    switch (slaState) {
        case "overdue":
            return slaOverdue;
        case "warning":
            return slaWarning;
        case "ok":
            return slaOk;
        default:
            return slaNone;
    }
}

function scoreAge(ticket: ScorableTicket, now: Date): number {
    const { ageMax, ageSaturationDays } = PRIORITY_SCORE_WEIGHTS;
    const occurred = parseDate(ticket.dateoccurred);
    if (!occurred) return 0;
    const ageDays = Math.max(0, (now.getTime() - occurred.getTime()) / MS_PER_DAY);
    const ratio = Math.log1p(ageDays) / Math.log1p(ageSaturationDays);
    return ageMax * Math.min(1, ratio);
}

function scoreStaleness(ticket: ScorableTicket, now: Date): number {
    const { stalenessMax, stalenessSaturationHours } = PRIORITY_SCORE_WEIGHTS;
    const lastAction = parseDate(ticket.lastactiondate);
    if (!lastAction) return 0;
    const hours = Math.max(0, (now.getTime() - lastAction.getTime()) / MS_PER_HOUR);
    return stalenessMax * Math.min(1, hours / stalenessSaturationHours);
}

function scorePriorityBoost(
    ticket: ScorableTicket,
    priorityBoostMap: Record<number, number> = DEFAULT_PRIORITY_BOOST_MAP,
): number {
    return priorityBoostMap[ticket.priority_id] ?? 0;
}

/** Full component breakdown plus the rounded 0-100 total. */
export function scoreBreakdown(
    ticket: ScorableTicket,
    now: Date = new Date(),
    priorityBoostMap: Record<number, number> = DEFAULT_PRIORITY_BOOST_MAP,
): PriorityScoreBreakdown {
    const sla = scoreSla(ticket, now);
    const age = scoreAge(ticket, now);
    const staleness = scoreStaleness(ticket, now);
    const priorityBoost = scorePriorityBoost(ticket, priorityBoostMap);
    const total = Math.max(0, Math.min(100, Math.round(sla + age + staleness + priorityBoost)));
    return { sla, age, staleness, priorityBoost, total };
}

/**
 * Build a tenant boost map from the tenant's priority ids (e.g. the
 * distinct priority_ids on the loaded tickets — ClientCache carries no
 * priority catalogue, so the embedded ticket priority objects are the
 * tenant source and no extra API call is needed).
 *
 * Halo convention, matching the documented 1-highest-through-4-lowest
 * default: lower id = more severe. Ids are deduplicated, sorted
 * ascending, and spread linearly from priorityBoostMax (most severe) to
 * 0 (least severe); a single id maps to the max. Non-positive and
 * non-integer ids are ignored (0 means "no priority" in Halo forms and
 * must never outrank a real priority). Empty input yields {}.
 */
export function buildTenantPriorityBoostMap(priorityIds: number[]): Record<number, number> {
    const { priorityBoostMax } = PRIORITY_SCORE_WEIGHTS;
    const ids = [...new Set(priorityIds.filter((id) => Number.isInteger(id) && id > 0))].sort(
        (a, b) => a - b,
    );
    if (ids.length === 0) return {};
    if (ids.length === 1) return { [ids[0]]: priorityBoostMax };
    const map: Record<number, number> = {};
    const last = ids.length - 1;
    ids.forEach((id, index) => {
        map[id] = Math.round((priorityBoostMax * (last - index)) / last);
    });
    return map;
}

/**
 * Tenant priority ids accumulated across ticket loads. The loaded page is
 * a slice, so deriving the boost map from each page would rescale every
 * priority's boost on pagination or filter changes; the union only grows
 * (reset on tenant change), keeping a given priority's boost stable.
 */
export interface TenantPriorityAccumulation {
    key: string;
    ids: number[];
}

/**
 * Fold one page of loaded priority ids into the stable tenant set.
 * Non-positive and non-integer ids are ignored (matching
 * buildTenantPriorityBoostMap); a tenant-key change resets. Returns the
 * previous object untouched when nothing changed, so callers can bail
 * out of re-renders.
 */
export function accumulateTenantPriorityIds(
    prev: TenantPriorityAccumulation,
    tenantKey: string,
    priorityIds: readonly number[],
): TenantPriorityAccumulation {
    const base = prev.key === tenantKey ? new Set(prev.ids) : new Set<number>();
    let changed = prev.key !== tenantKey;
    for (const id of priorityIds) {
        if (Number.isInteger(id) && id > 0 && !base.has(id)) {
            base.add(id);
            changed = true;
        }
    }
    return changed ? { key: tenantKey, ids: [...base] } : prev;
}

/**
 * Resolve the boost map for scoring: the tenant map when tenant priority
 * ids are present, otherwise DEFAULT_PRIORITY_BOOST_MAP. Returns the
 * DEFAULT object itself (not a copy) on the fallback path.
 */
export function resolvePriorityBoostMap(
    priorityIds: number[] | null | undefined,
): Record<number, number> {
    if (!priorityIds || priorityIds.length === 0) return DEFAULT_PRIORITY_BOOST_MAP;
    const built = buildTenantPriorityBoostMap(priorityIds);
    return Object.keys(built).length === 0 ? DEFAULT_PRIORITY_BOOST_MAP : built;
}

/** Dispatch priority score, 0-100 (higher = needs attention sooner). */
export function scoreTicket(
    ticket: ScorableTicket,
    now: Date = new Date(),
    priorityBoostMap: Record<number, number> = DEFAULT_PRIORITY_BOOST_MAP,
): number {
    return scoreBreakdown(ticket, now, priorityBoostMap).total;
}
