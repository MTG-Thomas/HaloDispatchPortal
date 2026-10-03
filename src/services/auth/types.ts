export interface HaloTokens {
    access_token: string;
    /**
     * Present only in direct (no-vault) mode. Vaulted sessions keep the
     * refresh token sealed in the Worker and rotate through it; memory
     * holds access-only credentials after the pair is vaulted.
     */
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    scope: string;
    /**
     * Epoch milliseconds when the token set was obtained, stamped locally by
     * saveTokens(). Optional only so token sets persisted before this field
     * existed still parse; a missing value is treated as expired.
     */
    obtained_at?: number;
}

export interface HaloUser {
    id: string;
    username: string;
    email?: string;
}

export interface AuthConfig {
    authServer: string;
    clientId: string;
    redirectUri: string;
}
