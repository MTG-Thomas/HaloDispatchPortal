/**
 * Customer-booking slot engine (pure: no fetch, no KV, no DOM).
 *
 * Rules mirror the SPA calendar exactly:
 * - Grid step from `DEFAULT_CALENDAR_CONFIG.slotIncrement` (15 min).
 * - Working window per agent from `schedules` (full `/api/agent` rows via
 *   the cached directory in `./schedules`), falling back to
 *   `DEFAULT_WORKDAY_START/END` (09:00-17:00, Mon-Fri) when an agent has no
 *   usable bounds. The ClientCache `agents[]` directory carries no schedule
 *   (verified: its fixture entries have no workhour fields), which is why
 *   the Worker fetches the full agent directory instead.
 * - Busy blocks come from live Halo appointments parsed as UTC, the same way
 *   `parseHaloUtcDate` treats Halo's datetimes (UTC even without a `Z`).
 * - Client-local day boundaries come from the caller's `utcOffsetMin`
 *   (same convention as the SPA `getUtcOffset` / Halo `utcoffset` param).
 * - When the record carries the dispatcher's mint-time offset
 *   (`businessOffsetMin`), slots must also sit inside business hours in
 *   that offset, so a crafted customer offset cannot book 02:00
 *   business-time appointments.
 * - A mint-time `bufferMin` expands every busy block on both sides, so
 *   back-to-back slots next to an appointment are not offered (or booked).
 * - An agent whose scheduled time already fills the day (shared
 *   `dayUtilization` cap, percentage >= 100) offers nothing that day.
 */

import { DEFAULT_CALENDAR_CONFIG } from "../src/lib/calendarConfig";
import { dayUtilization } from "../src/lib/capacity";
import { DEFAULT_WORKDAY_END, DEFAULT_WORKDAY_START } from "../src/lib/constants";
import type { Agent, Appointment } from "../src/types";

export interface SlotBusyBlock {
    agentId: number;
    /** UTC epoch millis, parsed as UTC (Halo datetimes lack `Z`). */
    startMs: number;
    endMs: number;
    allDay: boolean;
}

/** Parse a Halo UTC datetime the way `parseHaloUtcDate` does. */
export function parseHaloDateMs(value: string): number {
    return new Date(value.endsWith("Z") ? value : `${value}Z`).getTime();
}

export interface SlotOption {
    agentId: number;
    /** ISO UTC instant. */
    start: string;
    end: string;
}

export interface DaySlots {
    /** Client-local calendar day (YYYY-MM-DD). */
    date: string;
    slots: SlotOption[];
}

/** Working window in minutes after local midnight. */
export interface AgentWindow {
    startMin: number;
    endMin: number;
}

/** Per-agent working window; agents without one use the 09:00-17:00 default. */
export interface AgentSchedule extends AgentWindow {
    agentId: number;
}

