import { useCallback, useEffect, useRef, useState } from "react";
import type { BookingRequestSummary } from "@/lib/book-api";
import { detectBookingActivity, mergeUnreadRids } from "@/lib/booking-notify";

/** Default poll cadence for the booking-request list. */
export const BOOKING_NOTIFY_POLL_MS = 60_000;
/** Floor: refreshes never run closer together than this, however configured. */
export const BOOKING_NOTIFY_MIN_POLL_MS = 15_000;

export type NotifyPermission = NotificationPermission | "unsupported";

export interface UseBookingNotifyOptions {
    /** Live list snapshot from the booking tracker. */
    requests: BookingRequestSummary[];
    /** Tracker refresh; polled on the visibility-aware interval. */
    refresh: () => Promise<unknown>;
    /** False disables polling (diffing still tracks manual refreshes). */
    enabled?: boolean;
    /** Poll cadence; values below the floor are clamped up. */
    pollIntervalMs?: number;
    /** Opt-in: fire a browser Notification per activity event. */
    notifyEnabled?: boolean;
}

export interface BookingNotify {
    unreadRids: string[];
    unreadCount: number;
    markAllSeen: () => void;
    notifyPermission: NotifyPermission;
    requestNotifyPermission: () => Promise<NotifyPermission>;
}

function snapshotByRid(requests: BookingRequestSummary[]): Map<string, BookingRequestSummary> {
    return new Map(requests.map((row) => [row.rid, row]));
}

function currentPermission(): NotifyPermission {
    return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

function fireBrowserNotification(ticketId: number, kind: "viewed" | "booked", rid: string): void {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") {
        return;
    }
    const title =
        kind === "booked"
            ? `Booking confirmed — ticket #${ticketId}`
            : `Booking link viewed — ticket #${ticketId}`;
    const body =
        kind === "booked"
            ? "The customer booked an appointment through your link."
            : "The customer opened your booking link — awaiting booking.";
    new Notification(title, { body, tag: `booking-${kind}-${rid}` });
}

/**
 * Polling-based unread tracking for dispatcher booking requests.
 *
 * Polls the tracker list on a visibility-aware interval (hidden tabs skip,
 * overlapping refreshes never stack, returning to the tab re-polls once),
 * diffs snapshots for customer activity (first view, booking), and keeps an
 * unread set the queue badge reads. Browser Notifications are strictly
 * opt-in via `notifyEnabled` and need OS-level granted permission.
 */
export function useBookingNotify(options: UseBookingNotifyOptions): BookingNotify {
    const {
        requests,
        refresh,
        enabled = true,
        pollIntervalMs = BOOKING_NOTIFY_POLL_MS,
        notifyEnabled = false,
    } = options;
    const [unreadRids, setUnreadRids] = useState<string[]>([]);
    const [notifyPermission, setNotifyPermission] = useState<NotifyPermission>(currentPermission);
    const baselineRef = useRef<Map<string, BookingRequestSummary> | null>(null);
    const refreshRef = useRef(refresh);
    refreshRef.current = refresh;
    const notifyRef = useRef(notifyEnabled);
    notifyRef.current = notifyEnabled;
    const inFlightRef = useRef(false);

    const poll = useCallback(() => {
        if (typeof document !== "undefined" && document.hidden) {
            return;
        }
        if (inFlightRef.current) {
            return;
        }
        inFlightRef.current = true;
        void refreshRef
            .current()
            .catch(() => {
                // Tracker surfaces list errors in the queue UI; polling stays silent.
            })
            .finally(() => {
                inFlightRef.current = false;
            });
    }, []);

    useEffect(() => {
        if (!enabled) {
            return;
        }
        const intervalMs = Math.max(pollIntervalMs, BOOKING_NOTIFY_MIN_POLL_MS);
        const timer = setInterval(poll, intervalMs);
        const onVisibility = () => {
            if (document.visibilityState === "visible") {
                poll();
            }
        };
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [enabled, pollIntervalMs, poll]);

    useEffect(() => {
        const baseline = baselineRef.current;
        if (baseline === null) {
            // First snapshot seeds the baseline: pre-existing activity is
            // history, not news — only later transitions become unread.
            baselineRef.current = snapshotByRid(requests);
            return;
        }
        const events = detectBookingActivity(baseline, requests);
        baselineRef.current = snapshotByRid(requests);
        if (events.length === 0) {
            // Still prune rids that left the list between snapshots.
            setUnreadRids((unread) => mergeUnreadRids(unread, events, requests));
            return;
        }
        setUnreadRids((unread) => mergeUnreadRids(unread, events, requests));
        if (notifyRef.current) {
            for (const event of events) {
                fireBrowserNotification(event.ticketId, event.kind, event.rid);
            }
        }
    }, [requests]);

    const markAllSeen = useCallback(() => {
        setUnreadRids([]);
    }, []);

    const requestNotifyPermission = useCallback(async (): Promise<NotifyPermission> => {
        if (typeof Notification === "undefined") {
            setNotifyPermission("unsupported");
            return "unsupported";
        }
        const permission = await Notification.requestPermission();
        setNotifyPermission(permission);
        return permission;
    }, []);

    return {
        unreadRids,
        unreadCount: unreadRids.length,
        markAllSeen,
        notifyPermission,
        requestNotifyPermission,
    };
}
