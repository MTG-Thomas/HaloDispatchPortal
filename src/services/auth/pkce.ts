/**
 * PKCE (RFC 7636) helpers for the native-app Authorization Code flow.
 *
 * The code verifier and OAuth `state` live in `sessionStorage` (tab-scoped,
 * cleared when the tab closes) so concurrent logins in different tabs cannot
 * overwrite each other's PKCE material the way `localStorage` would allow.
 */

const PKCE_VERIFIER_KEY = "halo-dispatch-pkce-verifier";
const OAUTH_STATE_KEY = "halo-dispatch-oauth-state";

const VERIFIER_LENGTH = 64;
const VERIFIER_CHARSET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

export interface PkceRequest {
    state: string;
    verifier: string;
}

/**
 * Generate a `code_verifier`: 64 chars from the RFC 7636 unreserved set.
 */
export function generateCodeVerifier(): string {
    const random = new Uint8Array(VERIFIER_LENGTH);
    crypto.getRandomValues(random);
    let verifier = "";
    for (let i = 0; i < random.length; i++) {
        verifier += VERIFIER_CHARSET[(random[i] as number) % VERIFIER_CHARSET.length];
    }
    return verifier;
}

function base64UrlEncode(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i] as number);
    }
    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

/**
 * Derive the S256 `code_challenge` for a verifier.
 * Requires a secure context (HTTPS or localhost) for WebCrypto.
 */
export async function generateCodeChallenge(
    verifier: string
): Promise<string> {
    if (!crypto.subtle) {
        throw new Error(
            "WebCrypto is unavailable: PKCE S256 requires a secure context (HTTPS or localhost)."
        );
    }
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(verifier)
    );
    return base64UrlEncode(digest);
}

/**
 * Generate an opaque OAuth `state` value for CSRF protection.
 */
export function generateState(): string {
    if (typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    const random = new Uint8Array(16);
    crypto.getRandomValues(random);
    return Array.from(random, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function savePkceRequest(request: PkceRequest): void {
    sessionStorage.setItem(OAUTH_STATE_KEY, request.state);
    sessionStorage.setItem(PKCE_VERIFIER_KEY, request.verifier);
}

export function loadPkceRequest(): PkceRequest | null {
    const state = sessionStorage.getItem(OAUTH_STATE_KEY);
    const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
    if (!state || !verifier) {
        return null;
    }
    return { state, verifier };
}

export function clearPkceRequest(): void {
    sessionStorage.removeItem(OAUTH_STATE_KEY);
    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
}
