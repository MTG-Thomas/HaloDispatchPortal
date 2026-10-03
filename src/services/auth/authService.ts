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
import {
    createDispatcherSession,
    expireDispatcherSession,
    fetchDispatcherSession,
    refreshDispatcherSession,
    rotateDispatcherSession,
    DispatcherSessionError,
    type SessionTenantEndpoints,
    type VaultAccessCredentials,
    type VaultTokenPair,
} from "../../lib/session-api";

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

/**
 * Legacy pre-vault key: raw Halo tokens at rest. Adopted into memory and
 * removed on first read after the upgrade; never written again.
 */
const LEGACY_TOKEN_STORAGE_KEY = "halo-dispatch-tokens";

/**
 * The only credential persisted client-side: the opaque vault session id
 * (+ its expiry). No access/refresh token is ever written to storage.
 */
export const SESSION_STORAGE_KEY = "halo-dispatch-session";

export interface DispatcherSessionRef {
    sessionId: string;
    expiresAt: string;
}

/**
 * Live Halo pair for direct Halo API calls. Memory-only for the page
 * lifetime: repopulated from the vault session after a reload, never
 * persisted. The vault (Worker KV, AES-GCM-sealed) is the durable copy.
 */
let memoryTokens: HaloTokens | null = null;

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

function removeLegacyStoredTokens(): void {
    try {
        localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
    } catch {
        // Storage failures fail closed to a memory-only session.
    }
}

/**
 * Live pair (memory, plus one-time adoption of a pre-vault persisted set).
 * The legacy key is deleted on first read so no token remains at rest.
 */
export function loadTokens(): HaloTokens | null {
    if (memoryTokens) {
        return memoryTokens;
    }
    try {
        const stored = localStorage.getItem(LEGACY_TOKEN_STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored) as HaloTokens;
            removeLegacyStoredTokens();
            if (parsed?.access_token) {
                memoryTokens = parsed;
                return memoryTokens;
            }
        }
    } catch (error) {
        console.error(
            "Failed to parse stored tokens:",
            error instanceof Error ? error.message : "Unknown error",
        );
        removeLegacyStoredTokens();
    }
    return null;
}

export function saveTokens(tokens: HaloTokens): void {
    memoryTokens = { ...tokens, obtained_at: Date.now() };
    removeLegacyStoredTokens();
}

export function clearTokens(): void {
    memoryTokens = null;
    clearDispatcherSession();
    removeLegacyStoredTokens();
}

/** Persisted vault session ref, or null when signed out / corrupt / expired-shape. */
export function loadDispatcherSession(): DispatcherSessionRef | null {
    try {
        const stored = localStorage.getItem(SESSION_STORAGE_KEY);
        if (!stored) {
            return null;
        }
        const parsed = JSON.parse(stored) as Partial<DispatcherSessionRef>;
        if (
            typeof parsed.sessionId !== "string" ||
            !parsed.sessionId ||
            typeof parsed.expiresAt !== "string" ||
            !parsed.expiresAt
        ) {
            clearDispatcherSession();
            return null;
        }
        return { sessionId: parsed.sessionId, expiresAt: parsed.expiresAt };
    } catch {
        clearDispatcherSession();
        return null;
    }
}

export function saveDispatcherSession(ref: DispatcherSessionRef): void {
    localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({ sessionId: ref.sessionId, expiresAt: ref.expiresAt }),
    );
}

export function clearDispatcherSession(): void {
    try {
        localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
        // Storage failures fail closed to a memory-only session.
    }
}

/** True when a vault session id is persisted (tracking survives reload). */
export function hasDispatcherSession(): boolean {
    return loadDispatcherSession() !== null;
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
 * Adopt access-only vault credentials into memory. The refresh token is
 * never present here: rotation happens inside the Worker.
 */
function adoptAccessCredentials(creds: VaultAccessCredentials): void {
    // Preserve the vaulted age (no re-stamp): proactive refresh must see
    // the real token age, not the adoption time.
    memoryTokens = {
        access_token: creds.access_token,
        expires_in: typeof creds.expires_in === "number" ? creds.expires_in : 0,
        token_type: creds.token_type ?? "Bearer",
        scope: creds.scope ?? "all:standard offline_access",
        obtained_at: typeof creds.obtained_at === "number" ? creds.obtained_at : undefined,
    };
    removeLegacyStoredTokens();
}

/**
 * Create-or-refresh the vault session behind the persisted id. Best-effort:
 * the BFF may be unreachable (local dev without the Worker), so failures
 * only warn — memory tokens carry the page lifetime either way. Never
 * throws. A stale id (vault rotated/expired) falls back to a fresh create.
 * On success the memory refresh token is dropped: the sealed vault copy
 * is authoritative and rotation goes through the Worker from then on.
 */
async function persistVaultSession(
    tokens: HaloTokens,
    tenant: SessionTenantEndpoints,
): Promise<void> {
    if (!tokens.refresh_token) {
        return;
    }
    const pair: VaultTokenPair = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
        token_type: tokens.token_type,
        scope: tokens.scope,
        obtained_at: tokens.obtained_at,
    };
    try {
        const existing = loadDispatcherSession();
        if (existing) {
            try {
                saveDispatcherSession(await refreshDispatcherSession(existing.sessionId, pair));
            } catch (error) {
                if (!(error instanceof DispatcherSessionError) || error.code !== "unauthorized") {
                    throw error;
                }
                clearDispatcherSession();
                saveDispatcherSession(await createDispatcherSession(pair, tenant));
            }
        } else {
            saveDispatcherSession(await createDispatcherSession(pair, tenant));
        }
        if (memoryTokens) {
            delete memoryTokens.refresh_token;
        }
    } catch (error) {
        console.warn(
            "Dispatcher session persist failed; continuing with a memory-only session:",
            error instanceof Error ? error.message : "Unknown error",
        );
    }
}

