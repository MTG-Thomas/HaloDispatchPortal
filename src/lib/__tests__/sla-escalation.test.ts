import { describe, expect, it } from "vitest";
import {
    detectNewlyOverdue,
    overdueIds,
    slaRank,
    sortBreachingNext,
    type EscalationTicket,
} from "@/lib/sla-escalation";

const NOW = new Date("2026-10-03T12:00:00.000Z");

let nextId = 1;
function ticket(partial: Partial<EscalationTicket> = {}): EscalationTicket {
    return {
        id: nextId++,
        dateoccurred: "2026-10-03T11:00:00.000Z",
        lastactiondate: "2026-10-03T11:30:00.000Z",
        fixbydate: "2026-10-10T12:00:00.000Z",
        excludefromsla: false,
        onhold: false,
        priority_id: 3,
        ...partial,
    };
}

describe("slaRank", () => {
    it("orders overdue before warning before ok before on-hold", () => {
        expect(slaRank("overdue")).toBeLessThan(slaRank("warning"));
        expect(slaRank("warning")).toBeLessThan(slaRank("ok"));
        expect(slaRank("ok")).toBeLessThan(slaRank("onhold"));
    });
});

describe("sortBreachingNext", () => {
    it("puts overdue first, then warning, then ok, on-hold last", () => {
        const ok = ticket({ id: 1, fixbydate: "2026-10-10T12:00:00.000Z" });
        const onHold = ticket({ id: 2, onhold: true, fixbydate: "2026-10-01T12:00:00.000Z" });
        const overdue = ticket({ id: 3, fixbydate: "2026-10-01T12:00:00.000Z" });
        const warning = ticket({ id: 4, fixbydate: "2026-10-03T13:00:00.000Z" });
        expect(sortBreachingNext([ok, onHold, overdue, warning], NOW).map((t) => t.id)).toEqual([
            3, 4, 1, 2,
        ]);
    });

    it("ranks within a band by dispatch score, then earliest fix-by, then id", () => {
        // Both overdue; the P1 outscores the P4 despite identical dates.
        const lowScore = ticket({ id: 10, priority_id: 4, fixbydate: "2026-10-01T12:00:00.000Z" });
        const highScore = ticket({ id: 11, priority_id: 1, fixbydate: "2026-10-01T12:00:00.000Z" });
        expect(sortBreachingNext([lowScore, highScore], NOW).map((t) => t.id)).toEqual([11, 10]);

        // Identical scores: earlier fix-by date wins.
        const later = ticket({ id: 12, fixbydate: "2026-10-03T13:30:00.000Z" });
        const earlier = ticket({ id: 13, fixbydate: "2026-10-03T12:30:00.000Z" });
        expect(sortBreachingNext([later, earlier], NOW).map((t) => t.id)).toEqual([13, 12]);

        // Fully identical: id tiebreak keeps the order deterministic.
        const b = ticket({ id: 15, fixbydate: "2026-10-03T13:00:00.000Z" });
        const a = ticket({ id: 14, fixbydate: "2026-10-03T13:00:00.000Z" });
        expect(sortBreachingNext([b, a], NOW).map((t) => t.id)).toEqual([14, 15]);
    });

    it("treats excluded and dateless tickets as ok-band and does not mutate input", () => {
        const excluded = ticket({ id: 20, excludefromsla: true });
        const dateless = ticket({ id: 21, fixbydate: null });
        const overdue = ticket({ id: 22, fixbydate: "2026-10-01T12:00:00.000Z" });
        const input = [excluded, dateless, overdue];
        const sorted = sortBreachingNext(input, NOW);
        expect(sorted.map((t) => t.id)).toEqual([22, 20, 21]);
        expect(input.map((t) => t.id)).toEqual([20, 21, 22]);
    });
});

describe("overdueIds / detectNewlyOverdue", () => {
    it("snapshots current overdue ids and reports only new breaches", () => {
        const wasOverdue = ticket({ id: 30, fixbydate: "2026-10-01T12:00:00.000Z" });
        const breaching = ticket({ id: 31, fixbydate: "2026-10-03T12:30:00.000Z" });
        const fine = ticket({ id: 32, fixbydate: "2026-10-10T12:00:00.000Z" });
        const tickets = [wasOverdue, breaching, fine];

        const prev = overdueIds(tickets, NOW);
        expect(prev).toEqual(new Set([30]));

        // An hour later the warning ticket breaches; the old one stays silent.
        const later = new Date("2026-10-03T13:30:00.000Z");
        expect(detectNewlyOverdue(prev, tickets, later).map((t) => t.id)).toEqual([31]);

        // Once snapshotted, nothing is new anymore.
        const next = overdueIds(tickets, later);
        expect(detectNewlyOverdue(next, tickets, later)).toEqual([]);
    });

    it("ignores on-hold and excluded tickets and dedupes repeated ids", () => {
        const onHold = ticket({ id: 40, onhold: true, fixbydate: "2026-10-01T12:00:00.000Z" });
        const excluded = ticket({
            id: 41,
            excludefromsla: true,
            fixbydate: "2026-10-01T12:00:00.000Z",
        });
        const dupA = ticket({ id: 42, fixbydate: "2026-10-01T12:00:00.000Z" });
        const dupB = ticket({ id: 42, fixbydate: "2026-10-01T12:00:00.000Z" });
        const newly = detectNewlyOverdue(new Set(), [onHold, excluded, dupA, dupB], NOW);
        expect(newly.map((t) => t.id)).toEqual([42]);
    });

    it("re-fires when a ticket leaves overdue and breaches again", () => {
        const ticketA = ticket({ id: 50, fixbydate: "2026-10-01T12:00:00.000Z" });
        const prev = overdueIds([ticketA], NOW);
        expect(prev).toEqual(new Set([50]));

        // Fix-by pushed out: no longer overdue, snapshot clears the id.
        const extended = { ...ticketA, fixbydate: "2026-10-10T12:00:00.000Z" };
        const cleared = overdueIds([extended], NOW);
        expect(cleared).toEqual(new Set());

        // And a later breach from the cleared snapshot reports as new.
        expect(detectNewlyOverdue(cleared, [ticketA], NOW).map((t) => t.id)).toEqual([50]);
    });
});
