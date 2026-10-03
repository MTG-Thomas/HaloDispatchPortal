import React, { useEffect, useRef, useState, lazy, Suspense } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useConfig } from "@/hooks/useConfig";
import type { HaloConfig } from "@/hooks/useConfig";
import { isAllowedServerUrl, isValidTenantSlug, normalizeServerUrl } from "@/lib/server-url";
import { AlertTriangle, Calendar, Link2, Shield, Zap } from "lucide-react";

// Lazy load ConfigDialog - only needed when user clicks to configure
const ConfigDialog = lazy(() =>
    import("@/components/ConfigDialog").then((m) => ({ default: m.ConfigDialog })),
);

const MAX_CLIENT_ID_LENGTH = 256;

const Login: React.FC = () => {
    const { startAuth, isLoading, isAuthenticated } = useAuth();
    const { config, isLoaded, isConfigured, saveConfig } = useConfig();
    const [searchParams, setSearchParams] = useSearchParams();
    // A shared login link stages its config here; nothing is applied until
    // the user explicitly confirms.
    const [sharedConfig, setSharedConfig] = useState<Partial<HaloConfig> | null>(null);
    const [sharedLinkIssues, setSharedLinkIssues] = useState<string[]>([]);
    const processedQueryRef = useRef<string | null>(null);

    // Stage (never silently apply) query parameters from a shared login link.
    // Server URLs are allowlisted to https *.halopsa.com; redirectUri is
    // never accepted from a link because it is auto-generated locally.
    useEffect(() => {
        if (isAuthenticated) {
            return;
        }
        const queryString = searchParams.toString();
        if (!queryString || processedQueryRef.current === queryString) {
            return;
        }
        processedQueryRef.current = queryString;

        const tenant = searchParams.get("tenant");
        const resourceServer = searchParams.get("resourceServer");
        const authServer = searchParams.get("authServer");
        const clientId = searchParams.get("clientId");
        const redirectUri = searchParams.get("redirectUri");

        // Strip the query string immediately so shared secrets do not linger
        // in the URL, history, or a page refresh re-prompt.
        setSearchParams({}, { replace: true });

        if (!tenant && !resourceServer && !authServer && !clientId && !redirectUri) {
            return;
        }

        const staged: Partial<HaloConfig> = {};
        const issues: string[] = [];

        if (tenant) {
            if (isValidTenantSlug(tenant)) {
                staged.tenant = tenant.trim();
            } else {
                issues.push("Tenant was ignored: not a valid HaloPSA tenant name.");
            }
        }
        if (resourceServer) {
            if (isAllowedServerUrl(resourceServer, { label: "Resource server" })) {
                staged.resourceServer = normalizeServerUrl(resourceServer);
            } else {
                issues.push(
                    "Resource server was ignored: shared links must use an https *.halopsa.com address.",
                );
            }
        }
        if (authServer) {
            if (isAllowedServerUrl(authServer, { label: "Auth server" })) {
                staged.authServer = normalizeServerUrl(authServer);
            } else {
                issues.push(
                    "Auth server was ignored: shared links must use an https *.halopsa.com address.",
                );
            }
        }
        if (clientId) {
            const trimmed = clientId.trim();
            if (trimmed && trimmed.length <= MAX_CLIENT_ID_LENGTH && !/[\s<>]/.test(trimmed)) {
                staged.clientId = trimmed;
            } else {
                issues.push("Client ID was ignored: not a plausible client identifier.");
            }
        }
        if (redirectUri) {
            issues.push(
                "Redirect URI was ignored: it is generated automatically and never accepted from a link.",
            );
        }

        if (Object.keys(staged).length > 0) {
            setSharedConfig(staged);
        }
        if (issues.length > 0 || Object.keys(staged).length === 0) {
            setSharedLinkIssues(
                issues.length > 0 ? issues : ["The shared link carried no usable configuration."],
            );
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams, isAuthenticated]);

    const handleApplySharedConfig = () => {
        if (sharedConfig) {
            saveConfig(sharedConfig);
            setSharedConfig(null);
            setSharedLinkIssues([]);
        }
    };

    const handleDismissSharedConfig = () => {
        setSharedConfig(null);
        setSharedLinkIssues([]);
    };

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
                        <img src="/logo.svg" alt="Halo Logo" className="h-12 w-12" />
                    </div>
                    <CardTitle className="text-2xl">Halo Dispatch Portal</CardTitle>
                    <CardDescription>
                        Schedule and manage service appointments with your Halo PSA team
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {sharedConfig && (
                        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950">
                            <div className="flex items-center gap-2 font-medium">
                                <Link2 className="h-4 w-4" />
                                Apply shared configuration?
                            </div>
                            <p className="mt-1 text-muted-foreground">
                                A shared login link proposes these settings. Nothing is applied
                                until you confirm.
                            </p>
                            <dl className="mt-2 space-y-1 break-all text-xs">
                                {sharedConfig.tenant && (
                                    <div className="flex gap-2">
                                        <dt className="font-medium">Tenant:</dt>
                                        <dd>{sharedConfig.tenant}</dd>
                                    </div>
                                )}
                                {sharedConfig.resourceServer && (
                                    <div className="flex gap-2">
                                        <dt className="font-medium">Resource server:</dt>
                                        <dd>{sharedConfig.resourceServer}</dd>
                                    </div>
                                )}
                                {sharedConfig.authServer && (
                                    <div className="flex gap-2">
                                        <dt className="font-medium">Auth server:</dt>
                                        <dd>{sharedConfig.authServer}</dd>
                                    </div>
                                )}
                                {sharedConfig.clientId && (
                                    <div className="flex gap-2">
                                        <dt className="font-medium">Client ID:</dt>
                                        <dd>•••••• (provided)</dd>
                                    </div>
                                )}
                            </dl>
                            <div className="mt-3 flex gap-2">
                                <Button size="sm" onClick={handleApplySharedConfig}>
                                    Apply configuration
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={handleDismissSharedConfig}
                                >
                                    Dismiss
                                </Button>
                            </div>
                        </div>
                    )}

                    {sharedLinkIssues.length > 0 && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
                            <div className="flex items-center gap-2 font-medium">
                                <AlertTriangle className="h-4 w-4" />
                                Shared link notice
                            </div>
                            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                                {sharedLinkIssues.map((issue) => (
                                    <li key={issue}>{issue}</li>
                                ))}
                            </ul>
                            {!sharedConfig && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="mt-2"
                                    onClick={handleDismissSharedConfig}
                                >
                                    Dismiss
                                </Button>
                            )}
                        </div>
                    )}

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
                            <Button onClick={handleLogin} className="w-full" disabled={isLoading}>
                                {isLoading ? "Connecting..." : "Login with HaloPSA"}
                            </Button>
                        )}
                    </div>

                    {!isConfigured && (
                        <div className="text-sm text-muted-foreground text-center">
                            Please configure your Halo settings before connecting
                        </div>
                    )}

                    <div className="text-xs text-muted-foreground text-center pt-4 border-t">
                        <p>You'll need to create an OAuth application in your Halo instance</p>
                        <p>and configure the settings above to get started.</p>
                        <p className="mt-2 font-medium">
                            💡 The Redirect URI is automatically generated - use that value in your
                            Halo OAuth app configuration.
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default Login;
