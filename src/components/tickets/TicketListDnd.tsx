import { useState, useMemo, useEffect, useRef } from "react";
import { format } from "date-fns";
import {
    AlertTriangle,
    ArrowDown,
    ArrowUp,
    Clock,
    Inbox,
    Link2,
    Loader2,
    Pause,
    RotateCcw,
    Search,
    Send,
    X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useDispatchStore } from "@/stores/useDispatchStore";
import { useConfigStore } from "@/stores/configStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { Pagination } from "@/components/tickets/Pagination";
import { RefreshButton } from "@/components/tickets/RefreshButton";
import { useDraggableTicket } from "@/hooks/useDraggableTicket";
import { useNow } from "@/hooks/useNow";
import { useRowWindowing } from "@/hooks/useRowWindowing";
import { AgentAvatar } from "@/components/AgentAvatar";
import { cn } from "@/lib/utils";
import { computeSla } from "@/utils/enrich-ticket";
import { scoreBreakdown, scoreTicket } from "@/lib/priority-score";
import { sortBreachingNext } from "@/lib/sla-escalation";
import { requestOverdueAlertPermission, useSlaOverdueAlerts } from "@/hooks/useSlaOverdueAlerts";
import {
    BookingTrackerError,
    bookingDisplayStatus,
    isBookingOpen,
    mintBookingRequest,
    type BookingRequestSummary,
} from "@/lib/book-api";
import { useBookingRequests } from "@/hooks/useBookingRequests";
import { BookingStatusChip } from "@/components/booking/BookingStatusChip";
import { OutstandingRequests } from "@/components/booking/OutstandingRequests";
import type { EnrichedTicket } from "@/types/halo";
import type { Ticket } from "@/types";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { toast } from "sonner";
import { loadTokens } from "@/services/auth/authService";
import type { ColumnConfig } from "@/stores/preferencesStore";

interface DragInput {
    event?: { target?: EventTarget | null };
}

interface SortableHeaderProps {
    column: ColumnConfig;
    onReorder: (draggedId: string, targetId: string) => void;
    onResize: (columnId: string, width: number) => void;
    sortable?: boolean;
    sortDirection?: "asc" | "desc" | null;
    onSort?: (columnId: string) => void;
}

interface DraggableTicketRowProps {
    ticket: EnrichedTicket;
    visibleColumns: ColumnConfig[];
    now: Date;
    renderCell: (column: ColumnConfig, ticket: EnrichedTicket) => React.ReactNode;
    booking?: BookingRequestSummary;
    bookingBusy: boolean;
    onBookingResend: (summary: BookingRequestSummary) => void;
    onBookingCancel: (summary: BookingRequestSummary) => void;
    onBookingMinted: () => void;
}

function DraggableTicketRow({
    ticket,
    visibleColumns,
    now,
    renderCell,
    booking,
    bookingBusy,
    onBookingResend,
    onBookingCancel,
    onBookingMinted,
}: DraggableTicketRowProps) {
    // Convert EnrichedTicket to Ticket format for drag and drop
    const dragTicket: Ticket = {
        id: ticket.id.toString(),
        ticketNumber: ticket.id.toString(),
        title: ticket.summary,
        description: ticket.details || "",
        status: "new",
        priority: "medium",
        customerName: ticket.user_name || "",
        customerEmail: "",
        siteName: ticket.site_name || "",
        category: ticket.category_1 || "",
        tags: [],
        createdAt: new Date(ticket.dateoccurred),
        updatedAt: new Date(ticket.last_update),
        estimatedDuration: 30,
    };

    const dragRef = useDraggableTicket(dragTicket);
    const { slaState } = computeSla(ticket.fixbydate, ticket.excludefromsla, ticket.onhold, now);

    return (
        <tr
            ref={dragRef}
            key={`${ticket._listId}-${ticket.id}`}
            data-sla-state={slaState}
            className={cn(
                "border-b hover:bg-muted/30 transition-colors cursor-grab active:cursor-grabbing select-none",
                slaState === "overdue" && "bg-red-500/10 hover:bg-red-500/15",
                slaState === "warning" && "bg-amber-500/10 hover:bg-amber-500/15",
            )}
        >
            {visibleColumns.map((column) => (
                <td
                    key={column.id}
                    className="px-3 py-2 overflow-hidden text-ellipsis whitespace-nowrap"
                    style={
                        column.width
                            ? {
                                  width: `${column.width}px`,
                                  minWidth: `${column.width}px`,
                                  maxWidth: `${column.width}px`,
                              }
                            : undefined
                    }
                >
                    {renderCell(column, ticket)}
                </td>
            ))}
            <td className="px-3 py-2 text-right whitespace-nowrap">
                <BookingCell
                    ticket={ticket}
                    summary={booking}
                    busy={bookingBusy}
                    onResend={onBookingResend}
                    onCancel={onBookingCancel}
                    onMinted={onBookingMinted}
                />
            </td>
        </tr>
    );
}

