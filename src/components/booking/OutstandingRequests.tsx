import { useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import { Inbox, Loader2, RefreshCw, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookingStatusChip } from "@/components/booking/BookingStatusChip";
import { SendBookingLinkMenu } from "@/components/booking/SendBookingLinkMenu";
import { useBookingRequests, type BookingTracker } from "@/hooks/useBookingRequests";
import { isBookingOpen, type BookingRequestSummary } from "@/lib/book-api";
import { sendBookingLink, type BookingSendChannel } from "@/lib/send-booking-link";
import { useDispatchStore } from "@/stores/useDispatchStore";
import { useConfigStore } from "@/stores/configStore";
import { toast } from "sonner";

function agentLabel(summary: BookingRequestSummary, resolveName: (id: number) => string): string {
    if (summary.agentIds.length === 0) {
        return "Any agent";
    }
    const [first, ...rest] = summary.agentIds;
    const name = resolveName(first);
    return rest.length === 0 ? name : `${name} +${rest.length} more`;
}

function requestAge(createdAt: string): string {
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) {
        return "—";
    }
    return formatDistanceToNow(date, { addSuffix: true });
}

/**
 * Outstanding booking requests: every link the signed-in dispatcher minted,
 * open requests first. Terminal rows are actionless except resend-as-new on
 * expired; cancelling drops the row out of the open set.
 *
 * Shares the caller's tracker when given (one list fetch, one state) and
 * otherwise loads its own.
 */
export function OutstandingRequests({ tracker }: { tracker?: BookingTracker } = {}) {
    const fallback = useBookingRequests({ enabled: tracker === undefined });
    const booking = tracker ?? fallback;
    const { agents } = useDispatchStore();
    const { config } = useConfigStore();

    const rows = useMemo(() => {
        const open: BookingRequestSummary[] = [];
        const terminal: BookingRequestSummary[] = [];
        for (const row of booking.requests) {
            (isBookingOpen(row) ? open : terminal).push(row);
        }
        return [...open, ...terminal];
    }, [booking.requests]);

    const resolveName = (id: number): string =>
        agents.find((agent) => agent.id === id)?.name ?? `Agent ${id}`;

    const onResend = async (summary: BookingRequestSummary) => {
        try {
            const { token, oldInvalidated } = await booking.resend(summary);
            await navigator.clipboard.writeText(`${window.location.origin}/book/${token}`);
            toast.success("Fresh booking link copied to clipboard.");
            if (!oldInvalidated) {
                toast.warning("The old link is still live — cancel it from this queue.");
            }
        } catch {
            toast.error("Failed to resend booking link.");
        }
    };

    const onCancel = async (summary: BookingRequestSummary) => {
        try {
            await booking.cancel(summary.rid);
            toast.success(`Booking request for ticket ${summary.ticketId} cancelled.`);
        } catch {
            toast.error("Failed to cancel booking request.");
        }
    };

    const onSend = async (summary: BookingRequestSummary, channel: BookingSendChannel) => {
        try {
            const { oldInvalidated } = await sendBookingLink({
                ticketId: summary.ticketId,
                channel,
                origin: window.location.origin,
                mintFresh: () => booking.resend(summary),
                open: (href) => {
                    window.location.href = href;
                },
            });
            toast.success(
                channel === "sms"
                    ? "Opening text message with booking link…"
                    : "Opening email with booking link…",
            );
            if (!oldInvalidated) {
                toast.warning("The old link is still live — cancel it from this queue.");
            }
        } catch {
            toast.error("Failed to send booking link.");
        }
    };

    if (booking.loading) {
        return (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading booking requests…
            </div>
        );
    }

    if (booking.error) {
        return (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
                <p className="text-sm text-muted-foreground">{booking.error}</p>
                <Button variant="outline" size="sm" onClick={() => void booking.refresh()}>
                    <RefreshCw className="h-4 w-4 mr-2" aria-hidden />
                    Retry
                </Button>
            </div>
        );
    }

    if (rows.length === 0) {
        return (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Inbox className="h-8 w-8 text-muted-foreground" aria-hidden />
                <p className="text-sm text-muted-foreground">
                    No outstanding booking requests. Mint one from any ticket row.
                </p>
            </div>
        );
    }

    const openCount = rows.filter((row) => isBookingOpen(row)).length;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
                <p className="text-sm text-muted-foreground" aria-live="polite">
                    {openCount} open{rows.length !== openCount && ` · ${rows.length} total`}
                </p>
                <div className="ml-auto">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void booking.refresh()}
                        title="Refresh booking requests"
                        aria-label="Refresh booking requests"
                    >
                        <RefreshCw className="h-4 w-4" aria-hidden />
                    </Button>
                </div>
            </div>
            <div className="overflow-auto rounded-md border">
                <table className="w-full text-sm border-collapse">
                    <thead className="bg-muted/50 border-b">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium text-xs">Ticket</th>
                            <th className="px-3 py-2 text-left font-medium text-xs">Agent</th>
                            <th className="px-3 py-2 text-left font-medium text-xs">Age</th>
                            <th className="px-3 py-2 text-left font-medium text-xs">Status</th>
                            <th className="px-3 py-2 text-right font-medium text-xs">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => {
                            const open = isBookingOpen(row);
                            const resendable = open || row.status === "expired";
                            const busy = booking.busyRid === row.rid;
                            return (
                                <tr
                                    key={row.rid}
                                    className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                                >
                                    <td className="px-3 py-2 whitespace-nowrap">
                                        {config.resourceServer ? (
                                            <a
                                                href={`${config.resourceServer}/tickets?id=${row.ticketId}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-primary hover:underline font-medium"
                                            >
                                                #{row.ticketId}
                                            </a>
                                        ) : (
                                            <span className="font-medium">#{row.ticketId}</span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-xs max-w-40 truncate">
                                        {agentLabel(row, resolveName)}
                                    </td>
                                    <td
                                        className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap"
                                        title={row.createdAt}
                                    >
                                        {requestAge(row.createdAt)}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap">
                                        <BookingStatusChip
                                            summary={row}
                                            testId={`booking-queue-status-${row.ticketId}`}
                                        />
                                    </td>
                                    <td className="px-3 py-2 text-right whitespace-nowrap">
                                        {open || resendable ? (
                                            <div className="flex items-center justify-end gap-1">
                                                {resendable && (
                                                    <SendBookingLinkMenu
                                                        ticketId={row.ticketId}
                                                        disabled={busy}
                                                        onSelect={(channel) =>
                                                            void onSend(row, channel)
                                                        }
                                                    />
                                                )}
                                                {resendable && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => void onResend(row)}
                                                        disabled={busy}
                                                        title="Resend booking link (invalidates the old one)"
                                                        aria-label={`Resend booking link for ticket ${row.ticketId}`}
                                                    >
                                                        <Send className="h-4 w-4" aria-hidden />
                                                    </Button>
                                                )}
                                                {open && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => void onCancel(row)}
                                                        disabled={busy}
                                                        title="Cancel booking request"
                                                        aria-label={`Cancel booking request for ticket ${row.ticketId}`}
                                                    >
                                                        <X className="h-4 w-4" aria-hidden />
                                                    </Button>
                                                )}
                                            </div>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">—</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
