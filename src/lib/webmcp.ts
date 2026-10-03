/**
 * WebMCP tool surface for the dispatch portal.
 *
 * Pinned to the W3C WebML Community Group WebMCP explainer (index.bs) as of
 * Oct 2026 — a draft, not a stable spec. The ambient types below mirror that
 * draft's shape (`document.modelContext`, `registerTool`/`getTools`/
 * `executeTool`, AbortSignal-scoped registration lifetime, JSON Schema
 * `inputSchema`, tool annotations). If the draft moves, update the types here
 * first and keep the tool factories below unchanged.
 *
 * This module is the ONLY place that touches `document.modelContext`.
 * Consumers call {@link publicBookingTools} / {@link dispatcherTools} to get
 * plain tool definitions and register them via {@link registerWebMcpTools},
 * usually through the `useWebMcpTools` hook which ties registration lifetime
 * to the mounted route. Until a browser ships WebMCP (or an OT token is
 * configured), `getModelContext()` returns null and registration is a no-op.
 *
 * Security posture:
 * - Every tool reuses the existing typed client modules (`book-api`,
 *   `session-api`), so auth, validation, and error mapping stay in one place.
 * - Dispatcher tools resolve the vault session lazily per call and throw a
 *   "not signed in" error instead of calling the BFF without credentials.
 * - Mutating tools carry `consequentialHint: true`; explicit user
 *   confirmation remains the page's own job (the agent cannot click for the
 *   user), and the tool execute path never shows UI.
 * - Execute handlers only ever reject with user-safe messages taken from the
 *   client error classes; raw response bodies are never surfaced to the model.
 */

import {
    BookApiError,
    BookingTrackerError,
    cancelBookingRequest,
    confirmBooking,
    confirmBookingSeries,
    extendBookingRequest,
    fetchBookSlots,
    fetchBookingAudit,
    fetchBookingRequests,
    fetchBookingStatus,
    type BookSeriesSelection,
} from "@/lib/book-api";
import { loadDispatcherSession } from "@/services/auth/authService";
import { scoreTicket } from "@/lib/priority-score";
import { useDispatchStore } from "@/stores/useDispatchStore";

// ---------------------------------------------------------------------------
// Draft-pinned ambient types (W3C WebML CG WebMCP index.bs, Oct 2026).
// ---------------------------------------------------------------------------

/** Tool annotations from the WebMCP draft. */
export interface WebMcpToolAnnotations {
    /** Safe read-only operation; agents may call without asking. */
    readOnlyHint?: boolean;
    /** Result contains untrusted page content; model must treat it as data. */
    untrustedContentHint?: boolean;
    /** Mutating/destructive operation; agents should confirm first. */
    consequentialHint?: boolean;
    /** Debugging-only tool. */
    debugging?: boolean;
}

/** A tool definition passed to `modelContext.registerTool`. */
export interface WebMcpToolDefinition {
    name: string;
    title?: string;
    description: string;
    /** JSON Schema for the tool's input object. */
    inputSchema?: Record<string, unknown>;
    execute: (args: unknown) => Promise<string>;
    annotations?: WebMcpToolAnnotations;
}

/** Registered-tool metadata returned by `modelContext.getTools`. */
export interface WebMcpRegisteredTool {
    name: string;
    title?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    annotations?: WebMcpToolAnnotations;
}

/** Minimal `modelContext` surface used by this repo. */
export interface WebMcpModelContext {
    registerTool(
        tool: WebMcpToolDefinition,
        options?: { signal?: AbortSignal },
    ): Promise<undefined>;
    getTools(options?: { signal?: AbortSignal }): Promise<WebMcpRegisteredTool[]>;
    executeTool(
        tool: string | WebMcpRegisteredTool,
        inputObject?: unknown,
        options?: { signal?: AbortSignal },
    ): Promise<string>;
}

// ---------------------------------------------------------------------------
// Feature detection + registration.
// ---------------------------------------------------------------------------

/**
 * Return the page's model context, or null when WebMCP is unsupported.
 * Checks `document.modelContext` first (current draft); falls back to the
 * deprecated `navigator.modelContext` alias some prototypes still expose.
 */
export function getModelContext(): WebMcpModelContext | null {
    if (typeof document !== "undefined") {
        const doc = document as unknown as { modelContext?: WebMcpModelContext };
        if (doc.modelContext) return doc.modelContext;
    }
    if (typeof navigator !== "undefined") {
        const nav = navigator as unknown as { modelContext?: WebMcpModelContext };
        if (nav.modelContext) return nav.modelContext;
    }
    return null;
}

