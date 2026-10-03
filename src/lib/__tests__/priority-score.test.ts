import { describe, expect, it } from "vitest";
import {
    accumulateTenantPriorityIds,
    buildTenantPriorityBoostMap,
    DEFAULT_PRIORITY_BOOST_MAP,
    PRIORITY_SCORE_WEIGHTS,
    resolvePriorityBoostMap,
    scoreBreakdown,
    scoreTicket,
    type ScorableTicket,
} from "@/lib/priority-score";

const NOW = new Date("2026-10-03T12:00:00.000Z");

function ticket(partial: Partial<ScorableTicket> = {}): ScorableTicket {
    return {
        dateoccurred: "2026-10-03T11:00:00.000Z",
        lastactiondate: "2026-10-03T11:30:00.000Z",
        fixbydate: "2026-10-10T12:00:00.000Z",
        excludefromsla: false,
        onhold: false,
        priority_id: 3,
        ...partial,
    };
}

describe("scoreTicket", () => {
    it("ranks an overdue P1 above a fresh P4", () => {
        const overdueP1 = ticket({
            priority_id: 1,
            fixbydate: "2026-10-01T12:00:00.000Z",
        });
        const freshP4 = ticket({
            priority_id: 4,
            dateoccurred: "2026-10-03T11:55:00.000Z",
            lastactiondate: "2026-10-03T11:59:00.000Z",
            fixbydate: "2026-10-10T12:00:00.000Z",
        });
        expect(scoreTicket(overdueP1, NOW)).toBeGreaterThan(scoreTicket(freshP4, NOW));
    });

    it("drops an on-hold ticket below its active twin", () => {
        const active = ticket({ fixbydate: "2026-10-01T12:00:00.000Z" });
        const onHold = ticket({ fixbydate: "2026-10-01T12:00:00.000Z", onhold: true });
        expect(scoreBreakdown(onHold, NOW).sla).toBe(0);
        expect(scoreTicket(onHold, NOW)).toBeLessThan(scoreTicket(active, NOW));
    });

    it("scores SLA-excluded and dateless tickets 0 for the SLA component", () => {
        expect(scoreBreakdown(ticket({ excludefromsla: true }), NOW).sla).toBe(0);
        expect(scoreBreakdown(ticket({ fixbydate: null }), NOW).sla).toBe(0);
        expect(scoreBreakdown(ticket({ fixbydate: "1899-12-30T00:00:00" }), NOW).sla).toBe(0);
    });

    it("maps SLA states to overdue 40 / warning 25 / ok 10", () => {
        expect(scoreBreakdown(ticket({ fixbydate: "2026-10-01T12:00:00.000Z" }), NOW).sla).toBe(
            PRIORITY_SCORE_WEIGHTS.slaOverdue,
        );
        expect(scoreBreakdown(ticket({ fixbydate: "2026-10-03T13:00:00.000Z" }), NOW).sla).toBe(
            PRIORITY_SCORE_WEIGHTS.slaWarning,
        );
        expect(scoreBreakdown(ticket(), NOW).sla).toBe(PRIORITY_SCORE_WEIGHTS.slaOk);
    });

    it("saturates age at 7 days and staleness at 48 hours", () => {
        const saturated = ticket({
            dateoccurred: "2026-09-01T12:00:00.000Z",
            lastactiondate: "2026-09-01T12:00:00.000Z",
        });
        const breakdown = scoreBreakdown(saturated, NOW);
        expect(breakdown.age).toBeCloseTo(PRIORITY_SCORE_WEIGHTS.ageMax, 10);
        expect(breakdown.staleness).toBeCloseTo(PRIORITY_SCORE_WEIGHTS.stalenessMax, 10);

        const older = ticket({
            dateoccurred: "2026-01-01T12:00:00.000Z",
            lastactiondate: "2026-01-01T12:00:00.000Z",
        });
        expect(scoreTicket(older, NOW)).toBe(scoreTicket(saturated, NOW));
    });

    it("scales age logarithmically (diminishing returns)", () => {
        const oneDay = scoreBreakdown(
            ticket({ dateoccurred: "2026-10-02T12:00:00.000Z" }),
            NOW,
        ).age;
        const sevenDays = scoreBreakdown(
            ticket({ dateoccurred: "2026-09-26T12:00:00.000Z" }),
            NOW,
        ).age;
        expect(oneDay).toBeGreaterThan(0);
        expect(sevenDays).toBeGreaterThan(oneDay);
        // Log scale: 7x the age yields well under 7x the points.
        expect(sevenDays / oneDay).toBeLessThan(7);
    });

    it("applies the documented priority boost map", () => {
        for (const [id, boost] of Object.entries(DEFAULT_PRIORITY_BOOST_MAP)) {
            expect(scoreBreakdown(ticket({ priority_id: Number(id) }), NOW).priorityBoost).toBe(
                boost,
            );
        }
        expect(scoreBreakdown(ticket({ priority_id: 999 }), NOW).priorityBoost).toBe(0);
    });

    it("accepts a tenant priority map with the default as fallback", () => {
        const tenantMap = { 10: 15, 20: 7 };
        expect(scoreBreakdown(ticket({ priority_id: 10 }), NOW, tenantMap).priorityBoost).toBe(15);
        expect(scoreBreakdown(ticket({ priority_id: 20 }), NOW, tenantMap).priorityBoost).toBe(7);
        // Ids outside the tenant map score 0 even when the default knows them.
        expect(scoreBreakdown(ticket({ priority_id: 1 }), NOW, tenantMap).priorityBoost).toBe(0);
        expect(scoreTicket(ticket({ priority_id: 10 }), NOW, tenantMap)).toBe(
            scoreBreakdown(ticket({ priority_id: 10 }), NOW, tenantMap).total,
        );
    });

    it("is deterministic with an injected now and clamps to 0-100", () => {
        const fixture = ticket({
            dateoccurred: "2026-09-01T12:00:00.000Z",
            lastactiondate: "2026-09-01T12:00:00.000Z",
            fixbydate: "2026-09-02T12:00:00.000Z",
            priority_id: 1,
        });
        expect(scoreTicket(fixture, NOW)).toBe(scoreTicket(fixture, new Date(NOW)));
        expect(scoreTicket(fixture, NOW)).toBeLessThanOrEqual(100);
        expect(scoreTicket(fixture, NOW)).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(scoreTicket(fixture, NOW))).toBe(true);
    });

    it("scores missing dates 0 for their component without throwing", () => {
        const dateless = ticket({
            dateoccurred: "",
            lastactiondate: "not-a-date",
            fixbydate: null,
        });
        const breakdown = scoreBreakdown(dateless, NOW);
        expect(breakdown.age).toBe(0);
        expect(breakdown.staleness).toBe(0);
        expect(breakdown.sla).toBe(0);
    });
});

