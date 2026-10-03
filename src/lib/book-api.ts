/**
 * Typed Worker client for the public customer-booking endpoints
 * (`/api/book/*`). Same-origin: the Worker serves the SPA and the BFF on one
 * host, so no Halo auth headers are needed — the booking-link token is the
 * capability. Uses bare `fetch` (never the authenticated api-client).
 */

export const BOOK_API_BASE = "/api/book";

export type BookErrorCode =
    | "invalid-token"
    | "expired"
    | "cancelled"
    | "already-booked"
    | "slot-taken"
    | "invalid-slot"
    | "invalid-request"
    | "rate-limited"
    | "booking-unavailable"
    | "halo-unavailable"
    | "network-error";

const KNOWN_CODES: ReadonlySet<string> = new Set([
    "invalid-token",
    "expired",
    "cancelled",
    "already-booked",
    "slot-taken",
    "invalid-slot",
    "invalid-request",
    "rate-limited",
    "booking-unavailable",
    "halo-unavailable",
]);

export class BookApiError extends Error {
    readonly code: BookErrorCode;
    readonly status: number | null;
    /** Halo appointment id, present on `already-booked` replays. */
    readonly appointmentId: number | null;

    constructor(code: BookErrorCode, message: string, status: number | null = null) {
        super(message);
        this.name = "BookApiError";
        this.code = code;
        this.status = status;
        this.appointmentId = null;
    }

    withAppointmentId(appointmentId: number | null): BookApiError {
        const copy = new BookApiError(this.code, this.message, this.status);
        (copy as { appointmentId: number | null }).appointmentId = appointmentId;
        return copy;
    }
}

