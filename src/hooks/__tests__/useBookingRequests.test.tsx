import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useBookingRequests } from "@/hooks/useBookingRequests";
import {
    BookingTrackerError,
    extendBookingRequest,
    fetchBookingRequests,
    type BookingRequestSummary,
} from "@/lib/book-api";
import { loadDispatcherSession } from "@/services/auth/authService";

vi.mock("@/lib/book-api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/book-api")>();
    return {
        ...actual,
        fetchBookingRequests: vi.fn(),
        extendBookingRequest: vi.fn(),
    };
});

vi.mock("@/services/auth/authService", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/services/auth/authService")>();
    return { ...actual, loadDispatcherSession: vi.fn() };
});

const fetchMock = vi.mocked(fetchBookingRequests);
const extendMock = vi.mocked(extendBookingRequest);
const sessionMock = vi.mocked(loadDispatcherSession);

function summary(overrides: Partial<BookingRequestSummary> = {}): BookingRequestSummary {
    return {
        rid: "rid-1",
        status: "pending",
        ticketId: 42,
        agentIds: [7],
        appointmentTypeId: 3,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        exp: 1_790_003_600,
        clickedAt: null,
        bookedAppointmentId: null,
        viewCount: 0,
        ...overrides,
    };
}

describe("useBookingRequests", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sessionMock.mockReturnValue({
            sessionId: "sess-1",
            expiresAt: "2026-11-02T00:00:00.000Z",
        });
    });

    it("reports loaded only after the first completed list load", async () => {
        fetchMock.mockResolvedValue([summary()]);
        const { result } = renderHook(() => useBookingRequests());
        expect(result.current.loaded).toBe(false);
        expect(result.current.requests).toEqual([]);

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.requests).toEqual([summary()]);
        expect(result.current.loading).toBe(false);
    });

    it("stays unloaded when the first load fails", async () => {
        fetchMock.mockRejectedValue(new BookingTrackerError("network-error", "down"));
        const { result } = renderHook(() => useBookingRequests());

        await waitFor(() => expect(result.current.error).not.toBeNull());
        expect(result.current.loaded).toBe(false);
        expect(result.current.requests).toEqual([]);
    });

    it("extend resolves the summary from the committed list", async () => {
        fetchMock.mockResolvedValue([summary()]);
        extendMock.mockResolvedValue({
            rid: "rid-1",
            token: "renewed-token",
            expiresAt: "2026-11-02T00:00:00.000Z",
        });
        const { result } = renderHook(() => useBookingRequests());
        await waitFor(() => expect(result.current.loaded).toBe(true));

        let outcome: unknown;
        await act(async () => {
            outcome = await result.current.extend("rid-1");
        });
        expect(outcome).toMatchObject({
            summary: {
                rid: "rid-1",
                exp: Math.floor(Date.parse("2026-11-02T00:00:00.000Z") / 1000),
            },
            token: "renewed-token",
            oldInvalidated: true,
        });
        expect(result.current.requests[0]).toMatchObject({
            rid: "rid-1",
            exp: Math.floor(Date.parse("2026-11-02T00:00:00.000Z") / 1000),
        });
        expect(extendMock).toHaveBeenCalledWith({ rid: "rid-1", sessionId: "sess-1" });
    });

    it("extend throws not-found when the row left the list", async () => {
        fetchMock.mockResolvedValue([summary()]);
        extendMock.mockResolvedValue({
            rid: "rid-1",
            token: "renewed-token",
            expiresAt: "2026-11-02T00:00:00.000Z",
        });
        const { result } = renderHook(() => useBookingRequests());
        await waitFor(() => expect(result.current.loaded).toBe(true));

        // The row disappears (resend replaced it); the committed mirror
        // observes the removal before extend runs.
        fetchMock.mockResolvedValue([]);
        await act(async () => {
            await result.current.refresh();
        });

        await expect(
            act(async () => {
                await result.current.extend("rid-1");
            }),
        ).rejects.toMatchObject({ code: "not-found" });
    });
});
