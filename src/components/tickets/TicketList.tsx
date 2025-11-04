import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { Loader2, User, Search } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { useConfigStore } from '@/stores/configStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { getAgentPhotoUrl } from '@/services/halo-api';
import { Pagination } from '@/components/tickets/Pagination';
import { RefreshButton } from '@/components/tickets/RefreshButton';
import { ColumnSettings } from '@/components/tickets/ColumnSettings';
import { cn } from '@/lib/utils';
import type { EnrichedTicket } from '@/types/halo';

/**
 * TicketRow Component
 * Displays a single ticket with all required columns from README
 */
function TicketRow({ ticket }: { ticket: EnrichedTicket }) {
  const { config } = useConfigStore();

  // Build agent photo URL
  const agentPhotoUrl = ticket.agentPhotoUrl
    ? getAgentPhotoUrl(config.resourceServer, ticket.agentPhotoUrl)
    : null;

  // Get SLA color class based on state
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

  return (
    <tr className="border-b hover:bg-muted/30 transition-colors">
      {/* List Name (only show if multiple lists selected) */}
      {ticket._listName && (
        <td className="px-3 py-2 whitespace-nowrap">
          <Badge variant="outline" className="text-xs whitespace-nowrap">
            {ticket._listName}
          </Badge>
        </td>
      )}

      {/* ID */}
      <td className="px-3 py-2 font-medium whitespace-nowrap">
        <a
          href={`${config.resourceServer}/tickets?id=${ticket.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          {ticket.id}
        </a>
      </td>

      {/* Client/Site/User */}
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        {ticket.clientSiteUser}
      </td>

      {/* Status */}
      <td className="px-3 py-2 whitespace-nowrap">
        <Badge
          variant="outline"
          style={{ borderColor: ticket.statusColour, color: ticket.statusColour }}
          className="text-xs whitespace-nowrap"
        >
          {ticket.statusName}
        </Badge>
      </td>

      {/* SLA Time Left */}
      <td className="px-3 py-2 whitespace-nowrap">
        <span className={cn('text-xs', getSlaColorClass())}>
          {ticket.slaTimeLeft}
        </span>
      </td>

      {/* Priority */}
      <td className="px-3 py-2 whitespace-nowrap">
        {ticket.priority ? (
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
        )}
      </td>

      {/* Team */}
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        {ticket.team}
      </td>

      {/* Agent with photo */}
      <td className="px-3 py-2 whitespace-nowrap">
        <div className="flex items-center gap-2">
          {agentPhotoUrl ? (
            <img
              src={agentPhotoUrl}
              alt={ticket.agentName}
              className="w-6 h-6 rounded-full object-cover flex-shrink-0"
              onError={(e) => {
                // Fallback to icon if image fails to load
                e.currentTarget.style.display = 'none';
                e.currentTarget.nextElementSibling?.classList.remove('hidden');
              }}
            />
          ) : null}
          <div className={cn('w-6 h-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0', agentPhotoUrl && 'hidden')}>
            <User className="w-3 h-3 text-muted-foreground" />
          </div>
          <span className="text-xs">
            {ticket.agentName}
          </span>
        </div>
      </td>

      {/* Summary */}
      <td className="px-3 py-2 text-sm whitespace-nowrap">
        {ticket.summary}
      </td>

      {/* Date Reported */}
      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
        {format(new Date(ticket.dateoccurred), 'MMM d, yyyy')}
      </td>

      {/* Last Action Date */}
      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
        {format(new Date(ticket.lastactiondate), 'MMM d, yyyy')}
      </td>

      {/* Type */}
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        {ticket.ticketTypeName}
      </td>

      {/* Time Taken */}
      <td className="px-3 py-2 text-xs text-center whitespace-nowrap">
        {ticket.timetaken ? `${ticket.timetaken.toFixed(2)}h` : '-'}
      </td>

      {/* Service Category */}
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        {ticket.category_1}
      </td>

      {/* Created By */}
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        {ticket.reportedby}
      </td>
    </tr>
  );
}

/**
 * TicketList Component
 * Main component that displays Halo tickets with area selector, list selector, and pagination
 */
export function TicketList() {
  const {
    haloTickets,
    selectedListIds,
    ticketsLoading,
    ticketsError,
    selectedTicketAreaId,
    currentPage,
    pageSize,
    totalRecords,
    setPage,
  } = useDispatchStore();

  const [searchTerm, setSearchTerm] = useState('');
  const { ticketListColumns } = usePreferencesStore();

  // Show list column only if multiple lists are selected
  const showListColumn = selectedListIds.length > 1;

  // Get visible columns
  const visibleColumns = useMemo(() => {
    return ticketListColumns.filter(col => col.isVisible);
  }, [ticketListColumns]);

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
              <div className="flex items-center gap-2 ml-auto">
                <ColumnSettings />
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
            <table className="w-full text-sm border-collapse">
              <thead className="bg-muted/50 sticky top-0 z-10 border-b">
                <tr>
                  {showListColumn && (
                    <th className="px-3 py-2 text-left font-medium text-xs whitespace-nowrap">List</th>
                  )}
                  <th className="px-3 py-2 text-left font-medium text-xs whitespace-nowrap">ID</th>
                  <th className="px-3 py-2 text-left font-medium text-xs whitespace-nowrap">Client/Site/User</th>
                  <th className="px-3 py-2 text-left font-medium text-xs whitespace-nowrap">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-xs whitespace-nowrap">SLA Time Left</th>
                  <th className="px-3 py-2 text-left font-medium text-xs whitespace-nowrap">Priority</th>
                  <th className="px-3 py-2 text-left font-medium text-xs whitespace-nowrap">Team</th>
                  <th className="px-3 py-2 text-left font-medium text-xs whitespace-nowrap">Agent</th>
                  <th className="px-3 py-2 text-left font-medium text-xs whitespace-nowrap">Summary</th>
                  <th className="px-3 py-2 text-left font-medium text-xs whitespace-nowrap">Date Reported</th>
                  <th className="px-3 py-2 text-left font-medium text-xs whitespace-nowrap">Last Action</th>
                  <th className="px-3 py-2 text-left font-medium text-xs whitespace-nowrap">Type</th>
                  <th className="px-3 py-2 text-left font-medium text-xs whitespace-nowrap">Time Taken</th>
                  <th className="px-3 py-2 text-left font-medium text-xs whitespace-nowrap">Service Category</th>
                  <th className="px-3 py-2 text-left font-medium text-xs whitespace-nowrap">Created By</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.length === 0 ? (
                  <tr>
                    <td colSpan={showListColumn ? 15 : 14} className="px-3 py-8 text-center text-muted-foreground">
                      {searchTerm ? 'No tickets match your search' : 'No tickets found'}
                    </td>
                  </tr>
                ) : (
                  filteredTickets.map((ticket) => (
                    <TicketRow key={`${ticket._listId}-${ticket.id}`} ticket={ticket} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {!ticketsLoading && selectedListIds.length > 0 && totalPages > 0 && (
        <div className="p-3 border-t bg-muted/30 flex-shrink-0 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, totalRecords)} of {totalRecords} tickets
          </p>
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
