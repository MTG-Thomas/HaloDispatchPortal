import { loadTokens, refreshToken as refreshAuthToken, clearTokens } from '@/services/auth/authService';
import { useConfigStore } from '@/stores/configStore';
import { useDispatchStore } from '@/stores/useDispatchStore';

// Error class for API errors
export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    message?: string,
    public isCritical: boolean = false
  ) {
    super(message || `API Error: ${status} ${statusText}`);
    this.name = 'ApiError';
  }
}

// Track if a token refresh is in progress to prevent multiple concurrent refresh attempts
let refreshPromise: Promise<boolean> | null = null;

// Track if we've already shown a critical error to prevent infinite retry loops
let hasCriticalError = false;

/**
 * Check if an error is critical (network, CORS, timeout, etc.)
 */
function isCriticalError(error: unknown): boolean {
  // Network errors (CORS, DNS, connection refused, timeout, etc.)
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }

  // Check for common network error messages
  const errorMsg = (error as Error).message?.toLowerCase() || '';
  if (
    errorMsg.includes('cors') ||
    errorMsg.includes('network') ||
    errorMsg.includes('failed to fetch') ||
    errorMsg.includes('networkerror') ||
    errorMsg.includes('timeout')
  ) {
    return true;
  }

  return false;
}

/**
 * Make an authenticated API request with automatic token refresh
 */
export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  // If we already have a critical error, don't make more requests
  if (hasCriticalError) {
    throw new ApiError(
      0,
      'Critical Error',
      'API is currently unavailable. Please retry.',
      true
    );
  }

  const { config } = useConfigStore.getState();

  if (!config.resourceServer) {
    throw new Error('Resource server not configured');
  }

  const url = `${config.resourceServer}${endpoint}`;

  // Get current tokens
  let tokens = loadTokens();

  if (!tokens) {
    throw new ApiError(401, 'Unauthorized', 'No access token available');
  }

  // Prepare headers
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${tokens.access_token}`);
  headers.set('Content-Type', 'application/json');

  try {
    // Make the request
    let response = await fetch(url, {
      ...options,
      headers,
    });

    // If we get a 401, try to refresh the token and retry once
    if (response.status === 401) {
      // Use existing refresh promise if one is in progress, otherwise start a new one
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

      const refreshSuccess = await refreshPromise;

      if (refreshSuccess) {
        // Get new tokens
        tokens = loadTokens();

        if (!tokens) {
          throw new ApiError(401, 'Unauthorized', 'Token refresh succeeded but no tokens available');
        }

        // Update authorization header with new token
        headers.set('Authorization', `Bearer ${tokens.access_token}`);

        // Retry the request with new token
        response = await fetch(url, {
          ...options,
          headers,
        });
      } else {
        // Refresh failed, clear tokens and throw error
        console.error('Token refresh failed');
        clearTokens();
        throw new ApiError(401, 'Unauthorized', 'Token refresh failed');
      }
    }

    // Handle non-OK responses
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new ApiError(response.status, response.statusText, errorText);
    }

    // Parse and return JSON response
    return response.json();
  } catch (error: unknown) {
    // Check if this is a critical error (network, CORS, etc.)
    if (isCriticalError(error) && !hasCriticalError) {
      hasCriticalError = true;

      // Set critical error in store
      const { setCriticalApiError } = useDispatchStore.getState();
      setCriticalApiError(
        'Unable to connect to Halo PSA API',
        (error as Error).message || 'Network error. Please check your connection and CORS settings.'
      );

      // Throw a critical error
      throw new ApiError(
        0,
        'Network Error',
        'Failed to connect to API. This could be a CORS issue, network problem, or the API is unreachable.',
        true
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
 * Make a GET request
 */
export async function get<T>(endpoint: string, params?: Record<string, string | number | boolean>): Promise<T> {
  const queryString = params ? `?${buildQueryString(params)}` : '';
  return apiRequest<T>(`${endpoint}${queryString}`, {
    method: 'GET',
  });
}

/**
 * Make a POST request
 */
export async function post<T>(endpoint: string, body?: unknown): Promise<T> {
  return apiRequest<T>(endpoint, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * Make a PUT request
 */
export async function put<T>(endpoint: string, body?: unknown): Promise<T> {
  return apiRequest<T>(endpoint, {
    method: 'PUT',
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * Make a DELETE request
 */
export async function del<T>(endpoint: string): Promise<T> {
  return apiRequest<T>(endpoint, {
    method: 'DELETE',
  });
}

/**
 * Build a query string from an object
 */
function buildQueryString(params: Record<string, string | number | boolean>): string {
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
