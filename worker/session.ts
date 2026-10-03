/**
 * Dispatcher session vault. The SPA persists only the opaque session id in
 * localStorage; the dispatcher Halo token pair lives here, AES-GCM-sealed in
 * KV (same seal as the booking records in `./kv.ts`). Sessions outlive
 * booking links (30d vs 7d) so dispatcher tracking survives SPA refreshes for
 * the whole life of every minted link.
 *
 * Lifecycle (see `entry.ts` for the HTTP mapping):
 * - create: POST /api/book/sessions seals a fresh Halo pair under a new id.
 * - use:    GET /api/book/sessions/current returns access-only credentials
 *           (SPA memory restore after reload); the refresh token never
 *           leaves the vault.
 * - refresh: POST /api/book/sessions/refresh extends TTL, resealing when
 *           the SPA hands a rotated pair (legacy), or rotating the sealed
 *           pair against Halo itself when asked (`{ rotate: true }`).
 * - expire: DELETE /api/book/sessions/current drops the record (logout).
 *
 * Like `./kv.ts`, this module must never import `cloudflare:*` so it stays
 * testable under plain node/vitest.
 */

import { openTokenPair, sealTokenPair } from "./kv";
import type { HaloTokenPair, KeyValueClient, SealedTokenPair } from "./kv";

/**
 * Non-secret Halo tenant endpoints for Worker-side token rotation. Stored
 * at session create so refresh never needs the SPA to resend config; the
 * refresh token itself never leaves the sealed pair.
 */
export interface DispatcherSessionTenant {
    authServer: string;
    clientId: string;
}

export interface DispatcherSessionRecord {
    /** Opaque id (`crypto.randomUUID()`); the only credential the SPA stores. */
    sessionId: string;
    sealedTokens: SealedTokenPair;
    createdAt: string;
    updatedAt: string;
    /** Expiry as epoch seconds; authoritative (KV TTL is lazy). */
    exp: number;
    /** Tenant endpoints for Worker-side rotation; absent on legacy records. */
    tenant?: DispatcherSessionTenant;
    /**
     * Epoch ms when the sealed pair was obtained (login vault time, or the
     * last Worker rotation). Lets the SPA age restored access tokens.
     */
    obtainedAtMs?: number;
}

/** Vault sessions live 30 days; every refresh extends from now. */
export const DISPATCHER_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export const DISPATCHER_SESSION_PREFIX = "book:session:";

export function dispatcherSessionKey(sessionId: string): string {
    return `${DISPATCHER_SESSION_PREFIX}${sessionId}`;
}

/**
 * Session ids are always `crypto.randomUUID()` values. Anything else is
 * rejected before it reaches KV: an over-long or arbitrary presented
 * credential must answer 401/ok, never a KV key error surfacing as 500.
 */
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isSessionIdShape(sessionId: string): boolean {
    return SESSION_ID_PATTERN.test(sessionId);
}

export type SessionErrorCode = "not-found" | "invalid-pair";

export class SessionError extends Error {
    readonly code: SessionErrorCode;

    constructor(code: SessionErrorCode, message: string) {
        super(message);
        this.name = "SessionError";
        this.code = code;
    }
}

function isUsablePair(pair: unknown): pair is HaloTokenPair {
    if (typeof pair !== "object" || pair === null) {
        return false;
    }
    const candidate = pair as Record<string, unknown>;
    return (
        typeof candidate.access_token === "string" &&
        candidate.access_token.length > 0 &&
        typeof candidate.refresh_token === "string" &&
        candidate.refresh_token.length > 0
    );
}

function parseRecord(raw: string): DispatcherSessionRecord {
    return JSON.parse(raw) as DispatcherSessionRecord;
}

export interface CreateDispatcherSessionOptions {
    /**
     * Tenant endpoints for Worker-side rotation. The HTTP layer validates
     * shape; sessions created without it cannot rotate (re-login mints a
     * tenant-bound replacement).
     */
    tenant?: DispatcherSessionTenant;
}

/**
 * Seal a Halo pair under a fresh opaque session id. Throws `invalid-pair`
 * when either token is missing or empty.
 */
