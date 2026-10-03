import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { requestOverdueAlertPermission, useSlaOverdueAlerts } from "@/hooks/useSlaOverdueAlerts";
import type { EnrichedTicket } from "@/types/halo";

const NOW = new Date("2026-10-03T12:00:00.000Z");
const LATER = new Date("2026-10-03T13:30:00.000Z");

function ticket(partial: Partial<EnrichedTicket> & { id: number }): EnrichedTicket {
    return {
        dateoccurred: "2026-10-03T11:00:00.000Z",
        lastactiondate: "2026-10-03T11:30:00.000Z",
        fixbydate: "2026-10-10T12:00:00.000Z",
        excludefromsla: false,
        onhold: false,
        priority_id: 3,
        summary: `Summary ${partial.id}`,
        ...partial,
    } as EnrichedTicket;
}

interface MockNotificationInstance {
    title: string;
    options?: NotificationOptions;
}

const instances: MockNotificationInstance[] = [];
class MockNotification {
    static permission: NotificationPermission = "granted";
    static requestPermission = vi.fn(async (): Promise<NotificationPermission> => "granted");
    constructor(title: string, options?: NotificationOptions) {
        instances.push({ title, options });
    }
}

function stubNotifications(permission: NotificationPermission = "granted") {
    instances.length = 0;
    MockNotification.permission = permission;
    MockNotification.requestPermission.mockClear();
    vi.stubGlobal("Notification", MockNotification);
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("useSlaOverdueAlerts", () => {
    it("stays silent on mount for already-overdue tickets", () => {
        stubNotifications();
        const tickets = [
            ticket({ id: 1, fixbydate: "2026-10-01T12:00:00.000Z" }),
            ticket({ id: 2, fixbydate: "2026-10-10T12:00:00.000Z" }),
        ];
        const { result } = renderHook(({ now }) => useSlaOverdueAlerts(tickets, now, true), {
            initialProps: { now: NOW },
        });
        expect(result.current).toEqual([]);
        expect(instances).toEqual([]);
    });

    it("notifies once per ticket on the transition into overdue", () => {
        stubNotifications();
        const breaching = ticket({ id: 2, fixbydate: "2026-10-03T12:30:00.000Z" });
        const tickets = [ticket({ id: 1, fixbydate: "2026-10-01T12:00:00.000Z" }), breaching];
        const { result, rerender } = renderHook(
            ({ now }) => useSlaOverdueAlerts(tickets, now, true),
            { initialProps: { now: NOW } },
        );
        expect(instances).toEqual([]);

        rerender({ now: LATER });
        expect(result.current.map((t) => t.id)).toEqual([2]);
        expect(instances).toHaveLength(1);
        expect(instances[0].title).toBe("Ticket #2 breached SLA");
        expect(instances[0].options?.body).toBe("Summary 2");
        expect(instances[0].options?.tag).toBe("sla-overdue-2");

        // Same state again: no repeat notification.
        rerender({ now: new Date(LATER) });
        expect(instances).toHaveLength(1);
    });

    it("tracks transitions without notifying when disabled or unsupported", () => {
        stubNotifications();
        const tickets = [ticket({ id: 3, fixbydate: "2026-10-03T12:30:00.000Z" })];
        const { result, rerender } = renderHook(
            ({ now }) => useSlaOverdueAlerts(tickets, now, false),
            { initialProps: { now: NOW } },
        );
        rerender({ now: LATER });
        expect(result.current.map((t) => t.id)).toEqual([3]);
        expect(instances).toEqual([]);

        // Notification API missing entirely: no crash, no notification.
        vi.unstubAllGlobals();
        const { result: unsupported, rerender: rerenderUnsupported } = renderHook(
            ({ now }) => useSlaOverdueAlerts(tickets, now, true),
            { initialProps: { now: NOW } },
        );
        rerenderUnsupported({ now: LATER });
        expect(unsupported.current.map((t) => t.id)).toEqual([3]);
        rerender({ now: NOW });
        expect(instances).toEqual([]);
    });

    it("does not notify when permission is not granted", () => {
        stubNotifications("denied");
        const tickets = [ticket({ id: 4, fixbydate: "2026-10-03T12:30:00.000Z" })];
        const { rerender } = renderHook(({ now }) => useSlaOverdueAlerts(tickets, now, true), {
            initialProps: { now: NOW },
        });
        rerender({ now: LATER });
        expect(instances).toEqual([]);
    });
});

describe("requestOverdueAlertPermission", () => {
    it("returns true when already granted without prompting", async () => {
        stubNotifications("granted");
        await expect(requestOverdueAlertPermission()).resolves.toBe(true);
        expect(MockNotification.requestPermission).not.toHaveBeenCalled();
    });

    it("returns false when denied without prompting, or when unsupported", async () => {
        stubNotifications("denied");
        await expect(requestOverdueAlertPermission()).resolves.toBe(false);
        expect(MockNotification.requestPermission).not.toHaveBeenCalled();

        vi.unstubAllGlobals();
        await expect(requestOverdueAlertPermission()).resolves.toBe(false);
    });

    it("prompts when permission is still default", async () => {
        stubNotifications("default");
        await expect(requestOverdueAlertPermission()).resolves.toBe(true);
        expect(MockNotification.requestPermission).toHaveBeenCalledOnce();
    });
});
