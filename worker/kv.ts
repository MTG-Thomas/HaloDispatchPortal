/**
 * Booking-request KV state. Operates against an injected {@link KeyValueClient}
 * so these helpers stay testable under plain node/vitest — this module must
 * never import `cloudflare:*`.
 *
 * Record layout: key `book:req:<rid>` holds the JSON-encoded
 * {@link BookingRequestRecord}, including the dispatcher Halo token pair
 * AES-GCM-sealed with a key derived from the Worker `SECRET` (decision Q1a:
 * the Worker needs the pair later for Worker-side Halo calls/refreshes).
 */

export interface KeyValueListResult {
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
}

export interface KeyValueClient {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
    delete(key: string): Promise<void>;
    /**
     * Prefix scan shaped like the Cloudflare KV `list` subset (prefix,
     * cursor, limit), so the production binding satisfies this interface
     * structurally. KV returns at most 1000 keys per call; callers that
     * need every key must follow `cursor` until `list_complete`.
     */
    list(options: { prefix: string; cursor?: string; limit?: number }): Promise<KeyValueListResult>;
}

export type BookingRequestStatus = "pending" | "booked" | "cancelled" | "expired";

/** Minimal Halo token pair as stored by the SPA auth service. */
export interface HaloTokenPair {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    obtained_at?: number;
}

export interface SealedTokenPair {
    /** base64url AES-GCM IV (12 bytes). */
    iv: string;
    /** base64url ciphertext. */
    data: string;
}

export interface BookingRequestRecord {
    rid: string;
    ticketId: number;
    agentIds: number[];
    appointmentTypeId: number;
    status: BookingRequestStatus;
    sealedTokens: SealedTokenPair;
    createdAt: string;
    updatedAt: string;
    /** Expiry as epoch seconds; mirrors the booking-link token expiry. */
    exp: number;
    /**
     * Dispatcher-local minutes east of UTC, captured at mint time. Slots
     * and book validate business hours in this offset when present (older
     * records omit it and fall back to the customer offset).
     */
    businessOffsetMin?: number;
    /**
     * Buffer minutes around each busy block, captured at mint time. Older
     * records omit it and fall back to the zero-buffer default.
     */
    bufferMin?: number;
    /**
     * First customer page view (claim-on-load). Slice 1 mints `pending`
     * records, which play the "sent" role: the link is issued but unopened.
     * The first validated public view stamps this field (the "clicked" flip);
     * terminal statuses stay immutable and are never claimed.
     */
    clickedAt?: string;
    /** Halo appointment id created by the single-book redeem, when booked. */
    bookedAppointmentId?: number;
    /**
     * Vault session that minted this request (see `./session.ts`). Present
     * on session-minted records so tracking authorizes by opaque session id;
     * legacy pair-minted records omit it and keep the access-token fallback.
     */
    sessionId?: string;
    /**
     * Series (recurring) request: client-local YYYY-MM-DD dates the customer
     * must pick one slot per. Absent for single-book requests.
     */
    occurrences?: string[];
    /**
     * Halo appointment ids created by a series redeem, in booking order.
     * When set, `bookedAppointmentId` mirrors the first id for replay compat.
     */
    bookedAppointmentIds?: number[];
    /**
     * Redeem claim: opaque id of the confirm holding this `pending` record,
     * stamped before any Halo write. Internal only — never exposed in
     * `publicStatus`, so dispatcher clients see no new status value.
     * Best-effort on KV (no compare-and-swap): narrows the race window from
     * seconds to one KV roundtrip; a Durable Object claim is the full fix.
     */
    claimId?: string;
    /** ISO stamp of `claimId`; claims older than `CLAIM_TTL_MS` are stale. */
    claimedAt?: string;
}

/** Redeem-claim lifetime: crashed workers must not brick a link past this. */
export const CLAIM_TTL_MS = 5 * 60 * 1000;

export interface NewBookingRequest {
    rid: string;
    ticketId: number;
    agentIds: number[];
    appointmentTypeId: number;
    sealedTokens: SealedTokenPair;
    exp: number;
    businessOffsetMin?: number;
    bufferMin?: number;
    sessionId?: string;
    occurrences?: string[];
}

/** Booking links live 7 days; KV records expire with them. */
export const BOOKING_REQUEST_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * KV TTL for a record write: the record must outlive its own `exp` (an
 * extend can push expiry to 30d), never below one full link TTL so
 * terminal records still age out. The +1d grace covers KV expiry drift.
 */