/**
 * Repopulate memory tokens from the persisted vault session after a reload.
 * Returns true when memory holds credentials afterwards (possibly stale —
 * the caller still runs the normal expiry/refresh checks). An expired
 * vault session clears the stored id, failing closed to re-login. Never
 * throws.
 */
export async function restoreDispatcherSession(): Promise<boolean> {
    const current = loadTokens();
    if (current && !isTokenExpiringSoon(current)) {
        return true;
    }
    const existing = loadDispatcherSession();
    if (!existing) {
        return false;
    }
    try {
        const used = await fetchDispatcherSession(existing.sessionId);
        adoptAccessCredentials(used.haloAccessToken);
        return true;
    } catch (error) {
        if (error instanceof DispatcherSessionError && error.code === "unauthorized") {
            clearDispatcherSession();
        }
        return false;
    }
}

/**
 * Rotate the vault session's sealed pair inside the Worker and adopt the
 * fresh access-only credentials. A 401 drops the session id (memory is
 * left for the caller: vaulted memory has nothing to fall back to, but a
 * stale id over a usable direct pair can still refresh directly). Any
 * other failure keeps the id for a later retry. Never throws.
 */
async function rotateVaultSessionTokens(sessionId: string): Promise<boolean> {
    try {
        const rotated = await rotateDispatcherSession(sessionId);
        saveDispatcherSession(rotated);
        adoptAccessCredentials(rotated.haloAccessToken);
        return true;
    } catch (error) {
        if (error instanceof DispatcherSessionError && error.code === "unauthorized") {
            clearDispatcherSession();
        }
        return false;
    }
}

/**
 * Ensure a fresh access token: restores from the vault session when memory
 * is empty (post-reload), no-op when the current pair is outside the skew
 * window, otherwise attempts a refresh. Returns true when a usable token
 * set is stored afterwards.
 */
export async function ensureFreshToken(config: AuthConfig): Promise<boolean> {
    let tokens = loadTokens();
    if (!tokens) {
        if (!(await restoreDispatcherSession())) {
            return false;
        }
        tokens = loadTokens();
        if (!tokens) {
            return false;
        }
    }
    if (!tokens.refresh_token && !loadDispatcherSession()) {
        return false;
    }
    if (!isTokenExpiringSoon(tokens)) {
        // Backfill the vault behind an adopted/dev pair so tracking works
        // even before the first Halo refresh.
        if (!loadDispatcherSession()) {
            await persistVaultSession(tokens, {
                authServer: config.authServer,
                clientId: config.clientId,
            });
        }
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
        // Vault the pair behind the persisted session id (best-effort: login
        // still succeeds when the BFF is unreachable).
        await persistVaultSession(loadTokens() as HaloTokens, {
            authServer: config.authServer,
            clientId: config.clientId,
        });

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

/**
 * Refresh the access token. A persisted vault session rotates inside the
 * Worker (memory holds no refresh token in that mode); otherwise — or
 * when rotation fails — the memory pair refreshes directly against Halo
 * (local dev without the BFF, or a stale id over a usable direct pair).
 * Vaulted memory carries no refresh token, so a dead vault session still
 * fails closed to re-login.
 */
export async function refreshToken(config: AuthConfig): Promise<boolean> {
    const session = loadDispatcherSession();
    if (session && (await rotateVaultSessionTokens(session.sessionId))) {
        return true;
    }
    return refreshHaloDirect(config);
}

/** Direct `refresh_token` grant against Halo (no-vault mode only). */
async function refreshHaloDirect(config: AuthConfig): Promise<boolean> {
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
                const session = loadDispatcherSession();
                clearTokens();
                if (session) {
                    void expireDispatcherSession(session.sessionId);
                }
            }
            return false;
        }

        const newTokens = (await response.json()) as HaloTokens;
        // Some providers omit refresh_token on refresh; keep the old one then.
        saveTokens({
            ...newTokens,
            refresh_token: newTokens.refresh_token || tokens.refresh_token,
        });
        // Vault the rotated pair (best-effort): a reachable BFF moves
        // this session into vaulted mode from here on.
        await persistVaultSession(loadTokens() as HaloTokens, {
            authServer: config.authServer,
            clientId: config.clientId,
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
    const session = loadDispatcherSession();
    clearTokens();
    // Clear processed codes and any pending PKCE material on logout
    processedCodes.clear();
    clearPkceRequest();
    // Best-effort server expire; local state is already cleared.
    if (session) {
        void expireDispatcherSession(session.sessionId);
    }
    // Redirect to login page
    if (window.location.pathname !== "/login") {
        window.location.href = "/login";
    }
}