export interface ComputeSlotsInput {
    agentIds: number[];
    busy: SlotBusyBlock[];
    nowMs: number;
    /** Client-local minutes east of UTC (negated `getTimezoneOffset`). */
    utcOffsetMin: number;
    /** Window length in days, starting today (client-local). Default 14. */
    days?: number;
    /** Slot length in minutes. Default 30 (dispatch default duration). */
    durationMin?: number;
    /**
     * Dispatcher-local minutes east of UTC, captured at mint time. When set,
     * offered slots must ALSO fall inside business hours in this offset, so
     * a customer cannot pick a UTC offset that makes 02:00 business time
     * look like 09:00 local. Day grouping stays in the customer offset.
     */
    businessOffsetMin?: number;
    /**
     * Per-agent working windows (see `./schedules`). Agents with no entry —
     * or an unusable one — fall back to the 09:00-17:00 defaults.
     */
    schedules?: AgentSchedule[];
    /**
     * Buffer minutes around each busy block (both sides). A slot touching
     * the expanded block is not offered. Default {@link DEFAULT_SLOT_BUFFER_MIN}.
     */
    bufferMin?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_SLOT_DAYS = 14;
export const DEFAULT_SLOT_DURATION_MIN = 30;
/** Offered durations match the dispatch duration presets. */
export const ALLOWED_SLOT_DURATIONS = [15, 30, 45, 60] as const;
/**
 * Default buffer around busy blocks. Zero preserves back-to-back booking;
 * dispatchers opt into buffers per link via the mint-time `bufferMin`.
 */
export const DEFAULT_SLOT_BUFFER_MIN = 0;
/** Upper bound for mint-time `bufferMin` (at most one hour each side). */
export const MAX_SLOT_BUFFER_MIN = 60;

function parseWorkdayMinutes(value: string): number {
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
}

export function workdayWindowMinutes(): { startMin: number; endMin: number; gridMin: number } {
    return {
        startMin: parseWorkdayMinutes(DEFAULT_WORKDAY_START),
        endMin: parseWorkdayMinutes(DEFAULT_WORKDAY_END),
        gridMin: DEFAULT_CALENDAR_CONFIG.slotIncrement,
    };
}

/** UTC instant of client-local midnight `dayOffset` days after today. */
function localMidnightUtcMs(nowMs: number, utcOffsetMin: number, dayOffset: number): number {
    const localNow = nowMs + utcOffsetMin * 60_000;
    const localMidnight = Math.floor(localNow / DAY_MS) * DAY_MS;
    return localMidnight + dayOffset * DAY_MS - utcOffsetMin * 60_000;
}

function localDateString(localMidnightAsUtcMs: number): string {
    return new Date(localMidnightAsUtcMs).toISOString().slice(0, 10);
}

/** Sunday = 0 ... Saturday = 6, in client-local time. */
function localWeekday(localMidnightAsUtcMs: number): number {
    return new Date(localMidnightAsUtcMs).getUTCDay();
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
    return aStart < bEnd && bStart < aEnd;
}

/** An agent's working window, or the default when they have no usable entry. */
function windowForAgent(
    schedules: AgentSchedule[] | undefined,
    agentId: number,
    fallback: AgentWindow,
): AgentWindow {
    const match = schedules?.find((s) => s.agentId === agentId);
    if (
        match &&
        Number.isFinite(match.startMin) &&
        Number.isFinite(match.endMin) &&
        match.startMin >= 0 &&
        match.endMin <= 24 * 60 &&
        match.endMin > match.startMin
    ) {
        return { startMin: match.startMin, endMin: match.endMin };
    }
    return fallback;
}

/** Clamp a mint-time buffer to the supported range (default 0). */
function normalizeBufferMin(value: number | undefined): number {
    if (value === undefined || !Number.isFinite(value)) {
        return DEFAULT_SLOT_BUFFER_MIN;
    }
    return Math.min(Math.max(Math.floor(value), 0), MAX_SLOT_BUFFER_MIN);
}

/** True when the slot touches the busy block expanded by the buffer. */
function overlapsBuffered(
    startMs: number,
    endMs: number,
    block: SlotBusyBlock,
    bufferMs: number,
): boolean {
    return overlaps(startMs, endMs, block.startMs - bufferMs, block.endMs + bufferMs);
}

/**
 * Synthetic agent mirroring the slot-engine workday (Mon-Fri 09:00-17:00
 * defaults), so the shared capacity rules judge the same working day the
 * slots are offered in.
 */
function syntheticAgent(agentId: number): Agent {
    const working = {
        isWorking: true,
        startTime: DEFAULT_WORKDAY_START,
        endTime: DEFAULT_WORKDAY_END,
    };
    const off = {
        isWorking: false,
        startTime: DEFAULT_WORKDAY_START,
        endTime: DEFAULT_WORKDAY_END,
    };
    return {
        id: agentId,
        name: `Agent ${agentId}`,
        email: "",
        initials: "",
        role: "",
        teamIds: [],
        skills: [],
        workingHours: {
            monday: working,
            tuesday: working,
            wednesday: working,
            thursday: working,
            friday: working,
            saturday: off,
            sunday: off,
        },
        isActive: true,
        color: "",
    };
}

/**
 * True when the agent's scheduled time already fills the client-local day
 * (shared `dayUtilization` cap: percentage >= 100, same as
 * `isAgentOverbooked`). Busy blocks and the day marker shift by the client
 * offset so the UTC-day comparison inside `dayUtilization` lands on the
 * client-local day; durations are unchanged by the shift.
 */
function isAgentDayFull(
    agentId: number,
    agentBusy: SlotBusyBlock[],
    midnightUtc: number,
    utcOffsetMin: number,
): boolean {
    const offsetMs = utcOffsetMin * 60_000;
    const appointments: Appointment[] = agentBusy.map((block, index) => ({
        id: `busy-${agentId}-${index}`,
        ticketId: "1",
        agentId,
        startTime: new Date(block.startMs + offsetMs),
        endTime: new Date(block.endMs + offsetMs),
        status: "scheduled",
        isAllDay: block.allDay,
        isTentative: false,
        createdAt: new Date(block.startMs + offsetMs),
        updatedAt: new Date(block.startMs + offsetMs),
    }));
    const day = dayUtilization(
        syntheticAgent(agentId),
        appointments,
        new Date(midnightUtc + offsetMs + 12 * 60 * 60 * 1000),
    );
    return day.isWorkingDay && day.percentage >= 100;
}

/**
 * True when [startMs, endMs) sits on a Mon-Fri working day fully inside the
 * working window (per-agent `window`, else the 09:00-17:00 default), measured
 * in the given UTC offset. No grid, past, or overlap checks — the
 * second-offset business-hours gate shared by offer and book paths.
 */
export function withinBusinessHours(
    startMs: number,
    endMs: number,
    offsetMin: number,
    window?: AgentWindow,
): boolean {
    if (!(endMs > startMs)) {
        return false;
    }
    const { startMin, endMin } = window ?? workdayWindowMinutes();
    const offsetMs = offsetMin * 60_000;
    const localStart = startMs + offsetMs;
    const localMidnight = Math.floor(localStart / DAY_MS) * DAY_MS;
    const weekday = new Date(localMidnight).getUTCDay();
    if (weekday === 0 || weekday === 6) {
        return false;
    }
    const startMinOfDay = Math.round((localStart - localMidnight) / 60_000);
    const endMinOfDay = Math.round((endMs + offsetMs - localMidnight) / 60_000);
    return startMinOfDay >= startMin && endMinOfDay <= endMin && endMinOfDay > startMinOfDay;
}

/**
 * Offered slots per day (only days with at least one free slot are returned).
 * A slot is offered when it starts in the future, fits inside working hours
 * on a Mon-Fri working day, aligns to the calendar grid, and overlaps no
 * buffer-expanded busy block for that agent. An all-day block for an agent,
 * or a day already at the shared utilization cap, removes their whole day.
 */
export function computeSlots(input: ComputeSlotsInput): DaySlots[] {
    const days = input.days ?? DEFAULT_SLOT_DAYS;
    const durationMin = input.durationMin ?? DEFAULT_SLOT_DURATION_MIN;
    const fallback = workdayWindowMinutes();
    const gridMin = fallback.gridMin;
    const bufferMs = normalizeBufferMin(input.bufferMin) * 60_000;
    const out: DaySlots[] = [];

    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
        const midnightUtc = localMidnightUtcMs(input.nowMs, input.utcOffsetMin, dayOffset);
        const localMidnightAsUtc = midnightUtc + input.utcOffsetMin * 60_000;
        if (localWeekday(localMidnightAsUtc) === 0 || localWeekday(localMidnightAsUtc) === 6) {
            continue;
        }
        const dayEndUtc = midnightUtc + DAY_MS;
        const slots: SlotOption[] = [];
        for (const agentId of input.agentIds) {
            const { startMin, endMin } = windowForAgent(input.schedules, agentId, fallback);
            const agentBusy = input.busy.filter((b) => b.agentId === agentId);
            if (
                agentBusy.some(
                    (b) => b.allDay && overlaps(b.startMs, b.endMs, midnightUtc, dayEndUtc),
                )
            ) {
                continue;
            }
            if (isAgentDayFull(agentId, agentBusy, midnightUtc, input.utcOffsetMin)) {
                continue;
            }
            for (let t = startMin; t + durationMin <= endMin; t += gridMin) {
                const startMs = midnightUtc + t * 60_000;
                if (startMs <= input.nowMs) {
                    continue;
                }
                const endMs = startMs + durationMin * 60_000;
                if (
                    input.businessOffsetMin !== undefined &&
                    input.businessOffsetMin !== input.utcOffsetMin &&
                    !withinBusinessHours(startMs, endMs, input.businessOffsetMin, {
                        startMin,
                        endMin,
                    })
                ) {
                    continue;
                }
                if (agentBusy.some((b) => overlapsBuffered(startMs, endMs, b, bufferMs))) {
                    continue;
                }
                slots.push({
                    agentId,
                    start: new Date(startMs).toISOString(),
                    end: new Date(endMs).toISOString(),
                });
            }
        }
        if (slots.length > 0) {
            slots.sort((a, b) =>
                a.start < b.start ? -1 : a.start > b.start ? 1 : a.agentId - b.agentId,
            );
            out.push({ date: localDateString(localMidnightAsUtc), slots });
        }
    }
    return out;
}