export function recordTtlSeconds(exp: number, nowSec: number): number {
    return Math.max(BOOKING_REQUEST_TTL_SECONDS, exp - nowSec + 24 * 60 * 60);
}

/** Fresh links from extend default to another full TTL. */
export const BOOKING_EXTEND_DEFAULT_DAYS = 7;
export const BOOKING_EXTEND_MAX_DAYS = 30;

export const BOOKING_REQUEST_PREFIX = "book:req:";

export function bookingRequestKey(rid: string): string {
    return `${BOOKING_REQUEST_PREFIX}${rid}`;
}

/** Customer/dispatcher lifecycle events recorded per booking request. */
export type BookingAuditEventType = "view" | "book" | "cancel" | "extend";

export interface BookingAuditEvent {
    type: BookingAuditEventType;
    /** ISO timestamp of the event. */
    at: string;
    /**
     * Optional machine-readable detail: the Halo appointment id for `book`,
     * the new ISO expiry for `extend`.
     */
    detail?: string;
}

export const BOOKING_AUDIT_PREFIX = "book:audit:";

/** Cap so one hot link cannot grow its audit value without bound. */
export const MAX_AUDIT_EVENTS = 500;

export function bookingAuditKey(rid: string): string {
    return `${BOOKING_AUDIT_PREFIX}${rid}`;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function base64UrlEncode(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function sealKey(secret: string) {
    const digest = await globalThis.crypto.subtle.digest(
        "SHA-256",
        textEncoder.encode(`booking-seal:v1:${secret}`),
    );
    return globalThis.crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
        "encrypt",
        "decrypt",
    ]);
}

/** AES-GCM-seal a dispatcher token pair for KV storage. */
export async function sealTokenPair(pair: HaloTokenPair, secret: string): Promise<SealedTokenPair> {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await globalThis.crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        await sealKey(secret),
        textEncoder.encode(JSON.stringify(pair)),
    );
    return { iv: base64UrlEncode(iv), data: base64UrlEncode(new Uint8Array(ciphertext)) };
}

/**
 * Open a sealed pair. Throws when the secret is wrong or the record was
 * tampered with (AES-GCM auth failure).
 */
export async function openTokenPair(
    sealed: SealedTokenPair,
    secret: string,
): Promise<HaloTokenPair> {
    const plaintext = await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64UrlDecode(sealed.iv) },
        await sealKey(secret),
        base64UrlDecode(sealed.data),
    );
    return JSON.parse(textDecoder.decode(plaintext)) as HaloTokenPair;
}

export type BookingStateErrorCode = "already-exists" | "not-found" | "illegal-transition";

export class BookingStateError extends Error {
    readonly code: BookingStateErrorCode;

    constructor(code: BookingStateErrorCode, message: string) {
        super(message);
        this.name = "BookingStateError";
        this.code = code;
    }
}

const TERMINAL_STATUSES: ReadonlySet<BookingRequestStatus> = new Set([
    "booked",
    "cancelled",
    "expired",
]);

function parseRecord(raw: string): BookingRequestRecord {
    return JSON.parse(raw) as BookingRequestRecord;
}

/** Create a pending request; throws `already-exists` on rid collision. */
export async function createBookingRequest(
    kv: KeyValueClient,
    input: NewBookingRequest,
    now: Date = new Date(),
): Promise<BookingRequestRecord> {
    const key = bookingRequestKey(input.rid);
    if ((await kv.get(key)) !== null) {
        throw new BookingStateError("already-exists", `Booking request ${input.rid} exists`);
    }
    const record: BookingRequestRecord = {
        rid: input.rid,
        ticketId: input.ticketId,
        agentIds: input.agentIds,
        appointmentTypeId: input.appointmentTypeId,
        status: "pending",
        sealedTokens: input.sealedTokens,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        exp: input.exp,
        ...(input.businessOffsetMin !== undefined
            ? { businessOffsetMin: input.businessOffsetMin }
            : {}),
        ...(input.bufferMin !== undefined ? { bufferMin: input.bufferMin } : {}),
        ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
        ...(input.occurrences !== undefined ? { occurrences: input.occurrences } : {}),
    };
    await kv.put(key, JSON.stringify(record), {
        expirationTtl: recordTtlSeconds(record.exp, Math.floor(now.getTime() / 1000)),
    });
    return record;
}

export async function getBookingRequest(
    kv: KeyValueClient,
    rid: string,
): Promise<BookingRequestRecord | null> {
    const raw = await kv.get(bookingRequestKey(rid));
    return raw === null ? null : parseRecord(raw);
}

