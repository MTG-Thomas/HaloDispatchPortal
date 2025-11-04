import React from 'react';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ConfigDialog } from '@/components/ConfigDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useConfig } from '@/hooks/useConfig';
import { Calendar, Shield, Zap } from 'lucide-react';

const Login: React.FC = () => {
  const { startAuth, isLoading, isAuthenticated } = useAuth();
  const { config, isLoaded, isConfigured } = useConfig();

  // Redirect to main app if already authenticated
  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const handleLogin = async () => {
    if (!config.clientId) {
      alert('Please configure your Client ID first');
      return;
    }
    await startAuth();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex items-center justify-center">
            <Calendar className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="text-2xl">Halo Dispatch</CardTitle>
          <CardDescription>
            Schedule and manage service appointments with your Halo PSA team
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <h3 className="font-medium">Features</h3>
            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Secure OAuth authentication
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Drag and drop scheduling
              </div>
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Real-time availability
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <ConfigDialog />

            {isLoaded && isConfigured && (
              <Button
                onClick={handleLogin}
                className="w-full"
                disabled={isLoading}
              >
                {isLoading ? 'Connecting...' : 'Login with HaloPSA'}
              </Button>
            )}
          </div>

          {!isConfigured && (
            <div className="text-sm text-muted-foreground text-center">
              Please configure your Halo settings before connecting
            </div>
          )}

          <div className="text-xs text-muted-foreground text-center pt-4 border-t">
            <p>
              You'll need to create an OAuth application in your Halo
              instance
            </p>
            <p>and configure the settings above to get started.</p>
            <p className="mt-2 font-medium">
              💡 The Redirect URI is automatically generated - use that
              value in your Halo OAuth app configuration.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
