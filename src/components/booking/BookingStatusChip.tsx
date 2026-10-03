import { Badge } from "@/components/ui/badge";
import {
    bookingDisplayStatus,
    type BookingDisplayStatus,
    type BookingRequestSummary,
} from "@/lib/book-api";
import { cn } from "@/lib/utils";

const LABELS: Record<BookingDisplayStatus, string> = {
    sent: "sent",
    clicked: "clicked",
    booked: "booked",
    expired: "expired",
    canceled: "canceled",
};

function formatWhen(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** One-line plain-language detail for the chip tooltip. */
function describe(summary: BookingRequestSummary, display: BookingDisplayStatus): string {
    switch (display) {
        case "sent":
            return `Booking link sent ${formatWhen(summary.createdAt)} — awaiting first view.`;
        case "clicked":
            return `Booking link viewed ${formatWhen(summary.clickedAt ?? summary.updatedAt)} — awaiting booking.`;
        case "booked":
            return `Booked — appointment #${summary.bookedAppointmentId ?? "?"}.`;
        case "expired":
            return `Booking link expired ${formatWhen(new Date(summary.exp * 1000).toISOString())}. Resend mints a fresh link.`;
        case "canceled":
            return `Booking request cancelled ${formatWhen(summary.updatedAt)}.`;
    }
}

interface BookingStatusChipProps {
    summary: BookingRequestSummary;
    /** Override for wall-clock-dependent display (tests); defaults to now. */
    now?: Date;
    testId?: string;
}

/**
 * Subtle per-ticket booking state: an outline badge plus a tooltip. No layout
 * weight beyond the badge itself — safe inside table action cells.
 */
export function BookingStatusChip({ summary, now, testId }: BookingStatusChipProps) {
    const display = bookingDisplayStatus(summary, now?.getTime());
    return (
        <Badge
            variant={display === "booked" ? "secondary" : "outline"}
            className={cn(
                "text-xs font-normal whitespace-nowrap",
                (display === "expired" || display === "canceled") && "text-muted-foreground",
            )}
            title={describe(summary, display)}
            data-testid={testId}
        >
            {LABELS[display]}
        </Badge>
    );
}