export async function createDispatcherSession(
    kv: KeyValueClient,
    pair: HaloTokenPair,
    secret: string,
    now: Date = new Date(),
    options: CreateDispatcherSessionOptions = {},
): Promise<DispatcherSessionRecord> {
    if (!isUsablePair(pair)) {
        throw new SessionError("invalid-pair", "Session requires a usable Halo token pair");
    }
    const sessionId = globalThis.crypto.randomUUID();
    const record: DispatcherSessionRecord = {
        sessionId,
        sealedTokens: await sealTokenPair(pair, secret),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        exp: Math.floor(now.getTime() / 1000) + DISPATCHER_SESSION_TTL_SECONDS,
        ...(options.tenant !== undefined ? { tenant: options.tenant } : {}),
        obtainedAtMs:
            typeof pair.obtained_at === "number" && Number.isFinite(pair.obtained_at)
                ? pair.obtained_at
                : now.getTime(),
    };
    await kv.put(dispatcherSessionKey(sessionId), JSON.stringify(record), {
        expirationTtl: DISPATCHER_SESSION_TTL_SECONDS,
    });
    return record;
}

export interface OpenedDispatcherSession {
    record: DispatcherSessionRecord;
    pair: HaloTokenPair;
}

/**
 * Open a session: null when the id is unknown, expired (best-effort
 * deleted), unreadable, or sealed under a rotated secret. Never throws for
 * credential problems — callers map null to 401.
 */
export async function openDispatcherSession(
    kv: KeyValueClient,
    sessionId: string,
    secret: string,
    nowSec: number = Math.floor(Date.now() / 1000),
): Promise<OpenedDispatcherSession | null> {
    if (!sessionId || !isSessionIdShape(sessionId)) {
        return null;
    }
    const key = dispatcherSessionKey(sessionId);
    const raw = await kv.get(key);
    if (raw === null) {
        return null;
    }
    let record: DispatcherSessionRecord;
    try {
        record = parseRecord(raw);
    } catch {
        return null;
    }
    if (typeof record.exp !== "number" || record.exp <= nowSec) {
        await kv.delete(key).catch(() => undefined);
        return null;
    }
    let pair: HaloTokenPair;
    try {
        pair = await openTokenPair(record.sealedTokens, secret);
    } catch {
        return null;
    }
    return { record, pair };
}

/**
 * Extend a live session by a full TTL, resealing `nextPair` when the caller
 * hands a rotated pair (re-stamping the pair age). Throws `not-found` when
 * the session is unknown, expired, or unopenable, and `invalid-pair` for
 * an unusable `nextPair`.
 */
export async function refreshDispatcherSession(
    kv: KeyValueClient,
    sessionId: string,
    secret: string,
    nextPair?: HaloTokenPair,
    now: Date = new Date(),
): Promise<DispatcherSessionRecord> {
    if (!isSessionIdShape(sessionId)) {
        throw new SessionError("not-found", `Dispatcher session ${sessionId} not found`);
    }
    if (nextPair !== undefined && !isUsablePair(nextPair)) {
        throw new SessionError("invalid-pair", "Session requires a usable Halo token pair");
    }
    const opened = await openDispatcherSession(kv, sessionId, secret);
    if (!opened) {
        throw new SessionError("not-found", `Dispatcher session ${sessionId} not found`);
    }
    const updated: DispatcherSessionRecord = {
        ...opened.record,
        sealedTokens:
            nextPair === undefined
                ? opened.record.sealedTokens
                : await sealTokenPair(nextPair, secret),
        updatedAt: now.toISOString(),
        exp: Math.floor(now.getTime() / 1000) + DISPATCHER_SESSION_TTL_SECONDS,
        ...(nextPair === undefined
            ? {}
            : {
                  obtainedAtMs:
                      typeof nextPair.obtained_at === "number" &&
                      Number.isFinite(nextPair.obtained_at)
                          ? nextPair.obtained_at
                          : now.getTime(),
              }),
    };
    await kv.put(dispatcherSessionKey(sessionId), JSON.stringify(updated), {
        expirationTtl: DISPATCHER_SESSION_TTL_SECONDS,
    });
    return updated;
}

/** Expire a session. Idempotent: unknown ids report false, never throw. */
export async function deleteDispatcherSession(
    kv: KeyValueClient,
    sessionId: string,
): Promise<boolean> {
    if (!sessionId || !isSessionIdShape(sessionId)) {
        return false;
    }
    const key = dispatcherSessionKey(sessionId);
    if ((await kv.get(key)) === null) {
        return false;
    }
    await kv.delete(key);
    return true;
}