describe("buildTenantPriorityBoostMap", () => {
    it("reproduces the default map for standard ids, tolerating order and duplicates", () => {
        expect(buildTenantPriorityBoostMap([4, 2, 1, 3, 1, 3])).toEqual(DEFAULT_PRIORITY_BOOST_MAP);
    });

    it("maps a renumbered tenant highest 15 -> lowest 0 with linear middles", () => {
        expect(buildTenantPriorityBoostMap([10, 20, 30])).toEqual({ 10: 15, 20: 8, 30: 0 });
        expect(buildTenantPriorityBoostMap([50, 10])).toEqual({ 10: 15, 50: 0 });
    });

    it("maps a single tenant id to the max boost", () => {
        expect(buildTenantPriorityBoostMap([42])).toEqual({
            42: PRIORITY_SCORE_WEIGHTS.priorityBoostMax,
        });
    });

    it("ignores non-positive and non-integer ids so 'no priority' never outranks real ones", () => {
        expect(buildTenantPriorityBoostMap([0, -1, 2.5, Number.NaN, 10])).toEqual({ 10: 15 });
        expect(buildTenantPriorityBoostMap([])).toEqual({});
        expect(buildTenantPriorityBoostMap([0, -3])).toEqual({});
    });

    it("differentiates renumbered ids through scoreTicket/scoreBreakdown", () => {
        const tenantMap = buildTenantPriorityBoostMap([10, 50]);
        expect(scoreBreakdown(ticket({ priority_id: 10 }), NOW, tenantMap).priorityBoost).toBe(15);
        expect(scoreBreakdown(ticket({ priority_id: 50 }), NOW, tenantMap).priorityBoost).toBe(0);
        // Under the default map both ids are unknown (0), so the tenant map must outrank it.
        expect(scoreTicket(ticket({ priority_id: 10 }), NOW, tenantMap)).toBeGreaterThan(
            scoreTicket(ticket({ priority_id: 50 }), NOW, tenantMap),
        );
    });
});

describe("resolvePriorityBoostMap", () => {
    it("returns the DEFAULT map itself when the tenant source is absent", () => {
        expect(resolvePriorityBoostMap(null)).toBe(DEFAULT_PRIORITY_BOOST_MAP);
        expect(resolvePriorityBoostMap(undefined)).toBe(DEFAULT_PRIORITY_BOOST_MAP);
        expect(resolvePriorityBoostMap([])).toBe(DEFAULT_PRIORITY_BOOST_MAP);
        expect(resolvePriorityBoostMap([0, -3])).toBe(DEFAULT_PRIORITY_BOOST_MAP);
    });

    it("returns the built tenant map when tenant ids are present", () => {
        expect(resolvePriorityBoostMap([50, 10, 10])).toEqual({ 10: 15, 50: 0 });
        expect(resolvePriorityBoostMap([1, 2, 3, 4])).toEqual(DEFAULT_PRIORITY_BOOST_MAP);
    });
});

describe("accumulateTenantPriorityIds", () => {
    it("unions page ids across loads so boosts stay stable under pagination", () => {
        const first = accumulateTenantPriorityIds({ key: "t", ids: [] }, "t", [10, 50]);
        expect(first).toEqual({ key: "t", ids: [10, 50] });
        // A later page with only priority 50 keeps the 10/50 map instead
        // of rescoping 50 to the max boost.
        const second = accumulateTenantPriorityIds(first, "t", [50]);
        expect(second).toBe(first);
        expect(resolvePriorityBoostMap(second.ids)).toEqual({ 10: 15, 50: 0 });
        // A genuinely new priority folds in.
        const third = accumulateTenantPriorityIds(second, "t", [30]);
        expect(third.ids).toEqual([10, 50, 30]);
    });

    it("ignores invalid ids and resets on tenant change", () => {
        const prev = accumulateTenantPriorityIds({ key: "t", ids: [] }, "t", [0, -1, 2.5, 10]);
        expect(prev.ids).toEqual([10]);
        const switched = accumulateTenantPriorityIds(prev, "other", [10]);
        expect(switched).toEqual({ key: "other", ids: [10] });
    });
});