/** True when a model context is available for tool registration. */
export function isWebMcpSupported(): boolean {
    return getModelContext() !== null;
}

export interface RegisterWebMcpToolsOptions {
    /** AbortSignal scoping the registration lifetime (route unmount). */
    signal?: AbortSignal;
}

/**
 * Register tools with the model context. Resolves with the names that were
 * accepted. Registration is best-effort per tool: a rejected tool (duplicate
 * name, invalid schema) is logged and skipped, never fatal — a half-surfaced
 * portal is better than a crashed route. Resolves `[]` when unsupported.
 */
export async function registerWebMcpTools(
    tools: WebMcpToolDefinition[],
    options: RegisterWebMcpToolsOptions = {},
): Promise<string[]> {
    const context = getModelContext();
    if (!context) return [];
    const registered: string[] = [];
    for (const tool of tools) {
        try {
            await context.registerTool(
                tool,
                options.signal ? { signal: options.signal } : undefined,
            );
            registered.push(tool.name);
        } catch (error) {
            console.warn(
                `WebMCP: skipping tool "${tool.name}":`,
                error instanceof Error ? error.message : error,
            );
        }
    }
    return registered;
}

// ---------------------------------------------------------------------------
// Argument parsing (agents send arbitrary JSON — validate everything).
// ---------------------------------------------------------------------------

function asRecord(args: unknown): Record<string, unknown> {
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
        throw new Error("Tool input must be a JSON object.");
    }
    return args as Record<string, unknown>;
}

function asOptionalNumber(value: unknown, field: string): number | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`"${field}" must be a number.`);
    }
    return value;
}

function asRequiredNumber(value: unknown, field: string): number {
    const parsed = asOptionalNumber(value, field);
    if (parsed === undefined) throw new Error(`"${field}" is required.`);
    return parsed;
}

function asRequiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`"${field}" is required.`);
    }
    return value;
}

function asRequiredIsoDate(value: unknown, field: string): string {
    const text = asRequiredString(value, field);
    if (Number.isNaN(Date.parse(text))) {
        throw new Error(`"${field}" must be an ISO-8601 date-time string.`);
    }
    return text;
}

/** Map client errors to user-safe rejection messages for the model. */
function toToolError(error: unknown): Error {
    if (error instanceof BookApiError || error instanceof BookingTrackerError) {
        return new Error(error.message);
    }
    if (error instanceof Error) return error;
    return new Error("Booking service error.");
}

/** Resolve the vault session id per call; throw when signed out. */
function requireSessionId(): string {
    const sessionId = loadDispatcherSession()?.sessionId;
    if (!sessionId) {
        throw new Error("Not signed in as a dispatcher. Log in to the portal first.");
    }
    return sessionId;
}

const UTC_OFFSET_SCHEMA = {
    type: "integer",
    description: "Browser UTC offset in minutes (from -getTimezoneOffset()). Defaults to 0.",
} as const;

// ---------------------------------------------------------------------------
// Public booking-link scope (mounted on /book/:token).
// ---------------------------------------------------------------------------

const LIST_SLOTS_SCHEMA = {
    type: "object",
    properties: {
        days: { type: "integer", minimum: 1, maximum: 30, description: "Days ahead to list." },
        durationMin: { type: "integer", description: "Appointment length in minutes." },
        utcOffset: UTC_OFFSET_SCHEMA,
    },
} satisfies Record<string, unknown>;

const CONFIRM_SCHEMA = {
    type: "object",
    properties: {
        agentId: { type: "integer", description: "Agent id from booking_list_slots." },
        start: { type: "string", format: "date-time", description: "Slot start (ISO-8601)." },
        end: { type: "string", format: "date-time", description: "Slot end (ISO-8601)." },
        utcOffset: UTC_OFFSET_SCHEMA,
    },
    required: ["agentId", "start", "end"],
} satisfies Record<string, unknown>;

const CONFIRM_SERIES_SCHEMA = {
    type: "object",
    properties: {
        bookings: {
            type: "array",
            minItems: 1,
            items: {
                type: "object",
                properties: {
                    agentId: { type: "integer" },
                    start: { type: "string", format: "date-time" },
                    end: { type: "string", format: "date-time" },
                    occurrence: {
                        type: "string",
                        format: "date",
                        description: "Occurrence date (YYYY-MM-DD) this choice answers.",
                    },
                },
                required: ["agentId", "start", "end"],
            },
            description: "One entry per occurrence to book.",
        },
        utcOffset: UTC_OFFSET_SCHEMA,
    },
    required: ["bookings"],
} satisfies Record<string, unknown>;