function SortableHeader({
    column,
    onReorder,
    onResize,
    sortable = false,
    sortDirection = null,
    onSort,
}: SortableHeaderProps) {
    const headerRef = useRef<HTMLTableCellElement>(null);
    const resizeHandleRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isDraggedOver, setIsDraggedOver] = useState(false);
    const [isResizing, setIsResizing] = useState(false);

    // Column reordering
    useEffect(() => {
        const headerElement = headerRef.current;
        if (!headerElement || column.isFixed) return;

        const cleanupDraggable = draggable({
            element: headerElement,
            getInitialData: () => ({
                type: "column-header",
                columnId: column.id,
                columnLabel: column.label,
            }),
            canDrag: ({ input }) => {
                // Don't start drag if clicking on resize handle
                const dragInput = input as DragInput;
                const target = dragInput.event?.target as HTMLElement;
                return !target?.closest("[data-resize-handle]");
            },
            onDragStart: () => {
                setIsDragging(true);
                if (headerElement) {
                    headerElement.style.opacity = "0.4";
                }
            },
            onDrop: () => {
                setIsDragging(false);
                if (headerElement) {
                    headerElement.style.opacity = "1";
                }
            },
        });

        const cleanupDropTarget = dropTargetForElements({
            element: headerElement,
            canDrop: ({ source }) => {
                const data = source.data as { type: string; columnId: string };
                return data.type === "column-header" && data.columnId !== column.id;
            },
            getData: () => ({ columnId: column.id }),
            onDragEnter: () => setIsDraggedOver(true),
            onDragLeave: () => setIsDraggedOver(false),
            onDrop: ({ source }) => {
                setIsDraggedOver(false);
                const data = source.data as { type: string; columnId: string };
                if (data.type === "column-header") {
                    onReorder(data.columnId, column.id);
                }
            },
        });

        return () => {
            cleanupDraggable();
            cleanupDropTarget();
        };
    }, [column.id, column.isFixed, column.label, onReorder]);

    // Column resizing
    useEffect(() => {
        const resizeHandle = resizeHandleRef.current;
        const headerElement = headerRef.current;
        if (!resizeHandle || !headerElement) return;

        let startX = 0;
        let startWidth = 0;

        const handleMouseDown = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setIsResizing(true);
            startX = e.clientX;
            startWidth = headerElement.offsetWidth;

            const handleMouseMove = (e: MouseEvent) => {
                const diff = e.clientX - startX;
                const newWidth = Math.max(30, startWidth + diff); // Minimum 30px
                onResize(column.id, newWidth);
            };

            const handleMouseUp = () => {
                setIsResizing(false);
                document.removeEventListener("mousemove", handleMouseMove);
                document.removeEventListener("mouseup", handleMouseUp);
            };

            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
        };

        resizeHandle.addEventListener("mousedown", handleMouseDown);

        return () => {
            resizeHandle.removeEventListener("mousedown", handleMouseDown);
        };
    }, [column.id, onResize]);

    return (
        <th
            ref={headerRef}
            style={{
                width: column.width ? `${column.width}px` : undefined,
                minWidth: column.width ? `${column.width}px` : undefined,
                maxWidth: column.width ? `${column.width}px` : undefined,
            }}
            className={cn(
                "relative px-3 py-2 text-left font-medium text-xs whitespace-nowrap bg-muted/50",
                isDraggedOver && "bg-primary/20 border-l-2 border-r-2 border-primary",
                column.isFixed && "bg-muted/70",
                !column.isFixed && "cursor-grab active:cursor-grabbing",
                sortable && "cursor-pointer select-none",
            )}
            onClick={sortable ? () => onSort?.(column.id) : undefined}
            onKeyDown={
                sortable
                    ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onSort?.(column.id);
                          }
                      }
                    : undefined
            }
            tabIndex={sortable ? 0 : undefined}
            aria-sort={
                sortable
                    ? sortDirection === "asc"
                        ? "ascending"
                        : sortDirection === "desc"
                          ? "descending"
                          : "none"
                    : undefined
            }
            title={sortable ? "Click to sort by dispatch score" : undefined}
        >
            <div className="flex items-center gap-1">
                <span className={cn(isDragging && "opacity-50")}>{column.label}</span>
                {sortable && sortDirection === "desc" && (
                    <ArrowDown className="h-3 w-3 flex-shrink-0" aria-hidden />
                )}
                {sortable && sortDirection === "asc" && (
                    <ArrowUp className="h-3 w-3 flex-shrink-0" aria-hidden />
                )}
            </div>

            {/* Resize Handle */}
            <div
                ref={resizeHandleRef}
                data-resize-handle
                className={cn(
                    "absolute right-0 top-0 bottom-0 w-2 -mr-1 cursor-col-resize z-10",
                    "hover:bg-primary/50 active:bg-primary transition-colors",
                    isResizing && "bg-primary",
                )}
                title="Drag to resize"
            />
        </th>
    );
}