function base64UrlDecodeUtf8(part: string): string {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

/**
 * Unverified decode of the token payload, routing-only: the booking page
 * needs the `rid` to build `/api/book/requests/:rid/*` URLs. The Worker
 * re-verifies the signature on every call; a forged rid yields 401 there.
 * Throws `BookApiError` (`invalid-token`) when the token is not shaped like
 * a booking token.
 */
export function decodeBookingTokenRid(token: string): string {
    try {
        const dot = token.indexOf(".");
        if (dot <= 0) {
            throw new Error("no payload segment");
        }
        const payload = JSON.parse(base64UrlDecodeUtf8(token.slice(0, dot))) as {
            rid?: unknown;
        };
        if (typeof payload.rid !== "string" || !payload.rid) {
            throw new Error("no rid");
        }
        return payload.rid;
    } catch {
        throw new BookApiError("invalid-token", "This booking link is invalid.");
    }
}

export interface BookAgentOption {
    id: number;
    name: string | null;
}

export interface BookSlotOption {
    agentId: number;
    /** ISO UTC instant. */
    start: string;
    end: string;
}

export interface BookDaySlots {
    /** Client-local calendar day (YYYY-MM-DD). */
    date: string;
    slots: BookSlotOption[];
}

export interface BookSlotsResponse {
    rid: string;
    ticketId: number;
    appointmentTypeId: number;
    expiresAt: string;
    /** True when this load performed the first-view claim. */
    firstView: boolean;
    agents: BookAgentOption[];
    days: BookDaySlots[];
    durationMin: number;
    utcOffset: number;
}

export interface BookConfirmResponse {
    rid: string;
    appointmentId: number;
    agentId: number;
    start: string;
    end: string;
}

export interface FetchBookSlotsArgs {
    token: string;
    days?: number;
    durationMin?: number;
    utcOffset?: number;
    signal?: AbortSignal;
}

export interface ConfirmBookingArgs {
    token: string;
    agentId: number;
    start: string;
    end: string;
    utcOffset?: number;
    signal?: AbortSignal;
}

function codeForStatus(status: number, bodyCode: unknown): BookErrorCode {
    if (typeof bodyCode === "string" && KNOWN_CODES.has(bodyCode)) {
        return bodyCode as BookErrorCode;
    }
    if (status === 401) return "invalid-token";
    if (status === 409) return "already-booked";
    if (status === 410) return "expired";
    if (status === 429) return "rate-limited";
    if (status === 502) return "halo-unavailable";
    if (status === 503) return "booking-unavailable";
    if (status === 400) return "invalid-request";
    return "network-error";
}

function messageForCode(code: BookErrorCode): string {
    switch (code) {
        case "invalid-token":
            return "This booking link is invalid.";
        case "expired":
            return "This booking link has expired.";
        case "cancelled":
            return "This booking request was cancelled.";
        case "already-booked":
            return "This booking link was already used.";
        case "slot-taken":
            return "That time was just taken. Please pick another time.";
        case "invalid-slot":
            return "That time is no longer available. Please pick another time.";
        case "rate-limited":
            return "Too many requests. Please wait a moment and try again.";
        case "booking-unavailable":
        case "halo-unavailable":
            return "Booking is temporarily unavailable. Please try again later.";
        case "invalid-request":
            return "The booking request was invalid.";
        case "network-error":
            return "Could not reach the booking service. Check your connection.";
    }
}

async function throwForResponse(response: Response): Promise<never> {
    let body: Record<string, unknown> = {};
    try {
        body = (await response.json()) as Record<string, unknown>;
    } catch {
        // Fall through to status-based mapping.
    }
    const code = codeForStatus(response.status, body.error);
    const error = new BookApiError(code, messageForCode(code), response.status);
    throw typeof body.appointmentId === "number"
        ? error.withAppointmentId(body.appointmentId)
        : error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function parseSlotsResponse(body: unknown): BookSlotsResponse {
    if (!isRecord(body) || typeof body.rid !== "string" || !Array.isArray(body.days)) {
        throw new BookApiError(
            "network-error",
            "The booking service returned an invalid response.",
        );
    }
    return body as unknown as BookSlotsResponse;
}

function parseConfirmResponse(body: unknown): BookConfirmResponse {
    if (
        !isRecord(body) ||
        typeof body.rid !== "string" ||
        typeof body.appointmentId !== "number" ||
        typeof body.agentId !== "number" ||
        typeof body.start !== "string" ||
        typeof body.end !== "string"
    ) {
        throw new BookApiError(
            "network-error",
            "The booking service returned an invalid response.",
        );
    }
    return body as unknown as BookConfirmResponse;
}

/** Load availability for a booking link (also performs claim-on-load). */
export async function fetchBookSlots(args: FetchBookSlotsArgs): Promise<BookSlotsResponse> {
    const rid = decodeBookingTokenRid(args.token);
    const params = new URLSearchParams({ token: args.token });
    if (args.days !== undefined) params.set("days", String(args.days));
    if (args.durationMin !== undefined) params.set("durationMin", String(args.durationMin));
    if (args.utcOffset !== undefined) params.set("utcOffset", String(args.utcOffset));
    let response: Response;
    try {
        response = await fetch(
            `${BOOK_API_BASE}/requests/${encodeURIComponent(rid)}/slots?${params}`,
            { signal: args.signal },
        );
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        throw new BookApiError("network-error", messageForCode("network-error"));
    }
    if (!response.ok) {
        await throwForResponse(response);
    }
    return parseSlotsResponse((await response.json()) as unknown);
}

/* --------------------------------------------------------------------- */
/* Dispatcher tracking (slice 3): list / status / cancel / resend.        */
/* Same-origin Worker BFF; dispatcher calls authenticate with the Halo    */
/* access token sealed at mint time (see the Worker status/cancel auth).  */
/* --------------------------------------------------------------------- */

/** Worker-side request state; `pending` splits into sent/clicked client-side. */
export type BookingRequestStatus = "pending" | "booked" | "cancelled" | "expired";

export interface BookingRequestSummary {
    rid: string;
    status: BookingRequestStatus;
    ticketId: number;
    agentIds: number[];
    appointmentTypeId: number;
    createdAt: string;
    updatedAt: string;
    /** Expiry as epoch seconds; mirrors the booking-link token expiry. */
    exp: number;
    /** First validated customer view; null until the link is opened. */
    clickedAt: string | null;
    bookedAppointmentId: number | null;
}

/**
 * Chip-facing status: pending without a view is "sent", pending with a view
 * is "clicked"; worker "cancelled" renders as "canceled".
 */
export type BookingDisplayStatus = "sent" | "clicked" | "booked" | "expired" | "canceled";

export function bookingDisplayStatus(
    summary: BookingRequestSummary,
    nowMs: number = Date.now(),
): BookingDisplayStatus {
    switch (summary.status) {
        case "booked":
            return "booked";
        case "cancelled":
            return "canceled";
        case "expired":
            return "expired";
        case "pending":
            // Belt-and-braces: the Worker flips these on read, but a stale
            // list snapshot must still render expired, never sent.
            if (summary.exp * 1000 <= nowMs) {
                return "expired";
            }
            return summary.clickedAt ? "clicked" : "sent";
    }
}

/** Open = actionable: sent or clicked (terminal states excluded). */
export function isBookingOpen(summary: BookingRequestSummary, nowMs: number = Date.now()): boolean {
    const display = bookingDisplayStatus(summary, nowMs);
    return display === "sent" || display === "clicked";
}

export type BookingTrackerErrorCode =
    "unauthorized" | "not-found" | "conflict" | "invalid-request" | "network-error";

export class BookingTrackerError extends Error {
    readonly code: BookingTrackerErrorCode;
    readonly status: number | null;
    /** Current server state, present when a cancel raced to terminal (409). */
    readonly current: BookingRequestSummary | null;

    constructor(
        code: BookingTrackerErrorCode,
        message: string,
        status: number | null = null,
        current: BookingRequestSummary | null = null,
    ) {
        super(message);
        this.name = "BookingTrackerError";
        this.code = code;
        this.status = status;
        this.current = current;
    }
}

const TRACKER_STATUSES: ReadonlySet<string> = new Set([
    "pending",
    "booked",
    "cancelled",
    "expired",
]);

function parseBookingSummary(body: unknown): BookingRequestSummary | null {
    if (!isRecord(body)) {
        return null;
    }
    if (
        typeof body.rid !== "string" ||
        !body.rid ||
        typeof body.status !== "string" ||
        !TRACKER_STATUSES.has(body.status) ||
        typeof body.ticketId !== "number" ||
        !Array.isArray(body.agentIds) ||
        !body.agentIds.every((id): id is number => typeof id === "number") ||
        typeof body.appointmentTypeId !== "number" ||
        typeof body.createdAt !== "string" ||
        typeof body.updatedAt !== "string" ||
        typeof body.exp !== "number"
    ) {
        return null;
    }
    const clickedAt = body.clickedAt ?? null;
    const bookedAppointmentId = body.bookedAppointmentId ?? null;
    if (
        (clickedAt !== null && typeof clickedAt !== "string") ||
        (bookedAppointmentId !== null && typeof bookedAppointmentId !== "number")
    ) {
        return null;
    }
    return {
        rid: body.rid,
        status: body.status as BookingRequestStatus,
        ticketId: body.ticketId,
        agentIds: body.agentIds as number[],
        appointmentTypeId: body.appointmentTypeId,
        createdAt: body.createdAt,
        updatedAt: body.updatedAt,
        exp: body.exp,
        clickedAt,
        bookedAppointmentId,
    };
}

async function throwTrackerForResponse(response: Response): Promise<never> {
    let body: Record<string, unknown> = {};
    try {
        body = (await response.json()) as Record<string, unknown>;
    } catch {
        // Fall through to status-based mapping.
    }
    const serverMessage = typeof body.error === "string" ? body.error : null;
    if (response.status === 401) {
        throw new BookingTrackerError(
            "unauthorized",
            "Your sign-in changed since this link was created. Mint a fresh link.",
            401,
        );
    }
    if (response.status === 404) {
        throw new BookingTrackerError("not-found", "Booking request not found.", 404);
    }
    if (response.status === 409) {
        throw new BookingTrackerError(
            "conflict",
            "Booking request is already final.",
            409,
            parseBookingSummary(body),
        );
    }
    if (response.status === 400) {
        throw new BookingTrackerError("invalid-request", serverMessage ?? "Invalid request.", 400);
    }
    if (response.status === 429) {
        throw new BookingTrackerError(
            "network-error",
            "Too many requests. Please wait a moment and try again.",
            429,
        );
    }
    throw new BookingTrackerError(
        "network-error",
        serverMessage ?? "Could not reach the booking service. Check your connection.",
        response.status,
    );
}

interface TrackerFetchOptions {
    signal?: AbortSignal;
}

async function dispatcherFetch(
    path: string,
    accessToken: string,
    init: RequestInit = {},
): Promise<Response> {
    let response: Response;
    try {
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${accessToken}`);
        response = await fetch(path, { ...init, headers });
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        throw new BookingTrackerError(
            "network-error",
            "Could not reach the booking service. Check your connection.",
        );
    }
    if (!response.ok) {
        await throwTrackerForResponse(response);
    }
    return response;
}

/** List every request the signed-in dispatcher minted, newest first. */
export async function fetchBookingRequests(
    accessToken: string,
    options: TrackerFetchOptions = {},
): Promise<BookingRequestSummary[]> {
    const response = await dispatcherFetch(`${BOOK_API_BASE}/requests`, accessToken, {
        signal: options.signal,
    });
    const body = (await response.json()) as unknown;
    if (!isRecord(body) || !Array.isArray(body.requests)) {
        throw new BookingTrackerError(
            "network-error",
            "The booking service returned an invalid response.",
        );
    }
    // Lenient rows: one malformed record must not blank the whole queue.
    return body.requests
        .map(parseBookingSummary)
        .filter((row): row is BookingRequestSummary => row !== null);
}

/** Read one request's tracking state (drives status chips after actions). */
export async function fetchBookingStatus(
    rid: string,
    accessToken: string,
    options: TrackerFetchOptions = {},
): Promise<BookingRequestSummary> {
    const response = await dispatcherFetch(
        `${BOOK_API_BASE}/requests/${encodeURIComponent(rid)}/status`,
        accessToken,
        { signal: options.signal },
    );
    const summary = parseBookingSummary((await response.json()) as unknown);
    if (!summary) {
        throw new BookingTrackerError(
            "network-error",
            "The booking service returned an invalid response.",
        );
    }
    return summary;
}

/** Cancel an open request; 409s carry the now-current terminal state. */
export async function cancelBookingRequest(
    rid: string,
    accessToken: string,
    options: TrackerFetchOptions = {},
): Promise<BookingRequestSummary> {
    const response = await dispatcherFetch(
        `${BOOK_API_BASE}/requests/${encodeURIComponent(rid)}/cancel`,
        accessToken,
        { method: "POST", signal: options.signal },
    );
    const summary = parseBookingSummary((await response.json()) as unknown);
    if (!summary) {
        throw new BookingTrackerError(
            "network-error",
            "The booking service returned an invalid response.",
        );
    }
    return summary;
}

/** Minimal token pair the Worker seals at mint time (HaloTokens satisfies). */
export interface DispatcherTokenPair {
    access_token: string;
    refresh_token: string;
}

export interface MintBookingArgs {
    ticketId: number;
    agentIds: number[];
    appointmentTypeId: number;
    haloTokenPair: DispatcherTokenPair;
    signal?: AbortSignal;
}

export interface MintBookingResult {
    rid: string;
    token: string;
    expiresAt: string;
}

/** Mint a booking link (no dispatcher header: the pair rides in the body). */
export async function mintBookingRequest(args: MintBookingArgs): Promise<MintBookingResult> {
    let response: Response;
    try {
        response = await fetch(`${BOOK_API_BASE}/requests`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ticketId: args.ticketId,
                agentIds: args.agentIds,
                appointmentTypeId: args.appointmentTypeId,
                haloTokenPair: args.haloTokenPair,
            }),
            signal: args.signal,
        });
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        throw new BookingTrackerError(
            "network-error",
            "Could not reach the booking service. Check your connection.",
        );
    }
    if (!response.ok) {
        await throwTrackerForResponse(response);
    }
    const body = (await response.json()) as unknown;
    if (
        !isRecord(body) ||
        typeof body.rid !== "string" ||
        typeof body.token !== "string" ||
        typeof body.expiresAt !== "string"
    ) {
        throw new BookingTrackerError(
            "network-error",
            "The booking service returned an invalid response.",
        );
    }
    return { rid: body.rid, token: body.token, expiresAt: body.expiresAt };
}

export interface ResendBookingArgs {
    previous: BookingRequestSummary;
    haloTokenPair: DispatcherTokenPair;
    accessToken: string;
    signal?: AbortSignal;
}

export interface ResendBookingResult extends MintBookingResult {
    /**
     * False when the old request was still live but its cancel call failed;
     * the caller should warn that two links are now live.
     */
    oldInvalidated: boolean;
}

/**
 * Resend: mint a fresh link for the same ticket/agents/type, then invalidate
 * the old request in KV. Terminal predecessors need no cancel; a cancel that
 * races to terminal (409) still counts as invalidated.
 */
export async function resendBookingRequest(args: ResendBookingArgs): Promise<ResendBookingResult> {
    const fresh = await mintBookingRequest({
        ticketId: args.previous.ticketId,
        agentIds: args.previous.agentIds,
        appointmentTypeId: args.previous.appointmentTypeId,
        haloTokenPair: args.haloTokenPair,
        signal: args.signal,
    });
    if (args.previous.status !== "pending") {
        return { ...fresh, oldInvalidated: true };
    }
    try {
        await cancelBookingRequest(args.previous.rid, args.accessToken, { signal: args.signal });
        return { ...fresh, oldInvalidated: true };
    } catch (error) {
        if (error instanceof BookingTrackerError && error.code === "conflict") {
            return { ...fresh, oldInvalidated: true };
        }
        return { ...fresh, oldInvalidated: false };
    }
}

/** Redeem a booking link for one slot (single-use). */
export async function confirmBooking(args: ConfirmBookingArgs): Promise<BookConfirmResponse> {
    const rid = decodeBookingTokenRid(args.token);
    let response: Response;
    try {
        response = await fetch(`${BOOK_API_BASE}/requests/${encodeURIComponent(rid)}/book`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                token: args.token,
                agentId: args.agentId,
                start: args.start,
                end: args.end,
                utcOffset: args.utcOffset ?? 0,
            }),
            signal: args.signal,
        });
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        throw new BookApiError("network-error", messageForCode("network-error"));
    }
    if (!response.ok) {
        await throwForResponse(response);
    }
    return parseConfirmResponse((await response.json()) as unknown);
}
