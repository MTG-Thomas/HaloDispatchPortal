import { describe, expect, it } from "vitest";
import {
    DEFAULT_PRIORITY_BOOST_MAP,
    PRIORITY_SCORE_WEIGHTS,
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