function parseSeriesSelections(value: unknown): BookSeriesSelection[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error('"bookings" must be a non-empty array.');
    }
    return value.map((entry, index) => {
        const record = asRecord(entry);
        const selection: BookSeriesSelection = {
            agentId: asRequiredNumber(record.agentId, `bookings[${index}].agentId`),
            start: asRequiredIsoDate(record.start, `bookings[${index}].start`),
            end: asRequiredIsoDate(record.end, `bookings[${index}].end`),
        };
        const occurrence = record.occurrence;
        if (occurrence !== undefined && occurrence !== null) {
            if (typeof occurrence !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(occurrence)) {
                throw new Error(`"bookings[${index}].occurrence" must be a YYYY-MM-DD date.`);
            }
            selection.occurrence = occurrence;
        }
        return selection;
    });
}

/**
 * Tools for the public booking page. Bound to the page's link token so the
 * agent never handles the raw token itself.
 */
export function publicBookingTools(token: string): WebMcpToolDefinition[] {
    return [
        {
            name: "booking_list_slots",
            title: "List available booking times",
            description:
                "List the available appointment days and slots for this booking link. " +
                "Note: the first call claims the link for this visitor.",
            inputSchema: LIST_SLOTS_SCHEMA,
            annotations: { untrustedContentHint: true },
            execute: async (args) => {
                try {
                    const input = asRecord(args);
                    const response = await fetchBookSlots({
                        token,
                        days: asOptionalNumber(input.days, "days"),
                        durationMin: asOptionalNumber(input.durationMin, "durationMin"),
                        utcOffset: asOptionalNumber(input.utcOffset, "utcOffset"),
                    });
                    return JSON.stringify(response);
                } catch (error) {
                    throw toToolError(error);
                }
            },
        },
        {
            name: "booking_confirm",
            title: "Confirm a booking",
            description:
                "Book one appointment slot from booking_list_slots. This writes a " +
                "Halo appointment and consumes the booking link.",
            inputSchema: CONFIRM_SCHEMA,
            annotations: { consequentialHint: true },
            execute: async (args) => {
                try {
                    const input = asRecord(args);
                    const response = await confirmBooking({
                        token,
                        agentId: asRequiredNumber(input.agentId, "agentId"),
                        start: asRequiredIsoDate(input.start, "start"),
                        end: asRequiredIsoDate(input.end, "end"),
                        utcOffset: asOptionalNumber(input.utcOffset, "utcOffset"),
                    });
                    return JSON.stringify(response);
                } catch (error) {
                    throw toToolError(error);
                }
            },
        },
        {
            name: "booking_confirm_series",
            title: "Confirm a recurring series",
            description:
                "Book multiple occurrences of a recurring series in one call. Each " +
                "entry writes a Halo appointment; partial success returns per-item results.",
            inputSchema: CONFIRM_SERIES_SCHEMA,
            annotations: { consequentialHint: true },
            execute: async (args) => {
                try {
                    const input = asRecord(args);
                    const response = await confirmBookingSeries({
                        token,
                        bookings: parseSeriesSelections(input.bookings),
                        utcOffset: asOptionalNumber(input.utcOffset, "utcOffset"),
                    });
                    return JSON.stringify(response);
                } catch (error) {
                    throw toToolError(error);
                }
            },
        },
    ];
}

/** Tool-name manifest for the public scope (unit/e2e contract). */
export const PUBLIC_TOOL_NAMES = [
    "booking_list_slots",
    "booking_confirm",
    "booking_confirm_series",
];

// ---------------------------------------------------------------------------
// Dispatcher scope (mounted on the authenticated dispatch view).
// ---------------------------------------------------------------------------

const RID_SCHEMA = {
    type: "object",
    properties: {
        rid: {
            type: "string",
            description: "Booking request id (from dispatch_list_booking_requests).",
        },
    },
    required: ["rid"],
} satisfies Record<string, unknown>;

const EXTEND_SCHEMA = {
    type: "object",
    properties: {
        rid: {
            type: "string",
            description: "Booking request id (from dispatch_list_booking_requests).",
        },
        days: {
            type: "integer",
            minimum: 1,
            maximum: 30,
            description: "Extra days. Defaults to the link TTL.",
        },
    },
    required: ["rid"],
} satisfies Record<string, unknown>;

const LIST_TICKETS_SCHEMA = {
    type: "object",
    properties: {
        limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            description: "Max tickets to return. Defaults to 25.",
        },
    },
} satisfies Record<string, unknown>;

