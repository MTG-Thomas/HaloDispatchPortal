import { useCallback, useEffect, useState } from "react";

export const ROW_WINDOW_CHUNK = 40;

export interface RowWindowing {
    /** How many leading rows to render. */
    visibleCount: number;
    /** Attach to a sentinel element after the last row to grow the window. */
    sentinelRef: React.Ref<HTMLTableRowElement>;
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
    // Callback ref (not a RefObject): the observer effect keys on the actual
    // node, so a remounted table re-observes its new sentinel even when the
    // row count and visibleCount are unchanged (e.g. page 1 -> 2, same size).
    const [sentinelNode, setSentinelNode] = useState<HTMLTableRowElement | null>(null);
    const sentinelRef = useCallback((node: HTMLTableRowElement | null) => {
        setSentinelNode(node);
    }, []);

    const reset = useCallback(() => {
        setVisibleCount(Math.min(chunkSize, totalRows));
    }, [chunkSize, totalRows]);

    useEffect(() => {
        setVisibleCount((current) =>
            Math.min(Math.max(current, Math.min(chunkSize, totalRows)), totalRows),
        );
    }, [chunkSize, totalRows]);

    useEffect(() => {
        if (!sentinelNode || visibleCount >= totalRows) return;
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
        observer.observe(sentinelNode);
        return () => observer.disconnect();
    }, [chunkSize, totalRows, visibleCount, sentinelNode]);

    return { visibleCount, sentinelRef, reset };
}
