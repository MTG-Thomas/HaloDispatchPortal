import { addDays, isSameDay } from "date-fns";
import type { Agent, Appointment } from "@/types";

export interface DayUtilization {
    /** False for non-working days (or when the schedule has no hours). */
    isWorkingDay: boolean;
    availableHours: number;
    scheduledHours: number;
    /** scheduled / available * 100; 0 when unavailable. May exceed 100. */
    percentage: number;
}

const DAY_NAMES = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
] as const;

type DayName = (typeof DAY_NAMES)[number];

function parseHoursPerDay(
    agent: Agent,
    date: Date,
): { isWorkingDay: boolean; availableHours: number } {
    const dayName = DAY_NAMES[date.getDay()] as DayName;
    const workingDay = agent.workingHours[dayName];
    if (!workingDay.isWorking) {
        return { isWorkingDay: false, availableHours: 0 };
    }
    const [startHour, startMinute] = workingDay.startTime.split(":").map(Number);
    const [endHour, endMinute] = workingDay.endTime.split(":").map(Number);
    const availableHours = (endHour * 60 + endMinute - (startHour * 60 + startMinute)) / 60;
    if (!(availableHours > 0)) {
        return { isWorkingDay: false, availableHours: 0 };
    }
    return { isWorkingDay: true, availableHours };
}

/**
 * Day utilization for one agent. Only appointments linked to a ticket count
 * toward scheduled time (placeholder/personal blocks are excluded).
 */
export function dayUtilization(
    agent: Agent,
    appointments: Appointment[],
    date: Date,
): DayUtilization {
    const { isWorkingDay, availableHours } = parseHoursPerDay(agent, date);
    if (!isWorkingDay) {
        return { isWorkingDay: false, availableHours: 0, scheduledHours: 0, percentage: 0 };
    }
    const scheduledMinutes = appointments
        .filter((apt) => apt.agentId === agent.id && isSameDay(apt.startTime, date) && apt.ticketId)
        .reduce(
            (total, apt) => total + (apt.endTime.getTime() - apt.startTime.getTime()) / (1000 * 60),
            0,
        );
    const scheduledHours = scheduledMinutes / 60;
    return {
        isWorkingDay: true,
        availableHours,
        scheduledHours,
        percentage: (scheduledHours / availableHours) * 100,
    };
}

export interface WeekUtilization {
    workingDays: number;
    availableHours: number;
    scheduledHours: number;
    percentage: number;
}

/** Week totals: same per-day rules as {@link dayUtilization}, summed. */
export function weekUtilization(
    agent: Agent,
    appointments: Appointment[],
    weekStart: Date,
    daysToShow: number,
): WeekUtilization {
    let workingDays = 0;
    let availableHours = 0;
    let scheduledHours = 0;
    for (let i = 0; i < daysToShow; i++) {
        const day = dayUtilization(agent, appointments, addDays(weekStart, i));
        if (!day.isWorkingDay) continue;
        workingDays += 1;
        availableHours += day.availableHours;
        scheduledHours += day.scheduledHours;
    }
    return {
        workingDays,
        availableHours,
        scheduledHours,
        percentage: availableHours > 0 ? (scheduledHours / availableHours) * 100 : 0,
    };
}
