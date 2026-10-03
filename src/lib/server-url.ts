/**
 * Central server-URL validation and normalization for Halo endpoints.
 *
 * All Halo server URLs (resource server, auth server) flow through here so
 * untrusted input — login-link query params, dialog entry, tampered
 * localStorage — is normalized and validated in one place.
 *
 * Policy:
 * - Server URLs must be absolute https URLs (http is allowed only for
 *   localhost/127.0.0.1 so local development keeps working).
 * - No embedded credentials, query string, or fragment: a server URL is a
 *   bare origin (+ optional path prefix such as /auth).
 * - Untrusted origins (shared login links) are additionally allowlisted to
 *   the HaloPSA SaaS domain (*.halopsa.com). Manually entered config may
 *   use custom hosts (self-hosted Halo) but must still satisfy the rules
 *   above.
 */

const HALO_SAAS_DOMAIN = 'halopsa.com';
const HALO_SAAS_SUFFIX = `.${HALO_SAAS_DOMAIN}`;

/** Subdomain-safe tenant slug: letters, digits, interior hyphens, <= 63 chars. */
const TENANT_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

const MAX_URL_LENGTH = 2048;

export interface ValidateServerUrlOptions {
  /** When false (default), only *.halopsa.com hosts are accepted. */
  allowCustomHosts?: boolean;
  /** Field label used in error messages. */
  label?: string;
}

/** Trim whitespace and strip trailing slashes. Pure formatting, no validation. */
export function normalizeServerUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/** True for halopsa.com and *.halopsa.com (case-insensitive). */
export function isHaloSaasHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return host === HALO_SAAS_DOMAIN || host.endsWith(HALO_SAAS_SUFFIX);
}

function isLocalhostHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/** True when the tenant slug is safe to interpolate into a *.halopsa.com URL. */
export function isValidTenantSlug(tenant: string): boolean {
  const slug = tenant.trim();
  if (slug.length === 0 || slug.length > 63) {
    return false;
  }
  return TENANT_PATTERN.test(slug);
}

/** Derive the SaaS resource server for a tenant slug (slug must be validated first). */
export function buildResourceServer(tenant: string): string {
  return `https://${tenant.trim().toLowerCase()}${HALO_SAAS_SUFFIX}`;
}

/** Derive the auth server from a resource server URL. */
export function buildAuthServer(resourceServer: string): string {
  return `${normalizeServerUrl(resourceServer)}/auth`;
}

/**
 * Validate a Halo server URL. Returns an error message, or null when valid.
 * Note: pass the raw value; normalization is applied to a copy internally,
 * but callers must store normalizeServerUrl(value) themselves.
 */
export function validateServerUrl(
  value: string,
  options: ValidateServerUrlOptions = {}
): string | null {
  const { allowCustomHosts = false, label = 'Server URL' } = options;
  const normalized = normalizeServerUrl(value);

  if (!normalized) {
    return `${label} is required.`;
  }
  if (normalized.length > MAX_URL_LENGTH) {
    return `${label} is too long.`;
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return `${label} must be a valid absolute URL (e.g. https://tenant.halopsa.com).`;
  }

  if (url.username || url.password) {
    return `${label} must not contain credentials.`;
  }
  if (url.search || url.hash) {
    return `${label} must be a bare server address without query or fragment.`;
  }

  if (url.protocol === 'http:') {
    if (!isLocalhostHost(url.hostname)) {
      return `${label} must use https.`;
    }
  } else if (url.protocol !== 'https:') {
    return `${label} must use https.`;
  }

  if (!allowCustomHosts && !isHaloSaasHost(url.hostname)) {
    return `${label} must be a *.${HALO_SAAS_DOMAIN} address.`;
  }

  return null;
}

/** Boolean convenience wrapper around validateServerUrl. */
export function isAllowedServerUrl(
  value: string,
  options: ValidateServerUrlOptions = {}
): boolean {
  return validateServerUrl(value, options) === null;
}