interface DispatchTicketRow {
    id: number;
    summary: string;
    slaState: string;
    score: number;
    priorityId: number | null;
    fixByDate: string | null;
}

function ticketRows(limit: number): DispatchTicketRow[] {
    const now = new Date();
    return useDispatchStore
        .getState()
        .haloTickets.slice(0, limit)
        .map((ticket) => ({
            id: ticket.id,
            summary: ticket.summary,
            slaState: ticket.slaState,
            score: scoreTicket(ticket, now),
            priorityId: ticket.priority_id,
            fixByDate: ticket.fixbydate,
        }));
}

/**
 * Tools for the authenticated dispatch view. Booking tools resolve the vault
 * session per call; ticket tools read the tickets already loaded in the view.
 */
export function dispatcherTools(): WebMcpToolDefinition[] {
    return [
        {
            name: "dispatch_list_booking_requests",
            title: "List outstanding booking requests",
            description:
                "List the dispatcher's outstanding booking-link requests and their statuses.",
            inputSchema: { type: "object", properties: {} } satisfies Record<string, unknown>,
            annotations: { readOnlyHint: true },
            execute: async () => {
                try {
                    return JSON.stringify(await fetchBookingRequests(requireSessionId()));
                } catch (error) {
                    throw toToolError(error);
                }
            },
        },
        {
            name: "dispatch_booking_status",
            title: "Booking request status",
            description: "Get the status of one booking-link request.",
            inputSchema: RID_SCHEMA,
            annotations: { readOnlyHint: true },
            execute: async (args) => {
                try {
                    const input = asRecord(args);
                    const response = await fetchBookingStatus(
                        asRequiredString(input.rid, "rid"),
                        requireSessionId(),
                    );
                    return JSON.stringify(response);
                } catch (error) {
                    throw toToolError(error);
                }
            },
        },
        {
            name: "dispatch_booking_audit",
            title: "Booking request audit trail",
            description: "Get the audit trail of one booking-link request.",
            inputSchema: RID_SCHEMA,
            annotations: { readOnlyHint: true },
            execute: async (args) => {
                try {
                    const input = asRecord(args);
                    const response = await fetchBookingAudit(
                        asRequiredString(input.rid, "rid"),
                        requireSessionId(),
                    );
                    return JSON.stringify(response);
                } catch (error) {
                    throw toToolError(error);
                }
            },
        },
        {
            name: "dispatch_cancel_booking",
            title: "Cancel a booking request",
            description:
                "Cancel a booking-link request. The customer link stops working immediately.",
            inputSchema: RID_SCHEMA,
            annotations: { consequentialHint: true },
            execute: async (args) => {
                try {
                    const input = asRecord(args);
                    const response = await cancelBookingRequest(
                        asRequiredString(input.rid, "rid"),
                        requireSessionId(),
                    );
                    return JSON.stringify(response);
                } catch (error) {
                    throw toToolError(error);
                }
            },
        },
        {
            name: "dispatch_extend_booking",
            title: "Extend a booking request",
            description:
                "Extend a booking-link request's expiry and get a fresh customer link URL.",
            inputSchema: EXTEND_SCHEMA,
            annotations: { consequentialHint: true },
            execute: async (args) => {
                try {
                    const input = asRecord(args);
                    const response = await extendBookingRequest({
                        sessionId: requireSessionId(),
                        rid: asRequiredString(input.rid, "rid"),
                        days: asOptionalNumber(input.days, "days"),
                    });
                    const origin = typeof window === "undefined" ? "" : window.location.origin;
                    return JSON.stringify({ ...response, url: `${origin}/book/${response.token}` });
                } catch (error) {
                    throw toToolError(error);
                }
            },
        },
        {
            name: "dispatch_list_tickets",
            title: "List loaded tickets",
            description:
                "List the tickets currently loaded in the dispatch view with their " +
                "SLA state and priority score. Only sees what the dispatcher loaded.",
            inputSchema: LIST_TICKETS_SCHEMA,
            annotations: { readOnlyHint: true },
            execute: async (args) => {
                const input = asRecord(args);
                const limit = asOptionalNumber(input.limit, "limit") ?? 25;
                return JSON.stringify(ticketRows(limit));
            },
        },
    ];
}

/** Tool-name manifest for the dispatcher scope (unit/e2e contract). */
export const DISPATCHER_TOOL_NAMES = [
    "dispatch_list_booking_requests",
    "dispatch_booking_status",
    "dispatch_booking_audit",
    "dispatch_cancel_booking",
    "dispatch_extend_booking",
    "dispatch_list_tickets",
];
