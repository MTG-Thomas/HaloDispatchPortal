import type { HaloTokens, HaloUser, AuthConfig } from "./types";
import {
    clearPkceRequest,
    generateCodeChallenge,
    generateCodeVerifier,
    generateState,
    loadPkceRequest,
    savePkceRequest,
} from "./pkce";
import { isAllowedServerUrl } from "../../lib/server-url";

/**
 * Fail-closed guard: the auth server receives authorization codes and
 * refresh grants, so it must always be a well-formed https URL, even if
 * persisted config was tampered with outside the app. Custom hosts are
 * allowed (self-hosted Halo); shared login links are allowlisted earlier.
 */
function isUsableAuthServer(authServer: string): boolean {
    return isAllowedServerUrl(authServer, {
        allowCustomHosts: true,
        label: "Auth server",
    });
}

// Token storage keys
const TOKEN_STORAGE_KEY = "halo-dispatch-tokens";

/**
 * Clock-skew / early-expiry window. Tokens are treated as expired this far
 * before their real expiry so refresh happens proactively instead of mid-request.
 */
export const TOKEN_EXPIRY_SKEW_MS = 30 * 1000;

/**
 * Bound for the processed authorization-code set. The set is pruned
 * incrementally on insert (oldest first) instead of a module-scope timer,
 * so importing this module never leaves a dangling setInterval behind.
 */
const MAX_PROCESSED_CODES = 100;

// Track processed authorization codes to prevent duplicate exchanges.
const processedCodes = new Set<string>();

function rememberProcessedCode(code: string): void {
    if (processedCodes.size >= MAX_PROCESSED_CODES) {
        const oldest = processedCodes.values().next();
        if (!oldest.done) {
            processedCodes.delete(oldest.value);
        }
    }
    processedCodes.add(code);
}

export function loadTokens(): HaloTokens | null {
    try {
        const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (error) {
        console.error(
            "Failed to parse stored tokens:",
            error instanceof Error ? error.message : "Unknown error",
        );
        clearTokens();
    }
    return null;
}

export function saveTokens(tokens: HaloTokens): void {
    const stamped: HaloTokens = { ...tokens, obtained_at: Date.now() };
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(stamped));
}

export function clearTokens(): void {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function clearProcessedCodes(): void {
    processedCodes.clear();
}

/**
 * Documented fallback: the Halo API subset used by this app exposes no
 * current-user ("me") endpoint, and tenant field availability varies, so user
 * identity cannot be resolved from the resource server here (see AGENTS.md:
 * do not broaden the documented field subset without handling
 * tenant-specific availability and validation). Returns a stable local
 * session marker while a token set exists so auth state has a non-null user.
 */
export function getCurrentUser(): HaloUser | null {
    const tokens = loadTokens();
    if (!tokens?.access_token) {
        return null;
    }
    return {
        id: "user",
        username: "user",
    };
}

/**
 * Absolute expiry (epoch ms) for a token set, or null when the token age is
 * unknown (e.g. persisted before obtained_at existed) or invalid.
 */
export function getTokenExpiresAt(tokens: HaloTokens): number | null {
    if (typeof tokens.obtained_at !== "number" || !Number.isFinite(tokens.obtained_at)) {
        return null;
    }
    if (
        typeof tokens.expires_in !== "number" ||
        !Number.isFinite(tokens.expires_in) ||
        tokens.expires_in <= 0
    ) {
        return null;
    }
    return tokens.obtained_at + tokens.expires_in * 1000;
}

/**
 * True when tokens are missing, of unknown age, expired, or inside the skew
 * window before expiry (i.e. a refresh should happen proactively).
 */
export function isTokenExpiringSoon(tokens: HaloTokens | null = loadTokens()): boolean {
    if (!tokens?.access_token) {
        return true;
    }
    const expiresAt = getTokenExpiresAt(tokens);
    if (expiresAt === null) {
        return true;
    }
    return Date.now() >= expiresAt - TOKEN_EXPIRY_SKEW_MS;
}

export function isAuthenticated(): boolean {
    return !isTokenExpiringSoon();
}

/**
 * Ensure a fresh access token: no-op when the current one is outside the
 * skew window, otherwise attempts a refresh. Returns true when a usable
 * token set is stored afterwards.
 */
export async function ensureFreshToken(config: AuthConfig): Promise<boolean> {
    const tokens = loadTokens();
    if (!tokens?.refresh_token) {
        return false;
    }
    if (!isTokenExpiringSoon(tokens)) {
        return true;
    }
    return refreshToken(config);
}

export async function startAuth(config: AuthConfig): Promise<void> {
    // Validate required fields
    if (!config.authServer || !config.clientId || !config.redirectUri) {
        throw new Error("Missing required configuration: authServer, clientId, or redirectUri");
    }
    if (!isUsableAuthServer(config.authServer)) {
        throw new Error("Invalid auth server URL. Please reconfigure.");
    }

    // PKCE (S256) + state for the native-app Authorization Code flow.
    const state = generateState();
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    savePkceRequest({ state, verifier });

    const params = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        scope: "all:standard offline_access",
        redirect_uri: config.redirectUri,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
    });

    const authUrl = `${config.authServer}/authorize?${params.toString()}`;
    window.location.href = authUrl;
}