export type SlotCheck = { ok: true } | { ok: false; reason: "past" | "hours" | "taken" };

export interface ValidateSlotInput {
    busy: SlotBusyBlock[];
    nowMs: number;
    utcOffsetMin: number;
    agentId: number;
    startMs: number;
    endMs: number;
    /**
     * Dispatcher-local offset (see ComputeSlotsInput). When set and different
     * from `utcOffsetMin`, the slot must also sit inside business hours in
     * this offset. Grid alignment stays in the customer offset.
     */
    businessOffsetMin?: number;
    /**
     * Per-agent working windows (see `./schedules`). Agents with no entry —
     * or an unusable one — fall back to the 09:00-17:00 defaults.
     */
    schedules?: AgentSchedule[];
    /**
     * Buffer minutes around each busy block (both sides), mirroring
     * `computeSlots`. Default {@link DEFAULT_SLOT_BUFFER_MIN}.
     */
    bufferMin?: number;
}

/**
 * Re-validate one chosen slot against the same rules `computeSlots` uses
 * (book-time recheck against live appointments). Duration/grid shape is
 * validated by the caller; this checks past, working hours, and
 * buffer-expanded overlap. The utilization cap is offering-only: the book
 * path rechecks a partial window, so the slots-time gate stays
 * authoritative and the single-book flow is unchanged.
 */
