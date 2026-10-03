import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useBookingNotify, BOOKING_NOTIFY_MIN_POLL_MS } from "@/hooks/useBookingNotify";
import type { BookingRequestSummary } from "@/lib/book-api";

function summary(overrides: Partial<BookingRequestSummary> = {}): BookingRequestSummary {
    return {
        rid: "rid-1",
        status: "pending",
        ticketId: 42,
        agentIds: [7],
        appointmentTypeId: 3,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        exp: 9_999_999_999,
        clickedAt: null,
        bookedAppointmentId: null,
        viewCount: 0,
        ...overrides,
    };
}

interface FiredNotification {
    title: string;
    options?: NotificationOptions;
}

let fired: FiredNotification[];

function stubNotification(permission: NotificationPermission) {
    fired = [];
    class FakeNotification {
        static permission: NotificationPermission = permission;
        static requestPermission = vi.fn(async () => permission);
        constructor(title: string, options?: NotificationOptions) {
            fired.push({ title, options });
        }
    }
    vi.stubGlobal("Notification", FakeNotification);
}

function stubVisibility(hidden: boolean, visibilityState: DocumentVisibilityState) {
    Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
    Object.defineProperty(document, "visibilityState", {
        value: visibilityState,
        configurable: true,
    });
}

describe("useBookingNotify", () => {
    const realHidden = Object.getOwnPropertyDescriptor(document, "hidden");
    const realVisibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState");

    beforeEach(() => {
        vi.useFakeTimers();
        stubVisibility(false, "visible");
    });

    afterEach(() => {
        if (realHidden) {
            Object.defineProperty(document, "hidden", realHidden);
        }
        if (realVisibilityState) {
            Object.defineProperty(document, "visibilityState", realVisibilityState);
        }
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    it("treats the first snapshot as baseline, not news", () => {
        const refresh = vi.fn(async () => {});
        const { result } = renderHook(() =>
            useBookingNotify({
                listLoaded: true,
                requests: [summary({ clickedAt: "2026-10-02T00:00:00.000Z" })],
                refresh,
            }),
        );
        expect(result.current.unreadCount).toBe(0);
        expect(result.current.unreadRids).toEqual([]);
    });

    it("ignores the pre-load empty list and seeds from the first load", () => {
        stubNotification("granted");
        const refresh = vi.fn(async () => {});
        const { result, rerender } = renderHook(
            ({
                requests,
                listLoaded,
            }: {
                requests: BookingRequestSummary[];
                listLoaded: boolean;
            }) => useBookingNotify({ listLoaded, requests, refresh, notifyEnabled: true }),
            {
                initialProps: {
                    requests: [] as BookingRequestSummary[],
                    listLoaded: false,
                },
            },
        );
        // First completed load carries pre-existing activity: history, not news.
        rerender({
            requests: [summary({ clickedAt: "2026-10-02T00:00:00.000Z" })],
            listLoaded: true,
        });
        expect(result.current.unreadCount).toBe(0);
        expect(fired).toHaveLength(0);
        // Later transitions still surface.
        rerender({
            requests: [
                summary({
                    status: "booked",
                    clickedAt: "2026-10-02T00:00:00.000Z",
                    bookedAppointmentId: 9,
                }),
            ],
            listLoaded: true,
        });
        expect(result.current.unreadCount).toBe(1);
        expect(fired).toHaveLength(1);
    });

    it("marks viewed and booked transitions unread", () => {
        const refresh = vi.fn(async () => {});
        const { result, rerender } = renderHook(
            ({ requests }: { requests: BookingRequestSummary[] }) =>
                useBookingNotify({ listLoaded: true, requests, refresh }),
            { initialProps: { requests: [summary()] } },
        );
        rerender({
            requests: [summary({ clickedAt: "2026-10-02T00:00:00.000Z" })],
        });
        expect(result.current.unreadCount).toBe(1);
        expect(result.current.unreadRids).toEqual(["rid-1"]);

        rerender({
            requests: [
                summary({
                    status: "booked",
                    clickedAt: "2026-10-02T00:00:00.000Z",
                    bookedAppointmentId: 9,
                }),
            ],
        });
        expect(result.current.unreadCount).toBe(1);
        expect(result.current.unreadRids).toEqual(["rid-1"]);
    });

    it("clears unread on markAllSeen and keeps tracking after", () => {
        const refresh = vi.fn(async () => {});
        const { result, rerender } = renderHook(
            ({ requests }: { requests: BookingRequestSummary[] }) =>
                useBookingNotify({ listLoaded: true, requests, refresh }),
            { initialProps: { requests: [summary()] } },
        );
        rerender({ requests: [summary({ clickedAt: "2026-10-02T00:00:00.000Z" })] });
        expect(result.current.unreadCount).toBe(1);

        act(() => {
            result.current.markAllSeen();
        });
        expect(result.current.unreadCount).toBe(0);

        rerender({
            requests: [
                summary({
                    status: "booked",
                    clickedAt: "2026-10-02T00:00:00.000Z",
                    bookedAppointmentId: 9,
                }),
            ],
        });
        expect(result.current.unreadCount).toBe(1);
    });

    it("polls on the interval and clamps below the floor", async () => {
        const refresh = vi.fn(async () => {});
        renderHook(() =>
            useBookingNotify({
                listLoaded: true,
                requests: [summary()],
                refresh,
                pollIntervalMs: 1_000,
            }),
        );
        await act(async () => {
            vi.advanceTimersByTime(BOOKING_NOTIFY_MIN_POLL_MS - 1);
        });
        expect(refresh).not.toHaveBeenCalled();
        await act(async () => {
            vi.advanceTimersByTime(1);
        });
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("skips polls while the tab is hidden", async () => {
        const refresh = vi.fn(async () => {});
        renderHook(() => useBookingNotify({ listLoaded: true, requests: [summary()], refresh }));
        stubVisibility(true, "hidden");
        await act(async () => {
            vi.advanceTimersByTime(60_000);
        });
        expect(refresh).not.toHaveBeenCalled();
    });

    it("re-polls once when the tab becomes visible", async () => {
        const refresh = vi.fn(async () => {});
        renderHook(() => useBookingNotify({ listLoaded: true, requests: [summary()], refresh }));
        stubVisibility(false, "visible");
        await act(async () => {
            document.dispatchEvent(new Event("visibilitychange"));
        });
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("never stacks overlapping refreshes", async () => {
        const refresh = vi.fn(() => new Promise<void>(() => {}));
        renderHook(() => useBookingNotify({ listLoaded: true, requests: [summary()], refresh }));
        await act(async () => {
            vi.advanceTimersByTime(60_000);
        });
        await act(async () => {
            vi.advanceTimersByTime(60_000);
        });
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("does not poll when disabled", async () => {
        const refresh = vi.fn(async () => {});
        renderHook(() =>
            useBookingNotify({ listLoaded: true, requests: [summary()], refresh, enabled: false }),
        );
        await act(async () => {
            vi.advanceTimersByTime(600_000);
        });
        expect(refresh).not.toHaveBeenCalled();
    });

    it("stops polling after unmount", () => {
        const clearSpy = vi.spyOn(globalThis, "clearInterval");
        const refresh = vi.fn(async () => {});
        const { unmount } = renderHook(() =>
            useBookingNotify({ listLoaded: true, requests: [summary()], refresh }),
        );
        unmount();
        expect(clearSpy).toHaveBeenCalled();
    });

    it("fires an opt-in browser Notification per event", () => {
        stubNotification("granted");
        const refresh = vi.fn(async () => {});
        const { rerender } = renderHook(
            ({ requests }: { requests: BookingRequestSummary[] }) =>
                useBookingNotify({ listLoaded: true, requests, refresh, notifyEnabled: true }),
            { initialProps: { requests: [summary()] } },
        );
        rerender({ requests: [summary({ clickedAt: "2026-10-02T00:00:00.000Z" })] });
        expect(fired).toHaveLength(1);
        expect(fired[0]?.title).toContain("ticket #42");
        expect(fired[0]?.title).toContain("viewed");
    });

    it("stays silent without opt-in even when permission is granted", () => {
        stubNotification("granted");
        const refresh = vi.fn(async () => {});
        const { rerender } = renderHook(
            ({ requests }: { requests: BookingRequestSummary[] }) =>
                useBookingNotify({ listLoaded: true, requests, refresh, notifyEnabled: false }),
            { initialProps: { requests: [summary()] } },
        );
        rerender({ requests: [summary({ clickedAt: "2026-10-02T00:00:00.000Z" })] });
        expect(fired).toHaveLength(0);
    });

    it("stays silent when permission is denied", () => {
        stubNotification("denied");
        const refresh = vi.fn(async () => {});
        const { rerender } = renderHook(
            ({ requests }: { requests: BookingRequestSummary[] }) =>
                useBookingNotify({ listLoaded: true, requests, refresh, notifyEnabled: true }),
            { initialProps: { requests: [summary()] } },
        );
        rerender({
            requests: [
                summary({
                    status: "booked",
                    clickedAt: "2026-10-02T00:00:00.000Z",
                    bookedAppointmentId: 9,
                }),
            ],
        });
        expect(fired).toHaveLength(0);
    });

    it("resolves requestNotifyPermission through the browser API", async () => {
        stubNotification("granted");
        const refresh = vi.fn(async () => {});
        const { result } = renderHook(() =>
            useBookingNotify({ listLoaded: true, requests: [summary()], refresh }),
        );
        expect(result.current.notifyPermission).toBe("granted");
        let permission: string | undefined;
        await act(async () => {
            permission = await result.current.requestNotifyPermission();
        });
        expect(permission).toBe("granted");
    });

    it("reports unsupported where Notification is missing", () => {
        const refresh = vi.fn(async () => {});
        const { result } = renderHook(() =>
            useBookingNotify({ listLoaded: true, requests: [summary()], refresh }),
        );
        expect(result.current.notifyPermission).toBe("unsupported");
    });
});
