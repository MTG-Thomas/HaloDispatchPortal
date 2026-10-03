import {
    startOfDay,
    endOfDay,
    startOfWeek,
    endOfWeek,
    startOfMonth,
    endOfMonth,
} from "date-fns";
import { WEEK_STARTS_ON } from "@/lib/constants";
import type { CalendarView } from "@/types";

export interface DateRange {
    startDate: Date;
    endDate: Date;
}

/**
 * Parse a Halo UTC datetime string into a local Date.
 *
 * Halo sometimes returns datetimes without a `Z` suffix even though they are
 * UTC; appending `Z` keeps them from being parsed as local time.
 */
export function parseHaloUtcDate(value: string): Date {
    return new Date(value.endsWith("Z") ? value : `${value}Z`);
}

/**
 * Date range to load appointments for, given the current calendar view.
 *
 * Centralizes the day/week/month range math previously triplicated in the
 * store auto-refresh, the calendar header refresh, and the appointment
 * context menu.
 */
export function getViewDateRange(
    view: CalendarView,
    selectedDate: Date
): DateRange {
    switch (view) {
        case "day":
            return {
                startDate: startOfDay(selectedDate),
                endDate: endOfDay(selectedDate),
            };
        case "week5":
        case "week7":
            return {
                startDate: startOfWeek(selectedDate, {
                    weekStartsOn: WEEK_STARTS_ON,
                }),
                endDate: endOfWeek(selectedDate, {
                    weekStartsOn: WEEK_STARTS_ON,
                }),
            };
        case "month":
            return {
                startDate: startOfMonth(selectedDate),
                endDate: endOfMonth(selectedDate),
            };
    }
}
