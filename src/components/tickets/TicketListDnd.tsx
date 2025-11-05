import { useState, useMemo, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { Loader2, Search, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { useConfigStore } from '@/stores/configStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { Pagination } from '@/components/tickets/Pagination';
import { RefreshButton } from '@/components/tickets/RefreshButton';
import { useDraggableTicket } from '@/hooks/useDraggableTicket';
import { AgentAvatar } from '@/components/AgentAvatar';
import { cn } from '@/lib/utils';
import type { EnrichedTicket } from '@/types/halo';
import type { Ticket } from '@/types';
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import type { ColumnConfig } from '@/stores/preferencesStore';

interface SortableHeaderProps {
  column: ColumnConfig;
  onReorder: (draggedId: string, targetId: string) => void;
  onResize: (columnId: string, width: number) => void;
}

interface DraggableTicketRowProps {
  ticket: EnrichedTicket;
  visibleColumns: ColumnConfig[];
  renderCell: (column: ColumnConfig, ticket: EnrichedTicket) => React.ReactNode;
}

function DraggableTicketRow({ ticket, visibleColumns, renderCell }: DraggableTicketRowProps) {
  // Convert EnrichedTicket to Ticket format for drag and drop
  const dragTicket: Ticket = {
    id: ticket.id.toString(),
    ticketNumber: ticket.id.toString(),
    title: ticket.summary,
    description: ticket.details || '',
    status: 'new',
    priority: 'medium',
    customerName: ticket.user_name || '',
    customerEmail: '',
    siteName: ticket.site_name || '',
    category: ticket.category_1 || '',
    tags: [],
    createdAt: new Date(ticket.dateoccurred),
    updatedAt: new Date(ticket.last_update),
    estimatedDuration: 30,
  };

  const dragRef = useDraggableTicket(dragTicket);

  return (
    <tr
      ref={dragRef}
      key={`${ticket._listId}-${ticket.id}`}
      className="border-b hover:bg-muted/30 transition-colors cursor-grab active:cursor-grabbing select-none"
    >
      {visibleColumns.map((column) => (
        <td
          key={column.id}
          className="px-3 py-2 overflow-hidden text-ellipsis whitespace-nowrap"
          style={column.width ? {
            width: `${column.width}px`,
            minWidth: `${column.width}px`,
            maxWidth: `${column.width}px`
          } : undefined}
        >
          {renderCell(column, ticket)}
        </td>
      ))}
    </tr>
  );
}

function SortableHeader({ column, onReorder, onResize }: SortableHeaderProps) {
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
        type: 'column-header',
        columnId: column.id,
        columnLabel: column.label,
      }),
      canDrag: ({ input }) => {
        // Don't start drag if clicking on resize handle
        const target = input.event?.target as HTMLElement;
        return !target?.closest('[data-resize-handle]');
      },
      onDragStart: () => {
        setIsDragging(true);
        if (headerElement) {
          headerElement.style.opacity = '0.4';
        }
      },
      onDrop: () => {
        setIsDragging(false);
        if (headerElement) {
          headerElement.style.opacity = '1';
        }
      },
    });

    const cleanupDropTarget = dropTargetForElements({
      element: headerElement,
      canDrop: ({ source }) => {
        const data = source.data as { type: string; columnId: string };
        return data.type === 'column-header' && data.columnId !== column.id;
      },
      getData: () => ({ columnId: column.id }),
      onDragEnter: () => setIsDraggedOver(true),
      onDragLeave: () => setIsDraggedOver(false),
      onDrop: ({ source }) => {
        setIsDraggedOver(false);
        const data = source.data as { type: string; columnId: string };
        if (data.type === 'column-header') {
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
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };

    resizeHandle.addEventListener('mousedown', handleMouseDown);

    return () => {
      resizeHandle.removeEventListener('mousedown', handleMouseDown);
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
        'relative px-3 py-2 text-left font-medium text-xs whitespace-nowrap bg-muted/50',
        isDraggedOver && 'bg-primary/20 border-l-2 border-r-2 border-primary',
        column.isFixed && 'bg-muted/70',
        !column.isFixed && 'cursor-grab active:cursor-grabbing'
      )}
    >
      <div className="flex items-center gap-1">
        <span className={cn(isDragging && 'opacity-50')}>{column.label}</span>
      </div>

      {/* Resize Handle */}
      <div
        ref={resizeHandleRef}
        data-resize-handle
        className={cn(
          'absolute right-0 top-0 bottom-0 w-2 -mr-1 cursor-col-resize z-10',
          'hover:bg-primary/50 active:bg-primary transition-colors',
          isResizing && 'bg-primary'
        )}
        title="Drag to resize"
      />
    </th>
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
    agents,
  } = useDispatchStore();

  const { config } = useConfigStore();
  const { ticketListColumns, setTicketListColumns, setColumnWidth, resetColumns } = usePreferencesStore();
  const [searchTerm, setSearchTerm] = useState('');

  // Show list column only if multiple lists are selected
  const showListColumn = selectedListIds.length > 1;

  // Get visible columns
  const visibleColumns = useMemo(() => {
    const columns = ticketListColumns.filter(col => col.isVisible);
    // Only show list column if multiple lists selected
    if (!showListColumn) {
      return columns.filter(col => col.id !== 'list');
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

  // Calculate total pages
  const totalPages = Math.ceil(totalRecords / pageSize);

  // Calculate table width based on whether columns have custom widths
  const tableStyle = useMemo(() => {
    const hasCustomWidths = visibleColumns.some(col => col.width);
    if (hasCustomWidths) {
      // If any columns have custom widths, use max-content to allow expansion
      return { width: 'max-content', minWidth: '100%' };
    }
    // Otherwise, fill container width
    return undefined;
  }, [visibleColumns]);

  // Handle column reordering
  const handleReorder = (draggedId: string, targetId: string) => {
    const draggedIndex = ticketListColumns.findIndex(col => col.id === draggedId);
    const targetIndex = ticketListColumns.findIndex(col => col.id === targetId);

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
    const getSlaColorClass = () => {
      switch (ticket.slaState) {
        case 'overdue':
          return 'text-red-600 font-semibold';
        case 'warning':
          return 'text-yellow-600 font-semibold';
        case 'onhold':
          return 'text-blue-600';
        default:
          return 'text-green-600';
      }
    };

    switch (column.id) {
      case 'list':
        return (
          <Badge variant="outline" className="text-xs whitespace-nowrap">
            {ticket._listName}
          </Badge>
        );

      case 'id':
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

      case 'clientSiteUser':
        return <span className="text-xs">{ticket.clientSiteUser}</span>;

      case 'status':
        return (
          <Badge
            variant="outline"
            style={{ borderColor: ticket.statusColour, color: ticket.statusColour }}
            className="text-xs whitespace-nowrap"
          >
            {ticket.statusName}
          </Badge>
        );

      case 'slaTimeLeft':
        return (
          <span className={cn('text-xs', getSlaColorClass())}>
            {ticket.slaTimeLeft}
          </span>
        );

      case 'priority':
        return ticket.priority ? (
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <div
              className="w-3 h-3 rounded-sm border flex-shrink-0"
              style={{ backgroundColor: ticket.priority.colour || '#cccccc' }}
              title={ticket.priority.name}
            />
            <span className="text-xs">{ticket.priority.name}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">No priority</span>
        );

      case 'team':
        return <span className="text-xs">{ticket.team}</span>;

      case 'agent': {
        const agent = agents.find((a) => a.id === ticket.agent_id);
        return agent ? (
          <AgentAvatar
            agent={agent}
            size="sm"
            showName
            resourceServer={config.resourceServer}
          />
        ) : (
          <span className="text-xs text-muted-foreground">{ticket.agentName || 'Unassigned'}</span>
        );
      }

      case 'summary':
        return <span className="text-sm">{ticket.summary}</span>;

      case 'dateReported':
        return (
          <span className="text-xs text-muted-foreground">
            {format(new Date(ticket.dateoccurred), 'MMM d, yyyy')}
          </span>
        );

      case 'lastAction':
        return (
          <span className="text-xs text-muted-foreground">
            {format(new Date(ticket.lastactiondate), 'MMM d, yyyy')}
          </span>
        );

      case 'type':
        return <span className="text-xs">{ticket.ticketTypeName}</span>;

      case 'timeTaken':
        return (
          <span className="text-xs text-center">
            {ticket.timetaken ? `${ticket.timetaken.toFixed(2)}h` : '-'}
          </span>
        );

      case 'serviceCategory':
        return <span className="text-xs">{ticket.category_1}</span>;

      case 'createdBy':
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
                  type="text"
                  placeholder="Search tickets..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <span className="text-sm font-medium text-muted-foreground">
                {totalRecords} {totalRecords === 1 ? 'Ticket' : 'Tickets'}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={resetColumns}
                title="Reset column widths and order"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset Columns
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
        {!ticketsLoading && !ticketsError && selectedListIds.length === 0 && selectedTicketAreaId && (
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
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredTickets.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumns.length} className="px-3 py-8 text-center text-muted-foreground">
                      {searchTerm ? 'No tickets match your search' : 'No tickets found'}
                    </td>
                  </tr>
                ) : (
                  filteredTickets.map((ticket) => (
                    <DraggableTicketRow
                      key={`${ticket._listId}-${ticket.id}`}
                      ticket={ticket}
                      visibleColumns={visibleColumns}
                      renderCell={renderCell}
                    />
                  ))
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
    </div>
  );
}
