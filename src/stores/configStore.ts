import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { normalizeServerUrl } from '@/lib/server-url';

export interface HaloConfig {
  tenant: string;
  authServer: string;
  resourceServer: string;
  clientId: string;
  redirectUri: string;
}

const defaultConfig: HaloConfig = {
  tenant: '',
  authServer: '',
  resourceServer: '',
  clientId: '',
  redirectUri: '',
};

interface ConfigState {
  config: HaloConfig;
  isLoaded: boolean;
  isConfigured: boolean;
  setConfig: (updates: Partial<HaloConfig>) => void;
  resetConfig: () => void;
  setLoaded: (loaded: boolean) => void;
  generateRedirectUri: () => string;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
      config: defaultConfig,
      isLoaded: false,
      isConfigured: false,

      setConfig: (updates) => {
        // Normalize server URLs centrally so every entry point (dialog,
        // shared login links, rehydrated storage) stores the same shape.
        const normalizedUpdates: Partial<HaloConfig> = { ...updates };
        if (normalizedUpdates.authServer !== undefined) {
          normalizedUpdates.authServer = normalizeServerUrl(
            normalizedUpdates.authServer
          );
        }
        if (normalizedUpdates.resourceServer !== undefined) {
          normalizedUpdates.resourceServer = normalizeServerUrl(
            normalizedUpdates.resourceServer
          );
        }
        if (normalizedUpdates.tenant !== undefined) {
          normalizedUpdates.tenant = normalizedUpdates.tenant.trim();
        }
        if (normalizedUpdates.clientId !== undefined) {
          normalizedUpdates.clientId = normalizedUpdates.clientId.trim();
        }
        if (normalizedUpdates.redirectUri !== undefined) {
          normalizedUpdates.redirectUri = normalizedUpdates.redirectUri.trim();
        }

        set((state) => {
          const newConfig = { ...state.config, ...normalizedUpdates };
          const isConfigured = Boolean(
            newConfig.clientId &&
              newConfig.clientId.trim() !== '' &&
              newConfig.authServer &&
              newConfig.authServer.trim() !== '' &&
              newConfig.resourceServer &&
              newConfig.resourceServer.trim() !== ''
          );

          return {
            config: newConfig,
            isConfigured,
          };
        });
      },

      resetConfig: () => {
        const defaultRedirectUri = get().generateRedirectUri();
        set({
          config: {
            ...defaultConfig,
            redirectUri: defaultRedirectUri,
          },
          isConfigured: false,
        });
      },

      setLoaded: (loaded) => {
        set({ isLoaded: loaded });
      },

      generateRedirectUri: () => {
        const baseUrl =
          typeof window !== 'undefined' ? window.location.origin : '';
        return `${baseUrl}/auth/callback`;
      },
    }),
    {
      name: 'halo-dispatch-config',
      partialize: (state) => ({ config: state.config }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Normalize rehydrated values (persisted storage is untrusted input).
          state.config.authServer = normalizeServerUrl(
            state.config.authServer ?? ''
          );
          state.config.resourceServer = normalizeServerUrl(
            state.config.resourceServer ?? ''
          );
          state.config.tenant = (state.config.tenant ?? '').trim();
          state.config.clientId = (state.config.clientId ?? '').trim();
          state.config.redirectUri = (state.config.redirectUri ?? '').trim();

          // Generate redirect URI on rehydration
          const defaultRedirectUri = state.generateRedirectUri();
          if (!state.config.redirectUri) {
            state.config.redirectUri = defaultRedirectUri;
          }

          // Check if config is complete
          const isConfigured = Boolean(
            state.config.clientId &&
              state.config.clientId.trim() !== '' &&
              state.config.authServer &&
              state.config.authServer.trim() !== '' &&
              state.config.resourceServer &&
              state.config.resourceServer.trim() !== ''
          );

          state.isConfigured = isConfigured;
          state.setLoaded(true);
        }
      },
    }
  )
);
