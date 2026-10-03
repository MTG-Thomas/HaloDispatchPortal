// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
    bookingWindowIso,
    computeSlots,
    parseHaloDateMs,
    validateSlot,
    withinBusinessHours,
    workdayWindowMinutes,
} from "../slots";

// A Monday; utcOffset 0 keeps local and UTC aligned.
const MONDAY = Date.parse("2026-10-05T00:00:00.000Z");

describe("workday rules (mirror the SPA calendar)", () => {
    it("uses the SPA working window and grid", () => {
        expect(workdayWindowMinutes()).toEqual({ startMin: 540, endMin: 1020, gridMin: 15 });
    });

    it("parses Halo datetimes as UTC with or without Z", () => {
        expect(parseHaloDateMs("2026-10-05T09:00:00")).toBe(Date.parse("2026-10-05T09:00:00.000Z"));
        expect(parseHaloDateMs("2026-10-05T09:00:00Z")).toBe(
            Date.parse("2026-10-05T09:00:00.000Z"),
        );
    });
});

describe("computeSlots", () => {
    it("offers grid-aligned 30-minute slots inside working hours", () => {
        const days = computeSlots({
            agentIds: [7],
            busy: [],
            nowMs: MONDAY,
            utcOffsetMin: 0,
            days: 1,
        });
        expect(days).toHaveLength(1);
        expect(days[0].date).toBe("2026-10-05");
        // 09:00..16:30 on a 15-minute grid.
        expect(days[0].slots).toHaveLength(31);
        expect(days[0].slots[0]).toEqual({
            agentId: 7,
            start: "2026-10-05T09:00:00.000Z",
            end: "2026-10-05T09:30:00.000Z",
        });
        const last = days[0].slots[days[0].slots.length - 1];
        expect(last.start).toBe("2026-10-05T16:30:00.000Z");
        expect(last.end).toBe("2026-10-05T17:00:00.000Z");
    });

    it("skips weekends", () => {
        const friday = Date.parse("2026-10-09T00:00:00.000Z");
        const days = computeSlots({
            agentIds: [7],
            busy: [],
            nowMs: friday,
            utcOffsetMin: 0,
            days: 4,
        });
        expect(days.map((d) => d.date)).toEqual(["2026-10-09", "2026-10-12"]);
    });

    it("excludes past slots", () => {
        const noon = Date.parse("2026-10-05T12:00:00.000Z");
        const days = computeSlots({
            agentIds: [7],
            busy: [],
            nowMs: noon,
            utcOffsetMin: 0,
            days: 1,
        });
        expect(days[0].slots[0].start).toBe("2026-10-05T12:15:00.000Z");
    });

    it("excludes slots overlapping an agent's appointments only", () => {
        const busy = [
            {
                agentId: 7,
                startMs: Date.parse("2026-10-05T09:00:00.000Z"),
                endMs: Date.parse("2026-10-05T10:00:00.000Z"),
                allDay: false,
            },
        ];
        const days = computeSlots({
            agentIds: [7, 9],
            busy,
            nowMs: MONDAY,
            utcOffsetMin: 0,
            days: 1,
        });
        const agent7 = days[0].slots.filter((s) => s.agentId === 7);
        const agent9 = days[0].slots.filter((s) => s.agentId === 9);
        expect(agent7[0].start).toBe("2026-10-05T10:00:00.000Z");
        expect(agent9[0].start).toBe("2026-10-05T09:00:00.000Z");
    });

    it("drops the whole day for an agent with an all-day block", () => {
        const busy = [
            {
                agentId: 7,
                startMs: Date.parse("2026-10-05T00:00:00.000Z"),
                endMs: Date.parse("2026-10-05T23:59:00.000Z"),
                allDay: true,
            },
        ];
        const days = computeSlots({
            agentIds: [7, 9],
            busy,
            nowMs: MONDAY,
            utcOffsetMin: 0,
            days: 1,
        });
        expect(days[0].slots.every((s) => s.agentId === 9)).toBe(true);
    });

    it("omits days with no free slots", () => {
        const busy = [
            {
                agentId: 7,
                startMs: Date.parse("2026-10-05T00:00:00.000Z"),
                endMs: Date.parse("2026-10-05T23:59:00.000Z"),
                allDay: true,
            },
        ];
        expect(
            computeSlots({ agentIds: [7], busy, nowMs: MONDAY, utcOffsetMin: 0, days: 1 }),
        ).toEqual([]);
    });

    it("interprets working hours in the caller's timezone", () => {
        // UTC-5: at 10:00Z it is 05:00 local Monday, and local 09:00 is 14:00Z.
        const days = computeSlots({
            agentIds: [7],
            busy: [],
            nowMs: Date.parse("2026-10-05T10:00:00.000Z"),
            utcOffsetMin: -300,
            days: 1,
        });
        expect(days[0].date).toBe("2026-10-05");
        expect(days[0].slots[0].start).toBe("2026-10-05T14:00:00.000Z");
    });

    it("also enforces business hours in the dispatcher offset", () => {
        // Customer UTC+1, dispatcher UTC: local 09:00 is 08:00Z, outside
        // business hours, so the first offered slot starts at 09:00Z.
        const days = computeSlots({
            agentIds: [7],
            busy: [],
            nowMs: MONDAY,
            utcOffsetMin: 60,
            businessOffsetMin: 0,
            days: 1,
        });
        expect(days[0].slots[0].start).toBe("2026-10-05T09:00:00.000Z");
        // A customer offset with no business-hours overlap offers nothing.
        expect(
            computeSlots({
                agentIds: [7],
                busy: [],
                nowMs: MONDAY,
                utcOffsetMin: 600,
                businessOffsetMin: 0,
                days: 1,
            }),
        ).toEqual([]);
    });
});