function getSlaColorClass(slaState: EnrichedTicket["slaState"]) {
    switch (slaState) {
        case "overdue":
            return "text-red-600 font-semibold";
        case "warning":
            return "text-yellow-600 font-semibold";
        case "onhold":
            return "text-blue-600";
        default:
            return "text-green-600";
    }
}

/**
 * SLA cell that stays live: recomputed from the ticket's fix-by date against
 * the ticking clock instead of the frozen fetch-time string. State is cued by
 * icon + text, never color alone, with the exact fix-by time on hover.
 */
function SlaCell({ ticket, now }: { ticket: EnrichedTicket; now: Date }) {
    const { slaTimeLeft, slaState } = computeSla(
        ticket.fixbydate,
        ticket.excludefromsla,
        ticket.onhold,
        now,
    );
    const exactTime =
        ticket.fixbydate && !ticket.fixbydate.startsWith("1899-12-30")
            ? format(new Date(ticket.fixbydate), "MMM d, yyyy h:mm a")
            : undefined;

    return (
        <span
            className={cn("text-xs inline-flex items-center gap-1", getSlaColorClass(slaState))}
            title={exactTime ? `Fix by ${exactTime}` : undefined}
        >
            {slaState === "overdue" && (
                <AlertTriangle className="h-3 w-3 flex-shrink-0" aria-hidden />
            )}
            {slaState === "warning" && <Clock className="h-3 w-3 flex-shrink-0" aria-hidden />}
            {slaState === "onhold" && <Pause className="h-3 w-3 flex-shrink-0" aria-hidden />}
            {slaTimeLeft}
        </span>
    );
}

const PAGE_SIZE_OPTIONS = [25, 50, 100];

/** Column id whose header click sorts by dispatch priority score. */
const SCORE_SORT_COLUMN_ID = "priority";

interface SortState {
    columnId: string;
    direction: "asc" | "desc";
}

/**
 * Halo priority chip plus the client-side dispatch score badge. The badge
 * title carries the score breakdown (SLA / age / staleness / priority).
 */
function PriorityCell({ ticket, now }: { ticket: EnrichedTicket; now: Date }) {
    const breakdown = scoreBreakdown(ticket, now);
    const title =
        `Dispatch score ${breakdown.total}/100 — ` +
        `SLA ${Math.round(breakdown.sla)}, age ${Math.round(breakdown.age)}, ` +
        `staleness ${Math.round(breakdown.staleness)}, ` +
        `priority ${Math.round(breakdown.priorityBoost)}`;

    return (
        <div className="flex items-center gap-1.5 whitespace-nowrap">
            {ticket.priority ? (
                <>
                    <div
                        className="w-3 h-3 rounded-sm border flex-shrink-0"
                        style={{ backgroundColor: ticket.priority.colour || "#cccccc" }}
                        title={ticket.priority.name}
                    />
                    <span className="text-xs">{ticket.priority.name}</span>
                </>
            ) : (
                <span className="text-xs text-muted-foreground">No priority</span>
            )}
            <Badge variant="secondary" className="text-xs tabular-nums" title={title}>
                {breakdown.total}
            </Badge>
        </div>
    );
}

