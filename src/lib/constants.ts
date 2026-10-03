/**
 * Centralized constants for dispatch store + touched calendar/ticket UI.
 *
 * Previously these values were scattered as literals across the store and
 * calendar components (refresh intervals, Halo status codes, default working
 * hours, persistence keys). Named exports keep every consumer on one value.
 */

// --- Calendar ---
/** Monday-first weeks everywhere (date-fns `weekStartsOn`). */
export const WEEK_STARTS_ON = 1;

/** Fallback colour for agents without a Halo colour. */
export const DEFAULT_AGENT_COLOUR = "#6366f1";

/** Grey applied to completed appointments (overrides the Halo colour). */
export const COMPLETED_APPOINTMENT_COLOUR = "#9ca3af";

/** Default working day used when Halo provides no schedule (HH:mm). */
export const DEFAULT_WORKDAY_START = "09:00";
export const DEFAULT_WORKDAY_END = "17:00";

/** Golden-angle step so generated team colours stay visually distinct. */
export const TEAM_COLOUR_HUE_STEP = 137.5;

export function teamColourForSequence(sequence: number): string {
    return `hsl(${(sequence * TEAM_COLOUR_HUE_STEP) % 360}, 70%, 50%)`;
}

// --- Halo appointment status codes ---
/** Halo `complete_status` value meaning "completed". */
export const APPOINTMENT_COMPLETE_STATUS = 0;
/** Halo `status` value meaning "in progress". */
export const APPOINTMENT_IN_PROGRESS_STATUS = 1;

// --- Tickets ---
/** Default page size for ticket list queries. */
export const DEFAULT_PAGE_SIZE = 100;
/** Default ticket auto-refresh interval. */
export const TICKET_AUTO_REFRESH_INTERVAL_MS = 60_000;

// --- Appointments ---
/** Background appointment refresh interval. */
export const APPOINTMENT_AUTO_REFRESH_INTERVAL_MS = 3 * 60 * 1000;

// --- Persistence ---
/** zustand persist key for the ticket-area/list selection (single source). */
export const SELECTION_STORAGE_KEY = "halo-dispatch-selection";
/** Legacy manual-localStorage keys, consumed once then removed. */
export const LEGACY_AREA_STORAGE_KEY = "halo-selected-ticket-area";
export const LEGACY_LISTS_STORAGE_KEY = "halo-selected-lists";