export async function handleCallback(
    config: AuthConfig,
    code: string,
    state: string | null,
): Promise<boolean> {
    // Verify state before any token exchange; never log the values.
    const pkceRequest = loadPkceRequest();
    if (!state || !pkceRequest || state !== pkceRequest.state) {
        console.warn("OAuth state mismatch: rejecting callback without token exchange.");
        clearPkceRequest();
        return false;
    }

    // Check if this code has already been processed (single-flight guard).
    if (processedCodes.has(code)) {
        console.warn("Authorization code already processed, skipping.");
        return false;
    }

    // Mark this code as being processed
    rememberProcessedCode(code);

    try {
        // Validate required fields
        if (!config.authServer || !config.clientId || !config.redirectUri) {
            throw new Error("Missing required configuration: authServer, clientId, or redirectUri");
        }
        if (!isUsableAuthServer(config.authServer)) {
            console.warn("Rejecting callback: invalid auth server URL.");
            return false;
        }

        const tokenParams = new URLSearchParams({
            grant_type: "authorization_code",
            client_id: config.clientId,
            redirect_uri: config.redirectUri,
            code: code,
            code_verifier: pkceRequest.verifier,
            scope: "all:standard offline_access",
        });

        const tokenResponse = await fetch(`${config.authServer}/token`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: tokenParams,
        });

        if (!tokenResponse.ok) {
            // Log status only: token endpoint bodies can carry sensitive detail.
            console.error("Token request failed:", tokenResponse.status, tokenResponse.statusText);
            return false;
        }

        const tokens = (await tokenResponse.json()) as HaloTokens;
        saveTokens(tokens);

        return true;
    } catch (error) {
        console.error(
            "OAuth callback failed:",
            error instanceof Error ? error.message : "Unknown error",
        );
        return false;
    } finally {
        // PKCE material is single-use: always clear it after the exchange.
        clearPkceRequest();
    }
}

/**
 * True only when the token endpoint explicitly reports `invalid_grant`.
 * Absent or unparsable bodies are treated as transient (never fatal).
 */
async function isInvalidGrant(response: Response): Promise<boolean> {
    try {
        const body = (await response.json()) as { error?: unknown };
        return body?.error === "invalid_grant";
    } catch {
        return false;
    }
}

export async function refreshToken(config: AuthConfig): Promise<boolean> {
    try {
        const tokens = loadTokens();
        if (!tokens?.refresh_token) {
            console.warn("No refresh token available");
            return false;
        }
        if (!isUsableAuthServer(config.authServer)) {
            console.warn("Rejecting refresh: invalid auth server URL.");
            return false;
        }

        const response = await fetch(`${config.authServer}/token`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                client_id: config.clientId,
                refresh_token: tokens.refresh_token,
                scope: "all:standard offline_access",
            }),
        });

        if (!response.ok) {
            // Log status only: token endpoint bodies can carry sensitive detail.
            console.error("Token refresh failed:", response.status, response.statusText);

            // Clear only on a definite invalid_grant (parsed, never logged):
            // any other status — or an unreadable body — keeps the stored
            // session so transient failures can retry.
            if (await isInvalidGrant(response)) {
                console.warn("Refresh token is invalid/expired, clearing authentication");
                clearTokens();
            }
            return false;
        }

        const newTokens = (await response.json()) as HaloTokens;
        // Some providers omit refresh_token on refresh; keep the old one then.
        saveTokens({
            ...newTokens,
            refresh_token: newTokens.refresh_token || tokens.refresh_token,
        });
        return true;
    } catch (error) {
        // Network-level failure: keep stored tokens so a later retry or a
        // fresh login can proceed; only definite invalid_grant clears above.
        console.error(
            "Token refresh failed:",
            error instanceof Error ? error.message : "Unknown error",
        );
        return false;
    }
}

export function logout(): void {
    clearTokens();
    // Clear processed codes and any pending PKCE material on logout
    processedCodes.clear();
    clearPkceRequest();
    // Redirect to login page
    if (window.location.pathname !== "/login") {
        window.location.href = "/login";
    }
}
