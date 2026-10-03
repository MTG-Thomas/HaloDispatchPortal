/**
 * Booking-link tokens: HMAC-SHA256 signed payloads over WebCrypto stdlib only.
 *
 * Token shape is `<base64url(payload)>.<base64url(signature)>` where the
 * signature covers the encoded payload. The Worker secret (`SECRET` env) is
 * the HMAC key; it never leaves the Worker.
 */

export interface BookingTokenPayload {
    /** Booking-request id (KV key suffix). */
    rid: string;
    ticketId: number;
    agentIds: number[];
    appointmentTypeId: number;
    /** Expiry as epoch seconds. */
    exp: number;
}

export type VerifyTokenResult =
    | { ok: true; payload: BookingTokenPayload }
    | { ok: false; reason: "expired"; payload: BookingTokenPayload }
    | { ok: false; reason: "malformed" | "invalid-signature" | "invalid-payload" };

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

async function hmacKey(secret: string) {
    return globalThis.crypto.subtle.importKey(
        "raw",
        textEncoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
    );
}

function isPayloadShape(value: unknown): value is BookingTokenPayload {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const v = value as Record<string, unknown>;
    return (
        typeof v.rid === "string" &&
        v.rid.length > 0 &&
        typeof v.ticketId === "number" &&
        Number.isInteger(v.ticketId) &&
        Array.isArray(v.agentIds) &&
        v.agentIds.every((id) => typeof id === "number" && Number.isInteger(id)) &&
        typeof v.appointmentTypeId === "number" &&
        Number.isInteger(v.appointmentTypeId) &&
        typeof v.exp === "number" &&
        Number.isFinite(v.exp)
    );
}

/** Sign a booking payload. The caller supplies the already-validated payload. */
export async function signBookingToken(
    payload: BookingTokenPayload,
    secret: string,
): Promise<string> {
    const body = base64UrlEncode(textEncoder.encode(JSON.stringify(payload)));
    const signature = await globalThis.crypto.subtle.sign(
        "HMAC",
        await hmacKey(secret),
        textEncoder.encode(body),
    );
    return `${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Verify a token: signature first (constant-time `subtle.verify`), then shape,
 * then expiry. `nowSec` is injectable for tests.
 */
export async function verifyBookingToken(
    token: string,
    secret: string,
    nowSec: number = Math.floor(Date.now() / 1000),
): Promise<VerifyTokenResult> {
    const dot = token.indexOf(".");
    if (dot <= 0 || dot === token.length - 1 || token.indexOf(".", dot + 1) !== -1) {
        return { ok: false, reason: "malformed" };
    }
    const body = token.slice(0, dot);
    let signature: Uint8Array;
    try {
        signature = base64UrlDecode(token.slice(dot + 1));
    } catch {
        return { ok: false, reason: "malformed" };
    }
    const valid = await globalThis.crypto.subtle.verify(
        "HMAC",
        await hmacKey(secret),
        signature.buffer as ArrayBuffer,
        textEncoder.encode(body),
    );
    if (!valid) {
        return { ok: false, reason: "invalid-signature" };
    }
    let payload: unknown;
    try {
        payload = JSON.parse(textDecoder.decode(base64UrlDecode(body)));
    } catch {
        return { ok: false, reason: "malformed" };
    }
    if (!isPayloadShape(payload)) {
        return { ok: false, reason: "invalid-payload" };
    }
    if (payload.exp <= nowSec) {
        // Carry the payload so callers can bind the expiry flip to the
        // token's own rid (an expired token for rid A must never flip rid B).
        return { ok: false, reason: "expired", payload };
    }
    return { ok: true, payload };
}
