import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    BookingTrackerError,
    cancelBookingRequest,
    extendBookingRequest,
    fetchBookingAudit,
    fetchBookingRequests,
    resendBookingRequest,
    type BookingAuditTrail,
    type BookingRequestSummary,
} from "@/lib/book-api";
import { loadDispatcherSession } from "@/services/auth/authService";

export interface BookingResendResult {
    summary: BookingRequestSummary;
    token: string;
    oldInvalidated: boolean;
}

export interface BookingTracker {
    /** Every request the signed-in dispatcher minted, newest first. */
    requests: BookingRequestSummary[];
    /** Latest request per ticket (the list is newest-first, so first wins). */
    byTicket: Map<number, BookingRequestSummary>;
    loading: boolean;
    error: string | null;
    /** Rid of the request currently being cancelled/resent, if any. */
    busyRid: string | null;
    refresh: () => Promise<void>;
    /**
     * Cancel an open request. A cancel that races to terminal resolves with
     * the now-current state instead of throwing; other failures throw.
     */
    cancel: (rid: string) => Promise<BookingRequestSummary>;
    /**
     * Resend: mint a fresh link and invalidate the old request. Resolves with
     * the new request summary plus the token (for clipboard copy).
     */
    resend: (previous: BookingRequestSummary) => Promise<BookingResendResult>;
    /**
     * Extend an open request's expiry. Resolves with the updated summary
     * plus the resealed token (for clipboard copy); the old link keeps its
     * shorter expiry. A raced terminal state is adopted locally, then the
     * conflict rethrows.
     */
    extend: (rid: string, days?: number) => Promise<BookingResendResult>;
    /** Read one request's audit trail (view count plus the event list). */
    fetchAudit: (rid: string) => Promise<BookingAuditTrail>;
}

/**
 * Dispatcher tracking state: the Worker's request list plus cancel/resend
 * actions with local state reconciliation. Loads once on mount when signed
 * in and enabled; failures are silent here (consumers decide what to show).
 */
export function useBookingRequests(options: { enabled?: boolean } = {}): BookingTracker {
    const enabled = options.enabled ?? true;
    const [requests, setRequests] = useState<BookingRequestSummary[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busyRid, setBusyRid] = useState<string | null>(null);
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const refresh = useCallback(async () => {
        const session = loadDispatcherSession();
        if (!session) {
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const rows = await fetchBookingRequests(session.sessionId);
            if (mountedRef.current) {
                setRequests(rows);
            }
        } catch (err) {
            if (mountedRef.current) {
                setError(
                    err instanceof BookingTrackerError
                        ? err.message
                        : "Could not load booking requests.",
                );
            }
        } finally {
            if (mountedRef.current) {
                setLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        if (enabled) {
            void refresh();
        }
    }, [enabled, refresh]);

    const cancel = useCallback(async (rid: string): Promise<BookingRequestSummary> => {
        const session = loadDispatcherSession();
        if (!session) {
            throw new BookingTrackerError("unauthorized", "Sign in to Halo first.");
        }
        setBusyRid(rid);
        try {
            const updated = await cancelBookingRequest(rid, session.sessionId).catch(
                (err: unknown) => {
                    // Raced to terminal elsewhere: adopt the current state.
                    if (
                        err instanceof BookingTrackerError &&
                        err.code === "conflict" &&
                        err.current
                    ) {
                        return err.current;
                    }
                    throw err;
                },
            );
            if (mountedRef.current) {
                setRequests((rows) => rows.map((row) => (row.rid === rid ? updated : row)));
            }
            return updated;
        } finally {
            if (mountedRef.current) {
                setBusyRid(null);
            }
        }
    }, []);

    const resend = useCallback(
        async (previous: BookingRequestSummary): Promise<BookingResendResult> => {
            const session = loadDispatcherSession();
            if (!session) {
                throw new BookingTrackerError(
                    "unauthorized",
                    "Sign in to Halo before resending a booking link.",
                );
            }
            setBusyRid(previous.rid);
            try {
                const fresh = await resendBookingRequest({
                    previous,
                    sessionId: session.sessionId,
                });
                const now = new Date().toISOString();
                const summary: BookingRequestSummary = {
                    rid: fresh.rid,
                    status: "pending",
                    ticketId: previous.ticketId,
                    agentIds: previous.agentIds,
                    appointmentTypeId: previous.appointmentTypeId,
                    createdAt: now,
                    updatedAt: now,
                    exp: Math.floor(Date.parse(fresh.expiresAt) / 1000),
                    clickedAt: null,
                    bookedAppointmentId: null,
                    viewCount: 0,
                };
                if (mountedRef.current) {
                    setRequests((rows) => [
                        summary,
                        ...rows.map((row) =>
                            row.rid === previous.rid && fresh.oldInvalidated
                                ? {
                                      ...row,
                                      status: row.status === "pending" ? "cancelled" : row.status,
                                      updatedAt: now,
                                  }
                                : row,
                        ),
                    ]);
                }
                return { summary, token: fresh.token, oldInvalidated: fresh.oldInvalidated };
            } finally {
                if (mountedRef.current) {
                    setBusyRid(null);
                }
            }
        },
        [],
    );

    const extend = useCallback(async (rid: string, days?: number): Promise<BookingResendResult> => {
        const tokens = loadTokens();
        if (!tokens?.access_token) {
            throw new BookingTrackerError("unauthorized", "Sign in to Halo first.");
        }
        setBusyRid(rid);
        try {
            const renewed = await extendBookingRequest({
                rid,
                accessToken: tokens.access_token,
                ...(days === undefined ? {} : { days }),
            }).catch((err: unknown) => {
                // Raced to terminal elsewhere: adopt the current state.
                if (
                    err instanceof BookingTrackerError &&
                    err.code === "conflict" &&
                    err.current &&
                    mountedRef.current
                ) {
                    setRequests((rows) =>
                        rows.map((row) => (row.rid === rid && err.current ? err.current : row)),
                    );
                }
                throw err;
            });
            const exp = Math.floor(Date.parse(renewed.expiresAt) / 1000);
            const updatedAt = new Date().toISOString();
            let summary: BookingRequestSummary | null = null;
            if (mountedRef.current) {
                setRequests((rows) =>
                    rows.map((row) => {
                        if (row.rid !== rid) {
                            return row;
                        }
                        summary = { ...row, exp, updatedAt };
                        return summary;
                    }),
                );
            }
            if (!summary) {
                throw new BookingTrackerError(
                    "not-found",
                    "Booking request is no longer in the list.",
                );
            }
            return { summary, token: renewed.token, oldInvalidated: true };
        } finally {
            if (mountedRef.current) {
                setBusyRid(null);
            }
        }
    }, []);

    const fetchAudit = useCallback(async (rid: string): Promise<BookingAuditTrail> => {
        const tokens = loadTokens();
        if (!tokens?.access_token) {
            throw new BookingTrackerError("unauthorized", "Sign in to Halo first.");
        }
        return fetchBookingAudit(rid, tokens.access_token);
    }, []);

    const byTicket = useMemo(() => {
        const map = new Map<number, BookingRequestSummary>();
        for (const row of requests) {
            if (!map.has(row.ticketId)) {
                map.set(row.ticketId, row);
            }
        }
        return map;
    }, [requests]);

    return {
        requests,
        byTicket,
        loading,
        error,
        busyRid,
        refresh,
        cancel,
        resend,
        extend,
        fetchAudit,
    };
}