describe("withinBusinessHours", () => {
    it("accepts in-window weekday slots", () => {
        expect(
            withinBusinessHours(
                Date.parse("2026-10-05T09:00:00.000Z"),
                Date.parse("2026-10-05T09:30:00.000Z"),
                0,
            ),
        ).toBe(true);
        // Same instant measured in UTC-5 is 04:00 local: out of hours.
        expect(
            withinBusinessHours(
                Date.parse("2026-10-05T09:00:00.000Z"),
                Date.parse("2026-10-05T09:30:00.000Z"),
                -300,
            ),
        ).toBe(false);
    });

    it("rejects weekends and overhanging slots", () => {
        // Saturday.
        expect(
            withinBusinessHours(
                Date.parse("2026-10-10T09:00:00.000Z"),
                Date.parse("2026-10-10T09:30:00.000Z"),
                0,
            ),
        ).toBe(false);
        // Ends after close.
        expect(
            withinBusinessHours(
                Date.parse("2026-10-05T16:45:00.000Z"),
                Date.parse("2026-10-05T17:15:00.000Z"),
                0,
            ),
        ).toBe(false);
    });
});

describe("validateSlot", () => {
    const good = {
        busy: [],
        nowMs: MONDAY,
        utcOffsetMin: 0,
        agentId: 7,
        startMs: Date.parse("2026-10-05T09:00:00.000Z"),
        endMs: Date.parse("2026-10-05T09:30:00.000Z"),
    };

    it("accepts an offered slot", () => {
        expect(validateSlot(good)).toEqual({ ok: true });
    });

    it("rejects past slots", () => {
        expect(validateSlot({ ...good, nowMs: good.endMs })).toEqual({
            ok: false,
            reason: "past",
        });
    });

    it("rejects out-of-hours and off-grid slots", () => {
        expect(
            validateSlot({
                ...good,
                startMs: Date.parse("2026-10-05T08:00:00.000Z"),
                endMs: Date.parse("2026-10-05T08:30:00.000Z"),
            }),
        ).toEqual({ ok: false, reason: "hours" });
        expect(
            validateSlot({
                ...good,
                startMs: Date.parse("2026-10-05T09:07:00.000Z"),
                endMs: Date.parse("2026-10-05T09:37:00.000Z"),
            }),
        ).toEqual({ ok: false, reason: "hours" });
        // Saturday.
        expect(
            validateSlot({
                ...good,
                startMs: Date.parse("2026-10-10T09:00:00.000Z"),
                endMs: Date.parse("2026-10-10T09:30:00.000Z"),
            }),
        ).toEqual({ ok: false, reason: "hours" });
    });

    it("rejects slots outside dispatcher business hours", () => {
        // 09:00Z is in-hours for a UTC customer but 04:00 for a UTC-5
        // dispatcher: a crafted customer offset must not book it.
        expect(validateSlot({ ...good, businessOffsetMin: -300 })).toEqual({
            ok: false,
            reason: "hours",
        });
        // Matching offsets are a no-op.
        expect(validateSlot({ ...good, businessOffsetMin: 0 })).toEqual({ ok: true });
    });

    it("rejects overlapping slots as taken", () => {
        expect(
            validateSlot({
                ...good,
                busy: [
                    {
                        agentId: 7,
                        startMs: Date.parse("2026-10-05T09:15:00.000Z"),
                        endMs: Date.parse("2026-10-05T09:45:00.000Z"),
                        allDay: false,
                    },
                ],
            }),
        ).toEqual({ ok: false, reason: "taken" });
    });
});

describe("bookingWindowIso", () => {
    it("covers whole client-local days in UTC", () => {
        expect(bookingWindowIso(MONDAY, 0, 2)).toEqual({
            startDate: "2026-10-05T00:00:00.000Z",
            endDate: "2026-10-07T00:00:00.000Z",
        });
    });
});
