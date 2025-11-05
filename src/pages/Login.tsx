import React, { useEffect, lazy, Suspense } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useConfig } from "@/hooks/useConfig";
import { Calendar, Shield, Zap } from "lucide-react";

// Lazy load ConfigDialog - only needed when user clicks to configure
const ConfigDialog = lazy(() => import("@/components/ConfigDialog").then(m => ({ default: m.ConfigDialog })));

const Login: React.FC = () => {
    const { startAuth, isLoading, isAuthenticated } = useAuth();
    const { config, isLoaded, isConfigured, saveConfig } = useConfig();
    const [searchParams] = useSearchParams();

    // Read and apply query parameters for config auto-population
    useEffect(() => {
        const tenant = searchParams.get('tenant');
        const resourceServer = searchParams.get('resourceServer');
        const authServer = searchParams.get('authServer');
        const clientId = searchParams.get('clientId');
        const redirectUri = searchParams.get('redirectUri');

        // Only apply if at least one parameter is present
        if (tenant || resourceServer || authServer || clientId || redirectUri) {
            const configUpdates: Record<string, string> = {};

            if (tenant) configUpdates.tenant = tenant;
            if (resourceServer) configUpdates.resourceServer = resourceServer;
            if (authServer) configUpdates.authServer = authServer;
            if (clientId) configUpdates.clientId = clientId;
            if (redirectUri) configUpdates.redirectUri = redirectUri;

            saveConfig(configUpdates);
        }
    }, [searchParams, saveConfig]);

    // Redirect to main app if already authenticated
    if (isAuthenticated) {
        return <Navigate to="/" replace />;
    }

    const handleLogin = async () => {
        if (!config.clientId) {
            alert("Please configure your Client ID first");
            return;
        }
        await startAuth();
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-4 flex items-center justify-center">
                        <img
                            src="/public/logo.svg"
                            alt="Halo Logo"
                            className="h-12 w-12"
                        />
                    </div>
                    <CardTitle className="text-2xl">
                        Halo Dispatch Portal
                    </CardTitle>
                    <CardDescription>
                        Schedule and manage service appointments with your Halo
                        PSA team
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
                        <Suspense fallback={<div className="h-10" />}>
                            <ConfigDialog />
                        </Suspense>

                        {isLoaded && isConfigured && (
                            <Button
                                onClick={handleLogin}
                                className="w-full"
                                disabled={isLoading}
                            >
                                {isLoading
                                    ? "Connecting..."
                                    : "Login with HaloPSA"}
                            </Button>
                        )}
                    </div>

                    {!isConfigured && (
                        <div className="text-sm text-muted-foreground text-center">
                            Please configure your Halo settings before
                            connecting
                        </div>
                    )}

                    <div className="text-xs text-muted-foreground text-center pt-4 border-t">
                        <p>
                            You'll need to create an OAuth application in your
                            Halo instance
                        </p>
                        <p>and configure the settings above to get started.</p>
                        <p className="mt-2 font-medium">
                            💡 The Redirect URI is automatically generated - use
                            that value in your Halo OAuth app configuration.
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default Login;