export function validateSlot(input: ValidateSlotInput): SlotCheck {
    if (!(input.endMs > input.startMs) || input.startMs <= input.nowMs) {
        return { ok: false, reason: "past" };
    }
    const bufferMs = normalizeBufferMin(input.bufferMin) * 60_000;
    const fallback = workdayWindowMinutes();
    const { startMin, endMin } = windowForAgent(input.schedules, input.agentId, fallback);
    const gridMin = fallback.gridMin;
    const offsetMs = input.utcOffsetMin * 60_000;
    const localStart = input.startMs + offsetMs;
    const localMidnight = Math.floor(localStart / DAY_MS) * DAY_MS;
    const weekday = new Date(localMidnight).getUTCDay();
    if (weekday === 0 || weekday === 6) {
        return { ok: false, reason: "hours" };
    }
    const startMinOfDay = Math.round((localStart - localMidnight) / 60_000);
    const endMinOfDay = Math.round((input.endMs + offsetMs - localMidnight) / 60_000);
    if (
        startMinOfDay < startMin ||
        endMinOfDay > endMin ||
        endMinOfDay <= startMinOfDay ||
        (startMinOfDay - startMin) % gridMin !== 0
    ) {
        return { ok: false, reason: "hours" };
    }
    if (
        input.businessOffsetMin !== undefined &&
        input.businessOffsetMin !== input.utcOffsetMin &&
        !withinBusinessHours(input.startMs, input.endMs, input.businessOffsetMin, {
            startMin,
            endMin,
        })
    ) {
        return { ok: false, reason: "hours" };
    }
    const agentBusy = input.busy.filter((b) => b.agentId === input.agentId);
    if (
        agentBusy.some(
            (b) =>
                b.allDay &&
                overlaps(
                    b.startMs,
                    b.endMs,
                    localMidnight - offsetMs,
                    localMidnight - offsetMs + DAY_MS,
                ),
        ) ||
        agentBusy.some((b) => overlapsBuffered(input.startMs, input.endMs, b, bufferMs))
    ) {
        return { ok: false, reason: "taken" };
    }
    return { ok: true };
}

/** Halo query window (ISO UTC) covering the client-local slot window. */
export function bookingWindowIso(
    nowMs: number,
    utcOffsetMin: number,
    days: number,
): { startDate: string; endDate: string } {
    const startMs = localMidnightUtcMs(nowMs, utcOffsetMin, 0);
    return {
        startDate: new Date(startMs).toISOString(),
        endDate: new Date(startMs + days * DAY_MS).toISOString(),
    };
}

/**
 * Window length (in days) so `computeSlots` covers every occurrence date.
 * Occurrence dates are client-local YYYY-MM-DD, the same strings `computeSlots`
 * emits as day labels; past occurrences need no extra days. The caller caps
 * the result at the slots `days` maximum.
 */
export function daysToCoverOccurrences(
    nowMs: number,
    utcOffsetMin: number,
    occurrences: string[],
    fallbackDays: number,
): number {
    const todayLocal = Math.floor((nowMs + utcOffsetMin * 60_000) / DAY_MS) * DAY_MS;
    let needed = fallbackDays;
    for (const date of occurrences) {
        const occurrenceMs = Date.parse(`${date}T00:00:00.000Z`);
        if (!Number.isFinite(occurrenceMs)) {
            continue;
        }
        const diffDays = Math.round((occurrenceMs - todayLocal) / DAY_MS);
        if (diffDays >= 0) {
            needed = Math.max(needed, diffDays + 1);
        }
    }
    return needed;
}