/**
 * Per-row booking-link action: mints a link via the Worker BFF and copies the
 * absolute `/book/<token>` URL. Uses the ticket's assigned agent when set,
 * else every active agent; appointment type defaults to the first loaded.
 */
function BookingLinkButton({ ticket, onMinted }: { ticket: EnrichedTicket; onMinted: () => void }) {
    const { agents, appointmentTypes } = useDispatchStore();
    const [busy, setBusy] = useState(false);

    const copyLink = async () => {
        const tokens = loadTokens();
        if (!tokens?.access_token || !tokens?.refresh_token) {
            toast.error("Sign in to Halo before creating a booking link.");
            return;
        }
        const agentIds =
            ticket.agent_id > 0
                ? [ticket.agent_id]
                : agents.filter((agent) => agent.isActive).map((agent) => agent.id);
        if (agentIds.length === 0) {
            toast.error("No agents available for this booking link.");
            return;
        }
        const appointmentTypeId = appointmentTypes[0]?.id;
        if (!appointmentTypeId) {
            toast.error("No appointment types loaded.");
            return;
        }
        setBusy(true);
        try {
            const { token } = await mintBookingRequest({
                ticketId: ticket.id,
                agentIds,
                appointmentTypeId,
                haloTokenPair: tokens,
            });
            await navigator.clipboard.writeText(`${window.location.origin}/book/${token}`);
            toast.success("Booking link copied to clipboard.");
            onMinted();
        } catch (error) {
            toast.error(
                error instanceof BookingTrackerError
                    ? error.message
                    : "Failed to create booking link.",
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <Button
            variant="ghost"
            size="icon"
            onClick={copyLink}
            disabled={busy}
            title="Copy booking link"
            aria-label={`Copy booking link for ticket ${ticket.id}`}
        >
            {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
                <Link2 className="h-4 w-4" aria-hidden />
            )}
        </Button>
    );
}

interface BookingCellProps {
    ticket: EnrichedTicket;
    summary?: BookingRequestSummary;
    busy: boolean;
    onResend: (summary: BookingRequestSummary) => void;
    onCancel: (summary: BookingRequestSummary) => void;
    onMinted: () => void;
}

/**
 * Actions cell: the tracking chip (when this ticket has a request) plus
 * resend/cancel. Cancel is open-only; resend also covers expired
 * (resend-as-new). Booked/cancelled rows show the chip alone.
 */
function BookingCell({ ticket, summary, busy, onResend, onCancel, onMinted }: BookingCellProps) {
    const display = summary ? bookingDisplayStatus(summary) : null;
    const canCancel = summary && display !== null && isBookingOpen(summary);
    const canResend = summary && (isBookingOpen(summary) || display === "expired");

    return (
        <div className="flex items-center justify-end gap-1">
            {summary && (
                <BookingStatusChip summary={summary} testId={`booking-status-${ticket.id}`} />
            )}
            {canResend && (
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onResend(summary)}
                    disabled={busy}
                    title="Resend booking link (invalidates the old one)"
                    aria-label={`Resend booking link for ticket ${ticket.id}`}
                >
                    <Send className="h-4 w-4" aria-hidden />
                </Button>
            )}
            {canCancel && (
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onCancel(summary)}
                    disabled={busy}
                    title="Cancel booking request"
                    aria-label={`Cancel booking request for ticket ${ticket.id}`}
                >
                    <X className="h-4 w-4" aria-hidden />
                </Button>
            )}
            <BookingLinkButton ticket={ticket} onMinted={onMinted} />
        </div>
    );
}

/**
 * TicketList Component with Drag-and-Drop Column Reordering
 */
