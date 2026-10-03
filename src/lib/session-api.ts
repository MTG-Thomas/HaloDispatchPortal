/**
 * Typed Worker client for the dispatcher session vault
 * (`/api/book/sessions/*`). Same-origin: the Worker serves the SPA and the
 * BFF on one host. Uses bare `fetch` (never the authenticated api-client).
 *
 * The vault holds the dispatcher's Halo pair sealed in KV; the SPA persists
 * only the opaque session id. `fetchDispatcherSession` ("use") hands
 * access-only credentials back transiently so the SPA can repopulate its
 * memory-only tokens after a reload — the refresh token never leaves the
 * vault, and nothing token-shaped is ever written to storage. Rotation
 * goes through `rotateDispatcherSession`, which reseals inside the Worker.
 */

import { BOOK_API_BASE } from "./book-api";

export const SESSION_API_BASE = `${BOOK_API_BASE}/sessions`;

/** Full pair fields, sent once when a session is created (login vaulting). */
export interface VaultTokenPair {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    obtained_at?: number;
}

/** Access-only credentials the vault hands back (never a refresh token). */
export interface VaultAccessCredentials {
    access_token: string;
    expires_in?: number;
    obtained_at?: number;
    token_type?: string;
    scope?: string;
}

/** Non-secret Halo tenant endpoints stored for Worker-side rotation. */
export interface SessionTenantEndpoints {
    authServer: string;
    clientId: string;
}

export interface DispatcherSessionRef {
    sessionId: string;
    expiresAt: string;
}

export interface DispatcherSessionUse extends DispatcherSessionRef {
    haloAccessToken: VaultAccessCredentials;
}

export interface DispatcherSessionRotated extends DispatcherSessionRef {
    haloAccessToken: VaultAccessCredentials;
}

export type DispatcherSessionErrorCode = "unauthorized" | "invalid-request" | "network-error";

export class DispatcherSessionError extends Error {
    readonly code: DispatcherSessionErrorCode;
    readonly status: number | null;

    constructor(code: DispatcherSessionErrorCode, message: string, status: number | null = null) {
        super(message);
        this.name = "DispatcherSessionError";
        this.code = code;
        this.status = status;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function parseSessionRef(body: unknown): DispatcherSessionRef | null {
    if (
        !isRecord(body) ||
        typeof body.sessionId !== "string" ||
        !body.sessionId ||
        typeof body.expiresAt !== "string" ||
        !body.expiresAt ||
        !Number.isFinite(Date.parse(body.expiresAt))
    ) {
        return null;
    }
    return { sessionId: body.sessionId, expiresAt: body.expiresAt };
}

function parseAccessCredentials(body: unknown): VaultAccessCredentials | null {
    if (!isRecord(body)) {
        return null;
    }
    if (typeof body.access_token !== "string" || !body.access_token) {
        return null;
    }
    const creds: VaultAccessCredentials = { access_token: body.access_token };
    if (typeof body.expires_in === "number") {
        creds.expires_in = body.expires_in;
    }
    if (typeof body.obtained_at === "number") {
        creds.obtained_at = body.obtained_at;
    }
    if (typeof body.token_type === "string") {
        creds.token_type = body.token_type;
    }
    if (typeof body.scope === "string") {
        creds.scope = body.scope;
    }
    return creds;
}

async function throwSessionForResponse(response: Response): Promise<never> {
    let body: Record<string, unknown> = {};
    try {
        body = (await response.json()) as Record<string, unknown>;
    } catch {
        // Fall through to status-based mapping.
    }
    const serverMessage = typeof body.error === "string" ? body.error : null;
    if (response.status === 401) {
        throw new DispatcherSessionError(
            "unauthorized",
            "Your session expired. Please sign in again.",
            401,
        );
    }
    if (response.status === 400) {
        throw new DispatcherSessionError(
            "invalid-request",
            serverMessage ?? "Invalid request.",
            400,
        );
    }
    if (response.status === 429) {
        throw new DispatcherSessionError(
            "network-error",
            "Too many requests. Please wait a moment and try again.",
            429,
        );
    }
    throw new DispatcherSessionError(
        "network-error",
        serverMessage ?? "Could not reach the session service. Check your connection.",
        response.status,
    );
}

interface SessionFetchOptions {
    signal?: AbortSignal;
}

async function sessionFetch(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
        response = await fetch(path, init);
    } catch (error) {
        // Intentional cancellation: never a session error, never retried.
        if (
            (error instanceof DOMException && error.name === "AbortError") ||
            (error instanceof Error && error.name === "AbortError")
        ) {
            throw error;
        }
        throw new DispatcherSessionError(
            "network-error",
            "Could not reach the session service. Check your connection.",
        );
    }
    if (!response.ok) {
        await throwSessionForResponse(response);
    }
    return response;
}

function invalidResponse(): DispatcherSessionError {
    return new DispatcherSessionError(
        "network-error",
        "The session service returned an invalid response.",
    );
}

/**
 * Create a vault session from a fresh Halo pair (login). The tenant
 * endpoints are stored for Worker-side rotation; the pair itself is
 * sealed and never handed back.
 */
export async function createDispatcherSession(
    haloTokenPair: VaultTokenPair,
    tenant: SessionTenantEndpoints,
    options: SessionFetchOptions = {},
): Promise<DispatcherSessionRef> {
    const response = await sessionFetch(SESSION_API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ haloTokenPair, tenant }),
        signal: options.signal,
    });
    const ref = parseSessionRef((await response.json()) as unknown);
    if (!ref) {
        throw invalidResponse();
    }
    return ref;
}

