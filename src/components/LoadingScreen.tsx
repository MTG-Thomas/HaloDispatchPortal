import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

interface LoadingScreenProps {
    message?: string;
}

const LOADING_MESSAGES = [
    "Loading configuration...",
    "Connecting to Halo API...",
    "Fetching ticket areas...",
    "Loading agents and teams...",
    "Preparing workspace...",
];

/**
 * LoadingScreen Component
 *
 * Displays an animated loading screen with a spinner and rotating messages
 */
export function LoadingScreen({ message = "Loading..." }: LoadingScreenProps) {
    const [loadingMessage, setLoadingMessage] = useState(message);

    useEffect(() => {
        let index = 0;
        const interval = setInterval(() => {
            index = (index + 1) % LOADING_MESSAGES.length;
            setLoadingMessage(LOADING_MESSAGES[index]);
        }, 2000);

        return () => clearInterval(interval);
    }, []);

    return (
        <div className="h-screen w-screen flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-6 max-w-md px-4">
                {/* Animated Spinner */}
                <div className="relative">
                    <Loader2 className="h-16 w-16 animate-spin text-primary" />
                    <div className="absolute inset-0 h-16 w-16 animate-ping opacity-20 rounded-full bg-primary" />
                </div>

                {/* Loading Message */}
                <div className="text-center space-y-2">
                    <h2 className="text-2xl font-semibold">
                        Halo Dispatch Portal
                    </h2>
                    <p className="text-muted-foreground animate-pulse">
                        {loadingMessage}
                    </p>
                </div>

                {/* Progress Bar */}
                <div className="w-64 h-1 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full animate-[loading_2s_ease-in-out_infinite]" />
                </div>
            </div>
        </div>
    );
}
