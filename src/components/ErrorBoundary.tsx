import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";

interface ErrorBoundaryProps {
    children: ReactNode;
    /** Shown above the reset actions; defaults to a generic message. */
    fallbackTitle?: string;
}

interface ErrorBoundaryState {
    hasError: boolean;
}

/**
 * Render-crash containment: a failed route or panel shows a recovery screen
 * instead of a blank page. Recovery is a full reload to a known route so no
 * half-initialized store state survives.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = { hasError: false };

    static getDerivedStateFromError(): ErrorBoundaryState {
        return { hasError: true };
    }

    componentDidCatch(error: unknown): void {
        logger.error("Uncaught render error:", error);
    }

    private handleReload = (): void => {
        window.location.reload();
    };

    private handleGoHome = (): void => {
        window.location.href = "/";
    };

    render(): ReactNode {
        if (!this.state.hasError) {
            return this.props.children;
        }
        return (
            <div className="min-h-screen flex items-center justify-center bg-background p-4">
                <div className="w-full max-w-md text-center space-y-4">
                    <h1 className="text-2xl font-semibold">
                        {this.props.fallbackTitle ?? "Something went wrong"}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        The view failed to render. Your Halo configuration and sign-in are untouched
                        — reloading usually recovers.
                    </p>
                    <div className="flex gap-2 justify-center">
                        <Button onClick={this.handleReload}>Reload this page</Button>
                        <Button variant="outline" onClick={this.handleGoHome}>
                            Go to dispatch
                        </Button>
                    </div>
                </div>
            </div>
        );
    }
}
