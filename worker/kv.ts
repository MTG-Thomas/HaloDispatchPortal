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
}

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
}

/** Booking links live 7 days; KV records expire with them. */
export const BOOKING_REQUEST_TTL_SECONDS = 7 * 24 * 60 * 60;

export const BOOKING_REQUEST_PREFIX = "book:req:";

export function bookingRequestKey(rid: string): string {
    return `${BOOKING_REQUEST_PREFIX}${rid}`;
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
    };
    await kv.put(key, JSON.stringify(record), { expirationTtl: BOOKING_REQUEST_TTL_SECONDS });
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
    await kv.put(key, JSON.stringify(updated), { expirationTtl: BOOKING_REQUEST_TTL_SECONDS });
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
    await kv.put(key, JSON.stringify(updated), { expirationTtl: BOOKING_REQUEST_TTL_SECONDS });
    return { record: updated, firstView: true };
}

/**
 * Single-book redeem: move `pending` -> `booked` and remember the Halo
 * appointment id so replays can answer `already-booked` without creating a
 * duplicate. Throws `not-found` / `illegal-transition`.
 */
export async function markBookingBooked(
    kv: KeyValueClient,
    rid: string,
    appointmentId: number,
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
            `Cannot book request ${rid} from ${record.status}`,
        );
    }
    const updated: BookingRequestRecord = {
        ...record,
        status: "booked",
        bookedAppointmentId: appointmentId,
        updatedAt: now.toISOString(),
    };
    await kv.put(key, JSON.stringify(updated), { expirationTtl: BOOKING_REQUEST_TTL_SECONDS });
    return updated;
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
    await kv.put(key, JSON.stringify(updated), { expirationTtl: BOOKING_REQUEST_TTL_SECONDS });
    return updated;
}