/**
 * Prefix-scan every booking request, newest first. Skips unreadable rows
 * (concurrent deletes, partial writes) rather than failing the listing.
 */
export async function listBookingRequests(kv: KeyValueClient): Promise<BookingRequestRecord[]> {
    // KV lists at most 1000 keys per call: follow the cursor so large
    // tenants never silently lose requests past the first page.
    const keys: { name: string }[] = [];
    let cursor: string | undefined;
    do {
        const page = await kv.list({ prefix: BOOKING_REQUEST_PREFIX, cursor });
        keys.push(...page.keys);
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    const rows = await Promise.all(
        keys.map(async ({ name }) => {
            const raw = await kv.get(name);
            if (raw === null) {
                return null;
            }
            try {
                return parseRecord(raw);
            } catch {
                return null;
            }
        }),
    );
    const records = rows.filter((row): row is BookingRequestRecord => row !== null);
    records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return records;
}

/**
 * Move a request to a new status. Terminal states are immutable; only
 * `pending` requests may transition. Throws `not-found` / `illegal-transition`.
 */
export async function setBookingStatus(
    kv: KeyValueClient,
    rid: string,
    next: BookingRequestStatus,
    now: Date = new Date(),
): Promise<BookingRequestRecord> {
    const key = bookingRequestKey(rid);
    const raw = await kv.get(key);
    if (raw === null) {
        throw new BookingStateError("not-found", `Booking request ${rid} not found`);
    }
    const record = parseRecord(raw);
    if (TERMINAL_STATUSES.has(record.status) || record.status !== "pending") {
        throw new BookingStateError(
            "illegal-transition",
            `Cannot move booking request ${rid} from ${record.status} to ${next}`,
        );
    }
    const updated: BookingRequestRecord = { ...record, status: next, updatedAt: now.toISOString() };
    await kv.put(key, JSON.stringify(updated), {
        expirationTtl: recordTtlSeconds(updated.exp, Math.floor(now.getTime() / 1000)),
    });
    return updated;
}

/**
 * Claim-on-load: stamp the first validated customer view. Idempotent —
 * repeat views return the existing record with `firstView: false`. Only
 * `pending` records are claimed; terminal records are returned untouched.
 * Throws `not-found` when the rid is unknown.
 */
export async function markBookingClicked(
    kv: KeyValueClient,
    rid: string,
    now: Date = new Date(),
): Promise<{ record: BookingRequestRecord; firstView: boolean }> {
    const key = bookingRequestKey(rid);
    const raw = await kv.get(key);
    if (raw === null) {
        throw new BookingStateError("not-found", `Booking request ${rid} not found`);
    }
    const record = parseRecord(raw);
    if (record.status !== "pending" || record.clickedAt) {
        return { record, firstView: false };
    }
    const updated: BookingRequestRecord = {
        ...record,
        clickedAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
    await kv.put(key, JSON.stringify(updated), {
        expirationTtl: recordTtlSeconds(updated.exp, Math.floor(now.getTime() / 1000)),
    });
    return { record: updated, firstView: true };
}

/** True when the record carries a live (unexpired) redeem claim. */
export function hasFreshClaim(record: BookingRequestRecord, nowMs: number): boolean {
    if (record.claimId === undefined || record.claimedAt === undefined) {
        return false;
    }
    const claimedMs = Date.parse(record.claimedAt);
    return Number.isFinite(claimedMs) && nowMs - claimedMs < CLAIM_TTL_MS;
}

/**
 * Redeem claim: stamp a `pending` record BEFORE any Halo write, so an
 * overlapping confirm sees the claim instead of racing through validation
 * into a duplicate appointment. Stale claims (crashed workers) may be taken
 * over; terminal records and live foreign claims throw `illegal-transition`.
 * Throws `not-found` when the rid is unknown.
 */
export async function claimBookingForRedeem(
    kv: KeyValueClient,
    rid: string,
    claimId: string,
    now: Date = new Date(),
): Promise<BookingRequestRecord> {
    const key = bookingRequestKey(rid);
    const raw = await kv.get(key);
    if (raw === null) {
        throw new BookingStateError("not-found", `Booking request ${rid} not found`);
    }
    const record = parseRecord(raw);
    if (record.status !== "pending" || hasFreshClaim(record, now.getTime())) {
        throw new BookingStateError(
            "illegal-transition",
            `Cannot claim booking request ${rid} from ${record.status}`,
        );
    }
    const updated: BookingRequestRecord = {
        ...record,
        claimId,
        claimedAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
    await kv.put(key, JSON.stringify(updated), {
        expirationTtl: recordTtlSeconds(updated.exp, Math.floor(now.getTime() / 1000)),
    });
    return updated;
}

/**
 * Release a redeem claim held by `claimId` (validation/Halo failure paths),
 * so customer retries are never blocked by our own abandoned claim. No-op
 * (returns null) when the record is missing, non-pending, or held by another
 * claim — never throws.
 */
export async function releaseBookingClaim(
    kv: KeyValueClient,
    rid: string,
    claimId: string,
    now: Date = new Date(),
): Promise<BookingRequestRecord | null> {
    const key = bookingRequestKey(rid);
    const raw = await kv.get(key);
    if (raw === null) {
        return null;
    }
    const record = parseRecord(raw);
    if (record.status !== "pending" || record.claimId !== claimId) {
        return null;
    }
    const updated: BookingRequestRecord = {
        ...record,
        claimId: undefined,
        claimedAt: undefined,
        updatedAt: now.toISOString(),
    };
    try {
        await kv.put(key, JSON.stringify(updated), {
            expirationTtl: recordTtlSeconds(updated.exp, Math.floor(now.getTime() / 1000)),
        });
    } catch {
        // Best-effort: an unreleased claim expires via CLAIM_TTL_MS.
        return null;
    }
    return updated;
}

export interface FinalizeBookingOptions {
    now?: Date;
    /**
     * Holder check: when provided, the record's live claim must match or the
     * finalize throws `illegal-transition`. Losers of a cross-isolate claim
     * race converge to 409 instead of silently clobbering the winner's ids.
     */
    expectedClaimId?: string;
}

/**
 * Single-book redeem: move `pending` -> `booked` and remember the Halo
 * appointment id so replays can answer `already-booked` without creating a
 * duplicate. Clears the redeem claim. Throws `not-found` / `illegal-transition`.
 */
export async function markBookingBooked(
    kv: KeyValueClient,
    rid: string,
    appointmentId: number,
    options: FinalizeBookingOptions = {},
): Promise<BookingRequestRecord> {
    const now = options.now ?? new Date();
    const key = bookingRequestKey(rid);
    const raw = await kv.get(key);
    if (raw === null) {
        throw new BookingStateError("not-found", `Booking request ${rid} not found`);
    }
    const record = parseRecord(raw);
    if (
        record.status !== "pending" ||
        (options.expectedClaimId !== undefined && record.claimId !== options.expectedClaimId)
    ) {
        throw new BookingStateError(
            "illegal-transition",
            `Cannot book request ${rid} from ${record.status}`,
        );
    }
    const updated: BookingRequestRecord = {
        ...record,
        status: "booked",
        bookedAppointmentId: appointmentId,
        claimId: undefined,
        claimedAt: undefined,
        updatedAt: now.toISOString(),
    };
    await kv.put(key, JSON.stringify(updated), {
        expirationTtl: recordTtlSeconds(updated.exp, Math.floor(now.getTime() / 1000)),
    });
    return updated;
}

/**
 * Renew a pending request's expiry (extend). Terminal records stay
 * immutable — extend a live link, resend an expired one. Refreshes the KV
 * TTL so the renewed link lives its full term. Throws `not-found` /
 * `illegal-transition`.
 */
export async function extendBookingExpiry(
    kv: KeyValueClient,
    rid: string,
    newExp: number,
    now: Date = new Date(),
): Promise<BookingRequestRecord> {
    const key = bookingRequestKey(rid);
    const raw = await kv.get(key);
    if (raw === null) {
        throw new BookingStateError("not-found", `Booking request ${rid} not found`);
    }
    const record = parseRecord(raw);
    if (record.status !== "pending") {
        throw new BookingStateError(
            "illegal-transition",
            `Cannot extend booking request ${rid} from ${record.status}`,
        );
    }
    const updated: BookingRequestRecord = {
        ...record,
        exp: newExp,
        updatedAt: now.toISOString(),
    };
    await kv.put(key, JSON.stringify(updated), {
        expirationTtl: recordTtlSeconds(updated.exp, Math.floor(now.getTime() / 1000)),
    });
    return updated;
}

/**
 * Series redeem: move `pending` -> `booked` with the per-occurrence Halo
 * appointment ids (best-effort order). `bookedAppointmentId` mirrors the
 * first id so single-book replay readers keep working. Clears the redeem
 * claim. Throws `not-found` / `illegal-transition`.
 */
export async function markBookingSeriesBooked(
    kv: KeyValueClient,
    rid: string,
    appointmentIds: number[],
    options: FinalizeBookingOptions = {},
): Promise<BookingRequestRecord> {
    const now = options.now ?? new Date();
    const key = bookingRequestKey(rid);
    const raw = await kv.get(key);
    if (raw === null) {
        throw new BookingStateError("not-found", `Booking request ${rid} not found`);
    }
    const record = parseRecord(raw);
    if (
        record.status !== "pending" ||
        (options.expectedClaimId !== undefined && record.claimId !== options.expectedClaimId)
    ) {
        throw new BookingStateError(
            "illegal-transition",
            `Cannot book request ${rid} from ${record.status}`,
        );
    }
    const updated: BookingRequestRecord = {
        ...record,
        status: "booked",
        bookedAppointmentId: appointmentIds[0],
        bookedAppointmentIds: [...appointmentIds],
        claimId: undefined,
        claimedAt: undefined,
        updatedAt: now.toISOString(),
    };
    await kv.put(key, JSON.stringify(updated), {
        expirationTtl: recordTtlSeconds(updated.exp, Math.floor(now.getTime() / 1000)),
    });
    return updated;
}

function parseAuditEvents(raw: string | null): BookingAuditEvent[] {
    if (raw === null) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter(
            (event): event is BookingAuditEvent =>
                typeof event === "object" &&
                event !== null &&
                typeof (event as BookingAuditEvent).type === "string" &&
                typeof (event as BookingAuditEvent).at === "string",
        );
    } catch {
        return [];
    }
}

/**
 * Append one lifecycle event to the request's audit trail, oldest first.
 * Corrupt prior values reset to a fresh trail rather than failing the
 * booking flow; the trail is capped at {@link MAX_AUDIT_EVENTS}. The audit
 * key shares the record's TTL so an extended link keeps its trail.
 */
export async function appendAuditEvent(
    kv: KeyValueClient,
    rid: string,
    type: BookingAuditEventType,
    now: Date = new Date(),
    detail?: string,
): Promise<BookingAuditEvent[]> {
    const key = bookingAuditKey(rid);
    const events = parseAuditEvents(await kv.get(key));
    events.push({ type, at: now.toISOString(), ...(detail !== undefined ? { detail } : {}) });
    const capped =
        events.length > MAX_AUDIT_EVENTS ? events.slice(events.length - MAX_AUDIT_EVENTS) : events;
    await kv.put(key, JSON.stringify(capped), {
        expirationTtl: await auditTtlSeconds(kv, rid, now),
    });
    return capped;
}

/** Audit-key TTL follows the record's expiry; one link TTL when unreadable. */
async function auditTtlSeconds(kv: KeyValueClient, rid: string, now: Date): Promise<number> {
    try {
        const raw = await kv.get(bookingRequestKey(rid));
        if (raw !== null) {
            const record = parseRecord(raw);
            if (typeof record.exp === "number") {
                return recordTtlSeconds(record.exp, Math.floor(now.getTime() / 1000));
            }
        }
    } catch {
        // Fall through to the default TTL: audit must never break booking.
    }
    return BOOKING_REQUEST_TTL_SECONDS;
}

/** Read one request's audit trail, oldest first; unknown rids read empty. */
export async function listAuditEvents(
    kv: KeyValueClient,
    rid: string,
): Promise<BookingAuditEvent[]> {
    return parseAuditEvents(await kv.get(bookingAuditKey(rid)));
}

/**
 * Replace the sealed dispatcher token pair (after a Worker-side refresh)
 * without touching status. Throws `not-found` when the rid is unknown.
 */
export async function updateSealedTokens(
    kv: KeyValueClient,
    rid: string,
    sealedTokens: SealedTokenPair,
    now: Date = new Date(),
): Promise<BookingRequestRecord> {
    const key = bookingRequestKey(rid);
    const raw = await kv.get(key);
    if (raw === null) {
        throw new BookingStateError("not-found", `Booking request ${rid} not found`);
    }
    const updated: BookingRequestRecord = {
        ...parseRecord(raw),
        sealedTokens,
        updatedAt: now.toISOString(),
    };
    await kv.put(key, JSON.stringify(updated), {
        expirationTtl: recordTtlSeconds(updated.exp, Math.floor(now.getTime() / 1000)),
    });
    return updated;
}
