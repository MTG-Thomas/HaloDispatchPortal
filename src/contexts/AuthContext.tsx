/* eslint-disable react-refresh/only-export-components */
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import type { HaloUser } from '@/services/auth/types';
import * as authService from '@/services/auth/authService';
import { useConfig } from '@/hooks/useConfig';

interface AuthContextType {
  isAuthenticated: boolean;
  user: HaloUser | null;
  isLoading: boolean;
  startAuth: () => Promise<void>;
  logout: () => void;
  handleCallback: (code: string, state: string | null) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<HaloUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const { config, isLoaded } = useConfig();

  // Check authentication status when config is loaded, attempting one
  // proactive refresh when tokens exist but are expired or near expiry.
  useEffect(() => {
    if (!isLoaded) return;

    const checkAuth = async () => {
      let authenticated = authService.isAuthenticated();

      if (
        !authenticated &&
        config.authServer &&
        config.clientId &&
        authService.loadTokens()?.refresh_token
      ) {
        const refreshed = await authService.ensureFreshToken({
          authServer: config.authServer,
          clientId: config.clientId,
          redirectUri: config.redirectUri,
        });
        authenticated = refreshed && authService.isAuthenticated();
      }

      setIsAuthenticated(authenticated);

      if (authenticated) {
        const currentUser = authService.getCurrentUser();
        setUser(currentUser);
      } else {
        setUser(null);
      }

      setIsLoading(false);
    };

    checkAuth();
  }, [isLoaded, config.authServer, config.clientId, config.redirectUri]);

  const startAuth = async () => {
    try {
      await authService.startAuth({
        authServer: config.authServer,
        clientId: config.clientId,
        redirectUri: config.redirectUri,
      });
    } catch (error) {
      console.error(
        'Failed to start auth:',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  };

  const handleCallback = useCallback(
    async (code: string, state: string | null): Promise<boolean> => {
      try {
        setIsLoading(true);

        const success = await authService.handleCallback(
          {
            authServer: config.authServer,
            clientId: config.clientId,
            redirectUri: config.redirectUri,
          },
          code,
          state
        );

        if (success) {
          // Re-check authentication status
          const authenticated = authService.isAuthenticated();
          setIsAuthenticated(authenticated);

          if (authenticated) {
            const currentUser = authService.getCurrentUser();
            setUser(currentUser);
          }
        }

        setIsLoading(false);
        return success;
      } catch (error) {
        console.error(
          'Failed to handle auth callback:',
          error instanceof Error ? error.message : 'Unknown error'
        );
        setIsLoading(false);
        return false;
      }
    },
    [config.authServer, config.clientId, config.redirectUri]
  );

  const logout = () => {
    authService.logout();
    setUser(null);
    setIsAuthenticated(false);
    navigate('/login');
  };

  const value: AuthContextType = {
    isAuthenticated,
    user,
    isLoading,
    startAuth,
    logout,
    handleCallback,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
