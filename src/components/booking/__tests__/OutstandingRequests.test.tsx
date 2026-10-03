import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OutstandingRequests } from "../OutstandingRequests";
import type { BookingTracker } from "@/hooks/useBookingRequests";
import type { BookingAuditTrail, BookingRequestSummary } from "@/lib/book-api";

function summary(overrides: Partial<BookingRequestSummary> = {}): BookingRequestSummary {
    return {
        rid: "rid-1",
        status: "pending",
        ticketId: 42,
        agentIds: [1],
        appointmentTypeId: 3,
        createdAt: new Date(Date.now() - 3600_000).toISOString(),
        updatedAt: new Date(Date.now() - 3600_000).toISOString(),
        exp: Math.floor(Date.now() / 1000) + 3600,
        clickedAt: "2026-10-03T10:00:00.000Z",
        bookedAppointmentId: null,
        viewCount: 2,
        ...overrides,
    };
}

function tracker(overrides: Partial<BookingTracker> = {}): BookingTracker {
    return {
        requests: [summary()],
        byTicket: new Map([[42, summary()]]),
        loading: false,
        error: null,
        busyRid: null,
        loaded: true,
        refresh: vi.fn(async () => undefined),
        cancel: vi.fn(async (rid: string) => summary({ rid })),
        resend: vi.fn(async (previous: BookingRequestSummary) => ({
            summary: previous,
            token: "tok",
            oldInvalidated: true,
        })),
        extend: vi.fn(async (rid: string) => ({
            summary: summary({ rid }),
            token: "tok-renewed",
            oldInvalidated: true,
        })),
        fetchAudit: vi.fn(async (rid: string): Promise<BookingAuditTrail> => ({
            rid,
            viewCount: 2,
            events: [
                { type: "view", at: "2026-10-03T10:00:00.000Z", detail: null },
                { type: "view", at: "2026-10-03T11:00:00.000Z", detail: null },
                {
                    type: "extend",
                    at: "2026-10-03T12:00:00.000Z",
                    detail: "2026-10-20T00:00:00.000Z",
                },
            ],
        })),
        ...overrides,
    };
}

describe("OutstandingRequests link lifecycle", () => {
    it("shows the view count and an extend action for open requests", () => {
        render(<OutstandingRequests tracker={tracker()} />);
        expect(screen.getByText("Views")).toBeInTheDocument();
        const viewsCell = screen.getByTitle("2 validated customer views");
        expect(viewsCell).toHaveTextContent("2");
        expect(screen.getByLabelText("Extend booking link for ticket 42")).toBeInTheDocument();
    });

    it("extends and copies the renewed link", async () => {
        const user = userEvent.setup();
        const booking = tracker();
        const writeText = vi.fn(async () => undefined);
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

        render(<OutstandingRequests tracker={booking} />);
        await user.click(screen.getByLabelText("Extend booking link for ticket 42"));

        await waitFor(() => expect(booking.extend).toHaveBeenCalledWith("rid-1"));
        expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/book/tok-renewed`);
    });

    it("expands a row to list the audit trail", async () => {
        const user = userEvent.setup();
        const booking = tracker();
        render(<OutstandingRequests tracker={booking} />);

        expect(screen.queryByText("No link activity yet.")).not.toBeInTheDocument();
        await user.click(screen.getByLabelText("Show link activity for ticket 42"));

        await waitFor(() => expect(booking.fetchAudit).toHaveBeenCalledWith("rid-1"));
        expect(await screen.findAllByText("Viewed")).toHaveLength(2);
        expect(screen.getByText("Extended")).toBeInTheDocument();
        expect(screen.getByText("new expiry 2026-10-20T00:00:00.000Z")).toBeInTheDocument();

        // Collapsing hides the trail without refetching.
        await user.click(screen.getByLabelText("Show link activity for ticket 42"));
        expect(screen.queryByText("Extended")).not.toBeInTheDocument();
        expect(booking.fetchAudit).toHaveBeenCalledTimes(1);
    });

    it("reports audit load failures inline", async () => {
        const user = userEvent.setup();
        const booking = tracker({
            fetchAudit: vi.fn(async () => {
                throw new Error("boom");
            }),
        });
        render(<OutstandingRequests tracker={booking} />);
        await user.click(screen.getByLabelText("Show link activity for ticket 42"));
        expect(await screen.findByText("Could not load link activity.")).toBeInTheDocument();
    });
});
