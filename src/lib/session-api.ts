/**
 * Typed Worker client for the dispatcher session vault
 * (`/api/book/sessions/*`). Same-origin: the Worker serves the SPA and the
 * BFF on one host. Uses bare `fetch` (never the authenticated api-client).
 *
 * The vault holds the dispatcher's Halo pair sealed in KV; the SPA persists
 * only the opaque session id. `fetchDispatcherSession` ("use") hands the
 * pair back transiently so the SPA can repopulate its memory-only tokens
 * after a reload — the pair must never be written to storage.
 */

import { BOOK_API_BASE } from "./book-api";

export const SESSION_API_BASE = `${BOOK_API_BASE}/sessions`;

/** Pair fields the vault round-trips (mirrors the Worker's HaloTokenPair). */
export interface VaultTokenPair {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    obtained_at?: number;
}

export interface DispatcherSessionRef {
    sessionId: string;
    expiresAt: string;
}

export interface DispatcherSessionUse extends DispatcherSessionRef {
    haloTokenPair: VaultTokenPair;
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

function parseVaultPair(body: unknown): VaultTokenPair | null {
    if (!isRecord(body)) {
        return null;
    }
    if (
        typeof body.access_token !== "string" ||
        !body.access_token ||
        typeof body.refresh_token !== "string" ||
        !body.refresh_token
    ) {
        return null;
    }
    return body as unknown as VaultTokenPair;
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

/** Create a vault session from a fresh Halo pair (login). */
export async function createDispatcherSession(
    haloTokenPair: VaultTokenPair,
    options: SessionFetchOptions = {},
): Promise<DispatcherSessionRef> {
    const response = await sessionFetch(SESSION_API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ haloTokenPair }),
        signal: options.signal,
    });
    const ref = parseSessionRef((await response.json()) as unknown);
    if (!ref) {
        throw invalidResponse();
    }
    return ref;
}

/**
 * Use a vault session: validate the id and read the sealed pair back for
 * memory restore. Pair is transient — never persist it.
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
    const pair = isRecord(body) ? parseVaultPair(body.haloTokenPair) : null;
    if (!ref || !pair) {
        throw invalidResponse();
    }
    return { ...ref, haloTokenPair: pair };
}

/**
 * Refresh a vault session: extend TTL, resealing `haloTokenPair` when the
 * SPA hands a rotated pair. A bare call only extends.
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
