import { useCallback, useEffect, useRef, useState } from "react";

export const ROW_WINDOW_CHUNK = 40;

export interface RowWindowing {
    /** How many leading rows to render. */
    visibleCount: number;
    /** Attach to a sentinel element after the last row to grow the window. */
    sentinelRef: React.RefObject<HTMLTableRowElement | null>;
    /** Reset to the first chunk (call when the row set changes identity). */
    reset: () => void;
}

/**
 * Simple chunked rendering for long ticket pages: renders the first chunk and
 * grows by intersection as the user scrolls. Falls back to rendering
 * everything when IntersectionObserver is unavailable (e.g. very old browsers).
 */
export function useRowWindowing(totalRows: number, chunkSize = ROW_WINDOW_CHUNK): RowWindowing {
    const [visibleCount, setVisibleCount] = useState(() => Math.min(chunkSize, totalRows));
    const sentinelRef = useRef<HTMLTableRowElement | null>(null);

    const reset = useCallback(() => {
        setVisibleCount(Math.min(chunkSize, totalRows));
    }, [chunkSize, totalRows]);

    useEffect(() => {
        setVisibleCount((current) =>
            Math.min(Math.max(current, Math.min(chunkSize, totalRows)), totalRows),
        );
    }, [chunkSize, totalRows]);

    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel || visibleCount >= totalRows) return;
        if (typeof IntersectionObserver === "undefined") {
            setVisibleCount(totalRows);
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setVisibleCount((current) => Math.min(current + chunkSize, totalRows));
                }
            },
            { rootMargin: "400px" },
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [chunkSize, totalRows, visibleCount]);

    return { visibleCount, sentinelRef, reset };
}
