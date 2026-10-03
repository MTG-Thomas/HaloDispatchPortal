import {
    loadTokens,
    refreshToken as refreshAuthToken,
    clearTokens,
    isTokenExpiringSoon,
} from "@/services/auth/authService";
import { useConfigStore } from "@/stores/configStore";
import { useDispatchStore } from "@/stores/useDispatchStore";
import { isAllowedServerUrl } from "./server-url";

// Error class for API errors
export class ApiError extends Error {
    status: number;
    statusText: string;
    isCritical: boolean;

    constructor(status: number, statusText: string, message?: string, isCritical: boolean = false) {
        super(message || `API Error: ${status} ${statusText}`);
        this.name = "ApiError";
        this.status = status;
        this.statusText = statusText;
        this.isCritical = isCritical;
    }
}

// Track if a token refresh is in progress to prevent multiple concurrent refresh attempts
let refreshPromise: Promise<boolean> | null = null;

interface RefreshConfig {
    authServer: string;
    clientId: string;
    redirectUri: string;
}

/**
 * Single-flight token refresh shared by proactive refresh and 401 retry.
 */
function refreshSingleFlight(config: RefreshConfig): Promise<boolean> {
    if (!refreshPromise) {
        refreshPromise = refreshAuthToken({
            authServer: config.authServer,
            clientId: config.clientId,
            redirectUri: config.redirectUri,
        }).finally(() => {
            // Clear the refresh promise when done
            refreshPromise = null;
        });
    }
    return refreshPromise;
}

/**
 * User-facing message for an API failure. Raw response bodies are never
 * surfaced: they flow into toasts and persisted store error state, and may
 * carry tenant data or stack traces.
 */
function getSafeApiErrorMessage(status: number, statusText: string): string {
    if (status === 400) return "Bad request. Please check the request and try again.";
    if (status === 401) return "Session expired. Please sign in again.";
    if (status === 403) return "Access denied. You do not have permission for this action.";
    if (status === 404) return "The requested resource was not found.";
    if (status === 408) return "Request timed out. Please try again.";
    if (status === 429) return "Too many requests. Please wait and try again.";
    if (status >= 500) return "Halo PSA API error. Please try again later.";
    return statusText ? `Request failed: ${statusText}` : `Request failed with status ${status}`;
}

// Track if we've already shown a critical error to prevent infinite retry loops
let hasCriticalError = false;

/**
 * Check if an error is critical (network, CORS, timeout, etc.)
 */
function isCriticalError(error: unknown): boolean {
    // Network errors (CORS, DNS, connection refused, timeout, etc.)
    if (error instanceof TypeError && error.message.includes("fetch")) {
        return true;
    }

    // Check for common network error messages
    const errorMsg = (error as Error).message?.toLowerCase() || "";
    if (
        errorMsg.includes("cors") ||
        errorMsg.includes("network") ||
        errorMsg.includes("failed to fetch") ||
        errorMsg.includes("networkerror") ||
        errorMsg.includes("timeout")
    ) {
        return true;
    }

    return false;
}

/**
 * Make an authenticated API request with automatic token refresh
 */
