import { describe, expect, it } from "vitest";
import { dayUtilization, weekUtilization } from "@/lib/capacity";
import type { Agent, Appointment } from "@/types";

function workingDay(startTime = "08:00", endTime = "17:00") {
    return { isWorking: true, startTime, endTime };
}

const OFF = { isWorking: false, startTime: "00:00", endTime: "00:00" };

function agent(): Agent {
    return {
        id: 1,
        name: "Smoke Agent",
        email: "agent@example.com",
        initials: "SA",
        role: "Tech",
        teamIds: [],
        skills: [],
        workingHours: {
            monday: workingDay("08:00", "16:00"),
            tuesday: workingDay("08:00", "16:00"),
            wednesday: workingDay(),
            thursday: workingDay(),
            friday: workingDay(),
            saturday: OFF,
            sunday: OFF,
        },
        isActive: true,
        color: "#3b82f6",
    };
}

function appointment(partial: Partial<Appointment> = {}): Appointment {
    return {
        id: "1",
        ticketId: "101",
        agentId: 1,
        subject: "Fix printer",
        startTime: new Date("2026-09-28T09:00:00"),
        endTime: new Date("2026-09-28T11:00:00"),
        status: "scheduled",
        colour: "#3b82f6",
        createdAt: new Date("2026-09-28T08:00:00"),
        updatedAt: new Date("2026-09-28T08:00:00"),
        ...partial,
    } as Appointment;
}

describe("dayUtilization", () => {
    it("computes scheduled vs available hours for a working day", () => {
        const monday = new Date("2026-09-28T12:00:00"); // a Monday
        const result = dayUtilization(agent(), [appointment()], monday);
        expect(result.isWorkingDay).toBe(true);
        expect(result.availableHours).toBe(8);
        expect(result.scheduledHours).toBe(2);
        expect(result.percentage).toBe(25);
    });

    it("ignores appointments without a linked ticket", () => {
        const monday = new Date("2026-09-28T12:00:00");
        const result = dayUtilization(
            agent(),
            [appointment({ ticketId: "" }), appointment({ ticketId: undefined })],
            monday,
        );
        expect(result.scheduledHours).toBe(0);
        expect(result.percentage).toBe(0);
    });

    it("ignores other agents and other days", () => {
        const monday = new Date("2026-09-28T12:00:00");
        const result = dayUtilization(
            agent(),
            [
                appointment({ agentId: 2 }),
                appointment({
                    startTime: new Date("2026-09-29T09:00:00"),
                    endTime: new Date("2026-09-29T11:00:00"),
                }),
            ],
            monday,
        );
        expect(result.scheduledHours).toBe(0);
    });

    it("reports a non-working day with zero availability", () => {
        const saturday = new Date("2026-10-03T12:00:00");
        const result = dayUtilization(agent(), [appointment()], saturday);
        expect(result).toEqual({
            isWorkingDay: false,
            availableHours: 0,
            scheduledHours: 0,
            percentage: 0,
        });
    });

    it("allows percentages over 100 for overbooked days", () => {
        const monday = new Date("2026-09-28T12:00:00");
        const allDay = appointment({
            startTime: new Date("2026-09-28T08:00:00"),
            endTime: new Date("2026-09-28T18:00:00"),
        });
        const result = dayUtilization(agent(), [allDay], monday);
        expect(result.percentage).toBe(125);
    });
});

describe("weekUtilization", () => {
    it("sums working days and skips the weekend", () => {
        const weekStart = new Date("2026-09-28T00:00:00"); // Monday
        const result = weekUtilization(
            agent(),
            [
                appointment(),
                appointment({
                    id: "2",
                    startTime: new Date("2026-09-29T09:00:00"),
                    endTime: new Date("2026-09-29T12:00:00"),
                }),
            ],
            weekStart,
            7,
        );
        expect(result.workingDays).toBe(5);
        expect(result.availableHours).toBe(8 + 8 + 9 + 9 + 9);
        expect(result.scheduledHours).toBe(5);
        expect(result.percentage).toBeCloseTo((5 / 43) * 100, 5);
    });
});
