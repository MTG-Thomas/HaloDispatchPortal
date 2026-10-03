import { useEffect, useState } from "react";

/**
 * Ticking clock for live relative-time displays (e.g. the SLA countdown).
 * Re-renders the consumer every `intervalMs` (default 60s).
 */
export function useNow(intervalMs = 60_000): Date {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), intervalMs);
        return () => clearInterval(timer);
    }, [intervalMs]);

    return now;
}