export async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    // If we already have a critical error, don't make more requests
    if (hasCriticalError) {
        throw new ApiError(
            0,
            "Critical Error",
            "API is currently unavailable. Please retry.",
            true,
        );
    }

    const { config } = useConfigStore.getState();

    if (!config.resourceServer) {
        throw new Error("Resource server not configured");
    }

    // Fail closed: never send authenticated requests to a malformed or
    // non-https URL, even if persisted config was tampered with outside the app.
    if (
        !isAllowedServerUrl(config.resourceServer, {
            allowCustomHosts: true,
            label: "Resource server",
        })
    ) {
        throw new Error("Resource server URL is invalid. Please reconfigure your Halo settings.");
    }

    const url = `${config.resourceServer}${endpoint}`;

    // Get current tokens
    let tokens = loadTokens();

    if (!tokens) {
        throw new ApiError(401, "Unauthorized", "No access token available");
    }

    // Proactively refresh when tokens are expired or inside the skew window,
    // so the request below does not fail with a preventable 401.
    if (isTokenExpiringSoon(tokens) && tokens.refresh_token) {
        const refreshSuccess = await refreshSingleFlight({
            authServer: config.authServer,
            clientId: config.clientId,
            redirectUri: config.redirectUri,
        });
        if (refreshSuccess) {
            tokens = loadTokens();
        }
        if (!tokens) {
            throw new ApiError(401, "Unauthorized", "Session expired. Please sign in again.");
        }
    }

    // Prepare headers
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${tokens.access_token}`);
    headers.set("Content-Type", "application/json");

    try {
        // Make the request
        let response = await fetch(url, {
            ...options,
            headers,
        });

        // If we get a 401, try to refresh the token and retry once
        if (response.status === 401) {
            // Use existing refresh promise if one is in progress, otherwise start a new one
            const refreshSuccess = await refreshSingleFlight({
                authServer: config.authServer,
                clientId: config.clientId,
                redirectUri: config.redirectUri,
            });

            if (refreshSuccess) {
                // Get new tokens
                tokens = loadTokens();

                if (!tokens) {
                    throw new ApiError(
                        401,
                        "Unauthorized",
                        "Token refresh succeeded but no tokens available",
                    );
                }

                // Update authorization header with new token
                headers.set("Authorization", `Bearer ${tokens.access_token}`);

                // Retry the request with new token
                response = await fetch(url, {
                    ...options,
                    headers,
                });
            } else {
                // Refresh failed, clear tokens and throw error
                console.error("Token refresh failed");
                clearTokens();
                throw new ApiError(401, "Unauthorized", "Token refresh failed");
            }
        }

        // Handle non-OK responses. The body is drained and discarded (never
        // logged or surfaced) so raw API payloads cannot leak into toasts,
        // persisted store error state, or logs.
        if (!response.ok) {
            await response.text().catch(() => "Unknown error");
            console.error("API request failed:", response.status, response.statusText);
            throw new ApiError(
                response.status,
                response.statusText,
                getSafeApiErrorMessage(response.status, response.statusText),
            );
        }

        // Parse and return JSON response
        return response.json();
    } catch (error: unknown) {
        // Intentional cancellation: never a critical error, never retried.
        if (isAbortError(error)) {
            throw error;
        }
        // Check if this is a critical error (network, CORS, etc.)
        if (isCriticalError(error) && !hasCriticalError) {
            hasCriticalError = true;

            // Set critical error in store
            const { setCriticalApiError } = useDispatchStore.getState();
            setCriticalApiError(
                "Unable to connect to Halo PSA API",
                (error as Error).message ||
                    "Network error. Please check your connection and CORS settings.",
            );

            // Throw a critical error
            throw new ApiError(
                0,
                "Network Error",
                "Failed to connect to API. This could be a CORS issue, network problem, or the API is unreachable.",
                true,
            );
        }

        // Re-throw the error
        throw error;
    }
}

/**
 * Reset the critical error flag (called when user manually retries)
 */
export function resetCriticalErrorFlag() {
    hasCriticalError = false;
}

/**
 * True when the error is an intentional request cancellation. Callers must
 * treat this as a silent no-op: no error state, no toast, no retry.
 */
export function isAbortError(error: unknown): boolean {
    return (
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && error.name === "AbortError")
    );
}

/**
 * Extra per-request options (all optional, backwards compatible).
 */
export interface RequestOptions {
    signal?: AbortSignal;
}

/**
 * Make a GET request
 */
export async function get<T>(
    endpoint: string,
    params?: Record<string, string | number | boolean | undefined> | object,
    requestOptions?: RequestOptions,
): Promise<T> {
    const queryString = params
        ? `?${buildQueryString(params as Record<string, string | number | boolean | undefined>)}`
        : "";
    return apiRequest<T>(`${endpoint}${queryString}`, {
        method: "GET",
        signal: requestOptions?.signal,
    });
}

/**
 * Make a POST request
 */
export async function post<T>(
    endpoint: string,
    body?: unknown,
    requestOptions?: RequestOptions,
): Promise<T> {
    return apiRequest<T>(endpoint, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
        signal: requestOptions?.signal,
    });
}

/**
 * Make a PUT request
 */
export async function put<T>(
    endpoint: string,
    body?: unknown,
    requestOptions?: RequestOptions,
): Promise<T> {
    return apiRequest<T>(endpoint, {
        method: "PUT",
        body: body ? JSON.stringify(body) : undefined,
        signal: requestOptions?.signal,
    });
}

/**
 * Make a DELETE request
 */
export async function del<T>(endpoint: string, requestOptions?: RequestOptions): Promise<T> {
    return apiRequest<T>(endpoint, {
        method: "DELETE",
        signal: requestOptions?.signal,
    });
}

/**
 * Build a query string from an object
 */
function buildQueryString(params: Record<string, string | number | boolean | undefined>): string {
    const searchParams = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            searchParams.append(key, String(value));
        }
    });

    return searchParams.toString();
}

/**
 * Helper to cancel in-flight requests using AbortController
 */
export function createAbortController(): AbortController {
    return new AbortController();
}