/**
 * Use a vault session: validate the id and read access-only credentials
 * back for memory restore. Transient — never persist it.
 */
export async function fetchDispatcherSession(
    sessionId: string,
    options: SessionFetchOptions = {},
): Promise<DispatcherSessionUse> {
    const response = await sessionFetch(`${SESSION_API_BASE}/current`, {
        headers: { Authorization: `Bearer ${sessionId}` },
        signal: options.signal,
    });
    const body = (await response.json()) as unknown;
    const ref = parseSessionRef(body);
    const creds = isRecord(body) ? parseAccessCredentials(body.haloAccessToken) : null;
    if (!ref || !creds) {
        throw invalidResponse();
    }
    return { ...ref, haloAccessToken: creds };
}

/**
 * Rotate a vault session's sealed pair inside the Worker and adopt the
 * fresh access-only credentials. 401 means the session is dead (or a
 * legacy session without tenant endpoints): re-login. 502 keeps the
 * session for a later retry.
 */
export async function rotateDispatcherSession(
    sessionId: string,
    options: SessionFetchOptions = {},
): Promise<DispatcherSessionRotated> {
    const response = await sessionFetch(`${SESSION_API_BASE}/refresh`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${sessionId}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ rotate: true }),
        signal: options.signal,
    });
    const body = (await response.json()) as unknown;
    const ref = parseSessionRef(body);
    const creds = isRecord(body) ? parseAccessCredentials(body.haloAccessToken) : null;
    if (!ref || !creds) {
        throw invalidResponse();
    }
    return { ...ref, haloAccessToken: creds };
}

/**
 * Refresh a vault session: extend TTL, resealing `haloTokenPair` when the
 * caller hands a rotated pair (legacy). A bare call only extends.
 */
export async function refreshDispatcherSession(
    sessionId: string,
    haloTokenPair?: VaultTokenPair,
    options: SessionFetchOptions = {},
): Promise<DispatcherSessionRef> {
    const response = await sessionFetch(`${SESSION_API_BASE}/refresh`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${sessionId}`,
            ...(haloTokenPair ? { "Content-Type": "application/json" } : {}),
        },
        ...(haloTokenPair ? { body: JSON.stringify({ haloTokenPair }) } : {}),
        signal: options.signal,
    });
    const ref = parseSessionRef((await response.json()) as unknown);
    if (!ref) {
        throw invalidResponse();
    }
    return ref;
}

/**
 * Expire a vault session (logout). Best-effort by design: resolves false
 * (never rejects) on any failure so logout always completes locally.
 */
export async function expireDispatcherSession(sessionId: string): Promise<boolean> {
    try {
        await sessionFetch(`${SESSION_API_BASE}/current`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${sessionId}` },
        });
        return true;
    } catch {
        return false;
    }
}
