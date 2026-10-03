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

    it("expands busy blocks by the mint-time buffer", () => {
        const busy = [
            {
                agentId: 7,
                startMs: Date.parse("2026-10-05T10:00:00.000Z"),
                endMs: Date.parse("2026-10-05T11:00:00.000Z"),
                allDay: false,
            },
        ];
        const days = computeSlots({
            agentIds: [7, 9],
            busy,
            nowMs: MONDAY,
            utcOffsetMin: 0,
            days: 1,
            bufferMin: 15,
        });
        const starts7 = days[0].slots.filter((s) => s.agentId === 7).map((s) => s.start);
        // Expanded block is 09:45-11:15: touching slots stay, overlapping go.
        expect(starts7).toContain("2026-10-05T09:00:00.000Z");
        expect(starts7).toContain("2026-10-05T09:15:00.000Z");
        expect(starts7).not.toContain("2026-10-05T09:30:00.000Z");
        expect(starts7).not.toContain("2026-10-05T10:00:00.000Z");
        expect(starts7).not.toContain("2026-10-05T11:00:00.000Z");
        expect(starts7).toContain("2026-10-05T11:15:00.000Z");
        // Other agents are unaffected by the buffer.
        const starts9 = days[0].slots.filter((s) => s.agentId === 9).map((s) => s.start);
        expect(starts9).toContain("2026-10-05T10:00:00.000Z");
    });

    it("treats an explicit zero buffer like the default", () => {
        const busy = [
            {
                agentId: 7,
                startMs: Date.parse("2026-10-05T09:00:00.000Z"),
                endMs: Date.parse("2026-10-05T10:00:00.000Z"),
                allDay: false,
            },
        ];
        for (const bufferMin of [undefined, 0] as const) {
            const days = computeSlots({
                agentIds: [7],
                busy,
                nowMs: MONDAY,
                utcOffsetMin: 0,
                days: 1,
                bufferMin,
            });
            // Back-to-back stays bookable without a buffer.
            expect(days[0].slots[0].start).toBe("2026-10-05T10:00:00.000Z");
        }
    });

    it("offers nothing for an agent already at the utilization cap", () => {
        // 08:00-16:00 is 8h of an 8h day: 16:00-17:00 looks free by overlap
        // alone, but the shared cap (>= 100%) removes the whole day.
        const busy = [
            {
                agentId: 7,
                startMs: Date.parse("2026-10-05T08:00:00.000Z"),
                endMs: Date.parse("2026-10-05T16:00:00.000Z"),
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
        expect(days).toHaveLength(1);
        expect(days[0].slots.filter((s) => s.agentId === 7)).toHaveLength(0);
        expect(days[0].slots.filter((s) => s.agentId === 9).length).toBeGreaterThan(0);
    });

    it("keeps days under the cap bookable", () => {
        // 7.5h of 8h (93.75%): the 16:30 slot is still offered.
        const busy = [
            {
                agentId: 7,
                startMs: Date.parse("2026-10-05T09:00:00.000Z"),
                endMs: Date.parse("2026-10-05T16:30:00.000Z"),
                allDay: false,
            },
        ];
        const days = computeSlots({
            agentIds: [7],
            busy,
            nowMs: MONDAY,
            utcOffsetMin: 0,
            days: 1,
        });
        expect(days[0].slots.map((s) => s.start)).toContain("2026-10-05T16:30:00.000Z");
    });

    it("excludes over-capacity days even with a visible gap", () => {
        // 07:00-12:00 + 12:00-16:00 is 9h of an 8h day (112.5%).
        const busy = [
            {
                agentId: 7,
                startMs: Date.parse("2026-10-05T07:00:00.000Z"),
                endMs: Date.parse("2026-10-05T12:00:00.000Z"),
                allDay: false,
            },
            {
                agentId: 7,
                startMs: Date.parse("2026-10-05T12:00:00.000Z"),
                endMs: Date.parse("2026-10-05T16:00:00.000Z"),
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
        expect(days[0].slots.filter((s) => s.agentId === 7)).toHaveLength(0);
        expect(days[0].slots.filter((s) => s.agentId === 9).length).toBeGreaterThan(0);
    });

    it("attributes capacity to the client-local day in other timezones", () => {
        // UTC+10: local Monday 08:00-16:00 is Sun 22:00Z - Mon 06:00Z. The
        // 8h fill the local day even though the UTC start is on Sunday.
        const sundayEveningUtc = Date.parse("2026-10-04T14:00:00.000Z");
        const busy = [
            {
                agentId: 7,
                startMs: Date.parse("2026-10-04T22:00:00.000Z"),
                endMs: Date.parse("2026-10-05T06:00:00.000Z"),
                allDay: false,
            },
        ];
        const days = computeSlots({
            agentIds: [7, 9],
            busy,
            nowMs: sundayEveningUtc,
            utcOffsetMin: 600,
            days: 1,
        });
        expect(days).toHaveLength(1);
        expect(days[0].date).toBe("2026-10-05");
        expect(days[0].slots.filter((s) => s.agentId === 7)).toHaveLength(0);
        expect(days[0].slots.filter((s) => s.agentId === 9).length).toBeGreaterThan(0);
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

    it("rejects back-to-back slots as taken when buffered", () => {
        // 09:00-09:30 slot, back-to-back on both sides.
        const busyBefore = [
            {
                agentId: 7,
                startMs: Date.parse("2026-10-05T08:30:00.000Z"),
                endMs: Date.parse("2026-10-05T09:00:00.000Z"),
                allDay: false,
            },
        ];
        const busyAfter = [
            {
                agentId: 7,
                startMs: Date.parse("2026-10-05T09:30:00.000Z"),
                endMs: Date.parse("2026-10-05T10:00:00.000Z"),
                allDay: false,
            },
        ];
        for (const busy of [busyBefore, busyAfter]) {
            expect(validateSlot({ ...good, busy })).toEqual({ ok: true });
            expect(validateSlot({ ...good, busy, bufferMin: 0 })).toEqual({ ok: true });
            expect(validateSlot({ ...good, busy, bufferMin: 15 })).toEqual({
                ok: false,
                reason: "taken",
            });
        }
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

describe("per-agent schedules", () => {
    const shortDay = [{ agentId: 7, startMin: 600, endMin: 720 }]; // 10:00-12:00

    it("offers slots inside the agent's custom window", () => {
        const days = computeSlots({
            agentIds: [7],
            busy: [],
            nowMs: MONDAY,
            utcOffsetMin: 0,
            days: 1,
            schedules: shortDay,
        });
        expect(days).toHaveLength(1);
        // 10:00..11:30 starts on a 15-minute grid.
        expect(days[0].slots).toHaveLength(7);
        expect(days[0].slots[0]).toEqual({
            agentId: 7,
            start: "2026-10-05T10:00:00.000Z",
            end: "2026-10-05T10:30:00.000Z",
        });
        const last = days[0].slots[days[0].slots.length - 1];
        expect(last.start).toBe("2026-10-05T11:30:00.000Z");
        expect(last.end).toBe("2026-10-05T12:00:00.000Z");
    });

    it("falls back to 09:00-17:00 for agents without a schedule", () => {
        const days = computeSlots({
            agentIds: [7, 9],
            busy: [],
            nowMs: MONDAY,
            utcOffsetMin: 0,
            days: 1,
            schedules: shortDay,
        });
        const custom = days[0].slots.filter((s) => s.agentId === 7);
        const fallback = days[0].slots.filter((s) => s.agentId === 9);
        expect(custom[0].start).toBe("2026-10-05T10:00:00.000Z");
        expect(fallback[0].start).toBe("2026-10-05T09:00:00.000Z");
        expect(fallback).toHaveLength(31);
    });

    it("falls back when a schedule entry is unusable", () => {
        for (const schedules of [
            [{ agentId: 7, startMin: 720, endMin: 600 }],
            [{ agentId: 7, startMin: 600, endMin: 600 }],
            [{ agentId: 7, startMin: NaN, endMin: 720 }],
            [{ agentId: 7, startMin: -30, endMin: 720 }],
            [{ agentId: 7, startMin: 600, endMin: 24 * 60 + 1 }],
        ]) {
            const days = computeSlots({
                agentIds: [7],
                busy: [],
                nowMs: MONDAY,
                utcOffsetMin: 0,
                days: 1,
                schedules,
            });
            expect(days[0].slots).toHaveLength(31);
            expect(days[0].slots[0].start).toBe("2026-10-05T09:00:00.000Z");
        }
    });

    it("enforces the agent window in the dispatcher offset too", () => {
        // Customer UTC+1: customer-local 10:00 is 09:00Z, outside the
        // agent's 10:00-12:00 window in the dispatcher (UTC) offset, so the
        // first offered slot starts at 10:00Z (11:00 customer-local).
        const days = computeSlots({
            agentIds: [7],
            busy: [],
            nowMs: MONDAY,
            utcOffsetMin: 60,
            businessOffsetMin: 0,
            days: 1,
            schedules: shortDay,
        });
        expect(days[0].slots[0].start).toBe("2026-10-05T10:00:00.000Z");
    });

    it("checks withinBusinessHours against a custom window", () => {
        const window = { startMin: 600, endMin: 720 };
        expect(
            withinBusinessHours(
                Date.parse("2026-10-05T09:00:00.000Z"),
                Date.parse("2026-10-05T09:30:00.000Z"),
                0,
                window,
            ),
        ).toBe(false);
        expect(
            withinBusinessHours(
                Date.parse("2026-10-05T10:00:00.000Z"),
                Date.parse("2026-10-05T10:30:00.000Z"),
                0,
                window,
            ),
        ).toBe(true);
    });

    it("validates bookings against the agent's window", () => {
        const base = {
            busy: [],
            nowMs: MONDAY,
            utcOffsetMin: 0,
            agentId: 7,
            schedules: shortDay,
        };
        // 10:00 books for the custom-window agent.
        expect(
            validateSlot({
                ...base,
                startMs: Date.parse("2026-10-05T10:00:00.000Z"),
                endMs: Date.parse("2026-10-05T10:30:00.000Z"),
            }),
        ).toEqual({ ok: true });
        // 09:00 does not: outside their window.
        expect(
            validateSlot({
                ...base,
                startMs: Date.parse("2026-10-05T09:00:00.000Z"),
                endMs: Date.parse("2026-10-05T09:30:00.000Z"),
            }),
        ).toEqual({ ok: false, reason: "hours" });
        // Grid alignment is relative to the custom window start.
        expect(
            validateSlot({
                ...base,
                startMs: Date.parse("2026-10-05T10:07:00.000Z"),
                endMs: Date.parse("2026-10-05T10:37:00.000Z"),
            }),
        ).toEqual({ ok: false, reason: "hours" });
        // Another agent without a schedule still books 09:00.
        expect(
            validateSlot({
                ...base,
                agentId: 9,
                startMs: Date.parse("2026-10-05T09:00:00.000Z"),
                endMs: Date.parse("2026-10-05T09:30:00.000Z"),
            }),
        ).toEqual({ ok: true });
    });

    it("validates bookings against the agent window in the dispatcher offset", () => {
        // 09:00Z is 10:00 for a UTC+1 customer (in the 10:00-12:00 window)
        // but 09:00 for a UTC dispatcher (outside it).
        expect(
            validateSlot({
                busy: [],
                nowMs: MONDAY,
                utcOffsetMin: 60,
                agentId: 7,
                startMs: Date.parse("2026-10-05T09:00:00.000Z"),
                endMs: Date.parse("2026-10-05T09:30:00.000Z"),
                businessOffsetMin: 0,
                schedules: shortDay,
            }),
        ).toEqual({ ok: false, reason: "hours" });
    });
});