export function TicketList() {
    const {
        haloTickets,
        selectedListIds,
        ticketsLoading,
        ticketsRefreshing,
        ticketsError,
        selectedTicketAreaId,
        currentPage,
        pageSize,
        totalRecords,
        setPage,
        setPageSize,
        agents,
    } = useDispatchStore();

    const { config } = useConfigStore();
    const { ticketListColumns, setTicketListColumns, setColumnWidth, resetColumns } =
        usePreferencesStore();
    const [searchTerm, setSearchTerm] = useState("");
    const [sort, setSort] = useState<SortState | null>(null);
    const [queueOpen, setQueueOpen] = useState(false);
    const [breachingNext, setBreachingNext] = useState(false);
    const [alertsEnabled, setAlertsEnabled] = useState(() => {
        try {
            return localStorage.getItem("halo.slaOverdueAlerts") === "1";
        } catch {
            return false;
        }
    });
    // Single ticking clock shared by every SLA cell (re-renders once a minute).
    const now = useNow(60_000);
    // Opt-in browser notification when a loaded ticket newly breaches SLA.
    useSlaOverdueAlerts(haloTickets, now, alertsEnabled);
    // Dispatcher tracking: latest booking request per ticket (chips) plus the
    // open count for the queue button. Loads silently; list failure only
    // surfaces inside the queue dialog, never over the ticket table.
    const booking = useBookingRequests();
    const openBookingCount = useMemo(
        () => booking.requests.filter((row) => isBookingOpen(row)).length,
        [booking.requests],
    );

    const handleBookingResend = async (summary: BookingRequestSummary) => {
        try {
            const { token, oldInvalidated } = await booking.resend(summary);
            await navigator.clipboard.writeText(`${window.location.origin}/book/${token}`);
            toast.success("Fresh booking link copied to clipboard.");
            if (!oldInvalidated) {
                toast.warning("The old link is still live — cancel it from the queue.");
            }
        } catch {
            toast.error("Failed to resend booking link.");
        }
    };

    const handleBookingCancel = async (summary: BookingRequestSummary) => {
        try {
            await booking.cancel(summary.rid);
            toast.success(`Booking request for ticket ${summary.ticketId} cancelled.`);
        } catch {
            toast.error("Failed to cancel booking request.");
        }
    };

    // Show list column only if multiple lists are selected
    const showListColumn = selectedListIds.length > 1;

    // Get visible columns
    const visibleColumns = useMemo(() => {
        const columns = ticketListColumns.filter((col) => col.isVisible);
        // Only show list column if multiple lists selected
        if (!showListColumn) {
            return columns.filter((col) => col.id !== "list");
        }
        return columns;
    }, [ticketListColumns, showListColumn]);

    // Filter tickets based on search term
    const filteredTickets = useMemo(() => {
        if (!searchTerm.trim()) return haloTickets;

        const lowerSearch = searchTerm.toLowerCase();
        return haloTickets.filter((ticket) => {
            return (
                ticket.id.toString().includes(lowerSearch) ||
                ticket.summary.toLowerCase().includes(lowerSearch) ||
                ticket.clientSiteUser.toLowerCase().includes(lowerSearch) ||
                ticket.statusName.toLowerCase().includes(lowerSearch) ||
                ticket.agentName.toLowerCase().includes(lowerSearch) ||
                ticket.team?.toLowerCase().includes(lowerSearch) ||
                ticket.ticketTypeName?.toLowerCase().includes(lowerSearch) ||
                ticket.category_1?.toLowerCase().includes(lowerSearch) ||
                ticket.reportedby?.toLowerCase().includes(lowerSearch)
            );
        });
    }, [haloTickets, searchTerm]);

    // "Breaching next" lane takes precedence over header sorting: SLA band
    // first, then dispatch score. Otherwise sort by dispatch priority score
    // when the Priority header was clicked (id tiebreak keeps it deterministic).
    const sortedTickets = useMemo(() => {
        if (breachingNext) return sortBreachingNext(filteredTickets, now);
        if (sort?.columnId !== SCORE_SORT_COLUMN_ID) return filteredTickets;
        const factor = sort.direction === "desc" ? -1 : 1;
        return [...filteredTickets].sort((a, b) => {
            const diff = scoreTicket(a, now) - scoreTicket(b, now);
            return diff !== 0 ? diff * factor : a.id - b.id;
        });
    }, [filteredTickets, breachingNext, sort, now]);

    // Calculate total pages
    const totalPages = Math.ceil(totalRecords / pageSize);

    // Chunked rendering for long pages: first rows mount fast, the rest stream
    // in as the sentinel scrolls into view. Resets on page/search/list/sort change
    // but deliberately NOT on background refresh (preserves scroll position).
    const {
        visibleCount,
        sentinelRef,
        reset: resetWindowing,
    } = useRowWindowing(sortedTickets.length);
    useEffect(() => {
        resetWindowing();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage, searchTerm, selectedListIds, sort, breachingNext]);
    const visibleTickets = sortedTickets.slice(0, visibleCount);

    // Opt-in overdue alerts: enabling requests browser-notification
    // permission first and only sticks when permission is granted.
    const handleAlertsToggle = async () => {
        if (alertsEnabled) {
            setAlertsEnabled(false);
            try {
                localStorage.setItem("halo.slaOverdueAlerts", "0");
            } catch {
                /* storage unavailable — preference just won't persist */
            }
            return;
        }
        const granted = await requestOverdueAlertPermission();
        if (granted) {
            setAlertsEnabled(true);
            try {
                localStorage.setItem("halo.slaOverdueAlerts", "1");
            } catch {
                /* storage unavailable — preference just won't persist */
            }
        } else {
            toast.warning("Browser notifications are blocked — overdue alerts stay off.");
        }
    };

    // Header-click sort: first click sorts highest score first, then toggles.
    const handleSort = (columnId: string) => {
        setSort((prev) =>
            prev?.columnId === columnId
                ? { columnId, direction: prev.direction === "desc" ? "asc" : "desc" }
                : { columnId, direction: "desc" },
        );
    };

    // Calculate table width based on whether columns have custom widths
    const tableStyle = useMemo(() => {
        const hasCustomWidths = visibleColumns.some((col) => col.width);
        if (hasCustomWidths) {
            // If any columns have custom widths, use max-content to allow expansion
            return { width: "max-content", minWidth: "100%" };
        }
        // Otherwise, fill container width
        return undefined;
    }, [visibleColumns]);

    // Handle column reordering
    const handleReorder = (draggedId: string, targetId: string) => {
        const draggedIndex = ticketListColumns.findIndex((col) => col.id === draggedId);
        const targetIndex = ticketListColumns.findIndex((col) => col.id === targetId);

        // Don't allow reordering if either column is fixed or trying to move to/from index 0
        if (
            ticketListColumns[draggedIndex]?.isFixed ||
            ticketListColumns[targetIndex]?.isFixed ||
            targetIndex === 0 ||
            draggedIndex === 0
        ) {
            return;
        }

        // Reorder the columns array
        const newColumns = [...ticketListColumns];
        const [removed] = newColumns.splice(draggedIndex, 1);
        newColumns.splice(targetIndex, 0, removed);
        setTicketListColumns(newColumns);
    };

    // Render cell content based on column ID
    const renderCell = (column: ColumnConfig, ticket: EnrichedTicket) => {
        switch (column.id) {
            case "list":
                return (
                    <Badge variant="outline" className="text-xs whitespace-nowrap">
                        {ticket._listName}
                    </Badge>
                );

            case "id":
                return (
                    <a
                        href={`${config.resourceServer}/tickets?id=${ticket.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline font-medium"
                    >
                        {ticket.id}
                    </a>
                );

            case "clientSiteUser":
                return <span className="text-xs">{ticket.clientSiteUser}</span>;

            case "status":
                return (
                    <Badge
                        variant="outline"
                        style={{ borderColor: ticket.statusColour, color: ticket.statusColour }}
                        className="text-xs whitespace-nowrap"
                    >
                        {ticket.statusName}
                    </Badge>
                );

            case "slaTimeLeft":
                return <SlaCell ticket={ticket} now={now} />;

            case "priority":
                return <PriorityCell ticket={ticket} now={now} />;

            case "team":
                return <span className="text-xs">{ticket.team}</span>;

            case "agent": {
                const agent = agents.find((a) => a.id === ticket.agent_id);
                return agent ? (
                    <AgentAvatar
                        agent={agent}
                        size="sm"
                        showName
                        resourceServer={config.resourceServer}
                    />
                ) : (
                    <span className="text-xs text-muted-foreground">
                        {ticket.agentName || "Unassigned"}
                    </span>
                );
            }

            case "summary":
                return <span className="text-sm">{ticket.summary}</span>;

            case "dateReported":
                return (
                    <span className="text-xs text-muted-foreground">
                        {format(new Date(ticket.dateoccurred), "MMM d, yyyy")}
                    </span>
                );

            case "lastAction":
                return (
                    <span className="text-xs text-muted-foreground">
                        {format(new Date(ticket.lastactiondate), "MMM d, yyyy")}
                    </span>
                );

            case "type":
                return <span className="text-xs">{ticket.ticketTypeName}</span>;

            case "timeTaken":
                return (
                    <span className="text-xs text-center">
                        {ticket.timetaken ? `${ticket.timetaken.toFixed(2)}h` : "-"}
                    </span>
                );

            case "serviceCategory":
                return <span className="text-xs">{ticket.category_1}</span>;

            case "createdBy":
                return <span className="text-xs">{ticket.reportedby}</span>;

            default:
                return null;
        }
    };

    return (
        <div className="h-full flex flex-col bg-card">
            {/* Tickets Table */}
            <div className="flex-1 flex flex-col min-h-0">
                {/* Header with search bar and refresh controls */}
                {selectedListIds.length > 0 && (
                    <div className="p-3 border-b bg-muted/30 flex-shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="relative flex-1 max-w-md">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    id="ticket-search-input"
                                    type="text"
                                    placeholder="Search this page…"
                                    title="Search filters the tickets loaded on this page only"
                                    aria-label="Search tickets on this page"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-9"
                                />
                            </div>
                            <span className="text-sm font-medium text-muted-foreground">
                                {totalRecords} {totalRecords === 1 ? "Ticket" : "Tickets"}
                            </span>
                            <Select
                                value={String(pageSize)}
                                onValueChange={(value) => setPageSize(Number(value))}
                            >
                                <SelectTrigger
                                    className="w-[110px] h-9"
                                    aria-label="Tickets per page"
                                    title="Tickets per page"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {PAGE_SIZE_OPTIONS.map((size) => (
                                        <SelectItem key={size} value={String(size)}>
                                            {size} / page
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={resetColumns}
                                title="Reset column widths and order"
                            >
                                <RotateCcw className="h-4 w-4 mr-2" />
                                Reset Columns
                            </Button>
                            <Button
                                variant={breachingNext ? "default" : "outline"}
                                size="sm"
                                onClick={() => setBreachingNext((v) => !v)}
                                title="Order tickets by SLA breach risk: overdue, then warning, then the rest by dispatch score"
                                aria-pressed={breachingNext}
                            >
                                <AlertTriangle className="h-4 w-4 mr-2" aria-hidden />
                                Breaching next
                            </Button>
                            <Button
                                variant={alertsEnabled ? "default" : "outline"}
                                size="sm"
                                onClick={() => void handleAlertsToggle()}
                                title="Notify me in the browser when a loaded ticket newly breaches SLA"
                                aria-pressed={alertsEnabled}
                            >
                                <Clock className="h-4 w-4 mr-2" aria-hidden />
                                Overdue alerts
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setQueueOpen(true)}
                                title="Outstanding booking requests"
                                aria-label="Open booking requests queue"
                            >
                                <Inbox className="h-4 w-4 mr-2" aria-hidden />
                                Requests
                                {openBookingCount > 0 && (
                                    <Badge variant="secondary" className="ml-1 tabular-nums">
                                        {openBookingCount}
                                    </Badge>
                                )}
                            </Button>
                            <div className="ml-auto flex items-center gap-2">
                                {ticketsRefreshing && (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        <span>Refreshing...</span>
                                    </div>
                                )}
                                <RefreshButton />
                            </div>
                        </div>
                    </div>
                )}

                {/* Loading State */}
                {ticketsLoading && (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="flex flex-col items-center gap-2">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">Loading tickets...</p>
                        </div>
                    </div>
                )}

                {/* Error State */}
                {ticketsError && !ticketsLoading && (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center">
                            <p className="text-sm text-destructive mb-2">Failed to load tickets</p>
                            <p className="text-xs text-muted-foreground">{ticketsError}</p>
                        </div>
                    </div>
                )}

                {/* Empty State - No lists selected */}
                {!ticketsLoading &&
                    !ticketsError &&
                    selectedListIds.length === 0 &&
                    selectedTicketAreaId && (
                        <div className="flex-1 flex items-center justify-center">
                            <p className="text-sm text-muted-foreground">
                                Select one or more lists to view tickets
                            </p>
                        </div>
                    )}

                {/* Empty State - No area selected */}
                {!ticketsLoading && !ticketsError && !selectedTicketAreaId && (
                    <div className="flex-1 flex items-center justify-center">
                        <p className="text-sm text-muted-foreground">
                            Select a ticket area to get started
                        </p>
                    </div>
                )}

                {/* Tickets Table */}
                {!ticketsLoading && !ticketsError && selectedListIds.length > 0 && (
                    <div className="flex-1 overflow-auto">
                        <table className="w-full text-sm border-collapse" style={tableStyle}>
                            <thead className="bg-muted/50 sticky top-0 z-10 border-b">
                                <tr>
                                    {visibleColumns.map((column) => (
                                        <SortableHeader
                                            key={column.id}
                                            column={column}
                                            onReorder={handleReorder}
                                            onResize={setColumnWidth}
                                            sortable={column.id === SCORE_SORT_COLUMN_ID}
                                            sortDirection={
                                                sort?.columnId === column.id ? sort.direction : null
                                            }
                                            onSort={handleSort}
                                        />
                                    ))}
                                    <th className="px-3 py-2 text-right font-medium text-xs whitespace-nowrap bg-muted/50">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedTickets.length === 0 ? (
                                    <tr>
                                        <td
                                            colSpan={visibleColumns.length + 1}
                                            className="px-3 py-8 text-center text-muted-foreground"
                                        >
                                            {searchTerm
                                                ? "No tickets match your search"
                                                : "No tickets found"}
                                        </td>
                                    </tr>
                                ) : (
                                    <>
                                        {visibleTickets.map((ticket) => (
                                            <DraggableTicketRow
                                                key={`${ticket._listId}-${ticket.id}`}
                                                ticket={ticket}
                                                visibleColumns={visibleColumns}
                                                now={now}
                                                renderCell={renderCell}
                                                booking={booking.byTicket.get(ticket.id)}
                                                bookingBusy={
                                                    booking.busyRid !== null &&
                                                    booking.busyRid ===
                                                        booking.byTicket.get(ticket.id)?.rid
                                                }
                                                onBookingResend={handleBookingResend}
                                                onBookingCancel={handleBookingCancel}
                                                onBookingMinted={() => void booking.refresh()}
                                            />
                                        ))}
                                        {visibleCount < sortedTickets.length && (
                                            <tr ref={sentinelRef}>
                                                <td
                                                    colSpan={visibleColumns.length + 1}
                                                    className="px-3 py-4 text-center text-muted-foreground"
                                                >
                                                    <Loader2
                                                        className="h-4 w-4 animate-spin inline mr-2"
                                                        aria-hidden
                                                    />
                                                    <span className="text-xs">
                                                        Showing {visibleCount} of{" "}
                                                        {sortedTickets.length} — scroll for more
                                                    </span>
                                                </td>
                                            </tr>
                                        )}
                                    </>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Pagination */}
            {!ticketsLoading && selectedListIds.length > 0 && totalPages > 0 && (
                <div className="p-3 border-t bg-muted/30 flex-shrink-0 flex items-center justify-center">
                    <Pagination
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={setPage}
                    />
                </div>
            )}

            <Dialog open={queueOpen} onOpenChange={setQueueOpen}>
                <DialogContent className="sm:max-w-[720px]">
                    <DialogHeader>
                        <DialogTitle>Booking requests</DialogTitle>
                        <DialogDescription>
                            Links you minted, open first. Resend copies a fresh link and invalidates
                            the old one.
                        </DialogDescription>
                    </DialogHeader>
                    <OutstandingRequests tracker={booking} />
                </DialogContent>
            </Dialog>
        </div>
    );
}
