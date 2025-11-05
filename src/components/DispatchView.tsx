import { useEffect } from 'react';
import { startOfDay, endOfDay } from 'date-fns';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { CalendarHeader } from './calendar/CalendarHeader';
import { CalendarGrid } from './calendar/CalendarGrid';
import { TicketList } from './tickets/TicketListDnd';
import { LoadingScreen } from './LoadingScreen';
import { useDispatchStore } from '@/stores/useDispatchStore';

export function DispatchView() {
  const {
    isInitialLoad,
    clientCache,
    clientCacheLoading,
    clientCacheError,
    criticalApiError,
    loadClientCache,
    selectedTicketAreaId,
    setSelectedTicketArea,
    viewLists,
    selectedListIds,
    selectLists,
    selectedDate,
    getVisibleAgents,
    loadAppointments,
    ticketsLoading,
    appointmentsLoading,
    haloTickets,
    appointments,
    completeInitialLoad,
  } = useDispatchStore();

  // Load client cache on mount if not already loaded
  useEffect(() => {
    if (!clientCache && !clientCacheLoading && !clientCacheError && !criticalApiError) {
      loadClientCache();
    }
  }, [clientCache, clientCacheLoading, clientCacheError, criticalApiError, loadClientCache]);

  // Restore saved ticket area from localStorage on mount
  useEffect(() => {
    if (clientCache && !selectedTicketAreaId) {
      const saved = localStorage.getItem('halo-selected-ticket-area');
      if (saved) {
        const areaId = parseInt(saved, 10);
        const area = clientCache.ticketareas.find((a) => a.id === areaId);
        if (area) {
          setSelectedTicketArea(areaId);
        }
      } else if (clientCache.ticketareas.length > 0) {
        // Auto-select first area if none saved
        setSelectedTicketArea(clientCache.ticketareas[0].id);
      }
    }
  }, [clientCache, selectedTicketAreaId, setSelectedTicketArea]);

  // Restore selected lists from localStorage after view lists are loaded
  useEffect(() => {
    if (viewLists.length > 0 && selectedListIds.length === 0) {
      const saved = localStorage.getItem('halo-selected-lists');
      if (saved) {
        try {
          const listIds: number[] = JSON.parse(saved);
          // Validate that saved list IDs still exist
          const validIds = listIds.filter((id) =>
            viewLists.some((list) => list.id === id)
          );
          if (validIds.length > 0) {
            // Use selectLists which automatically loads tickets
            selectLists(validIds);
          }
        } catch (error) {
          console.error('Failed to parse saved list selection:', error);
        }
      }
    }
  }, [viewLists, selectedListIds.length, selectLists]);

  // Load appointments on initial load once we have agents
  useEffect(() => {
    const visibleAgents = getVisibleAgents();
    if (isInitialLoad && clientCache && visibleAgents.length > 0 && appointments.length === 0 && !appointmentsLoading) {
      const dayStart = startOfDay(selectedDate);
      const dayEnd = endOfDay(selectedDate);
      loadAppointments(dayStart, dayEnd);
    }
  }, [isInitialLoad, clientCache, getVisibleAgents, appointments.length, appointmentsLoading, selectedDate, loadAppointments]);

  // Complete initial load when both tickets and appointments have loaded
  useEffect(() => {
    const visibleAgents = getVisibleAgents();
    const hasNoAgentsOrAppointmentsLoaded = visibleAgents.length === 0 || !appointmentsLoading;

    if (
      isInitialLoad &&
      !clientCacheLoading &&
      !ticketsLoading &&
      // Ensure we have tickets (or no lists selected meaning we won't have tickets)
      (haloTickets.length > 0 || selectedListIds.length === 0) &&
      // Ensure appointments have been loaded (or we have no agents to load appointments for)
      hasNoAgentsOrAppointmentsLoaded &&
      clientCache // Ensure client cache is loaded before completing
    ) {
      completeInitialLoad();
    }
  }, [isInitialLoad, clientCacheLoading, ticketsLoading, appointmentsLoading, haloTickets.length, selectedListIds.length, getVisibleAgents, clientCache, completeInitialLoad]);

  // Show loading screen during initial load (or when any critical data is loading)
  if (isInitialLoad) {
    return <LoadingScreen />;
  }

  // Show main view once loaded
  return (
    <div className="h-screen bg-background">
      <PanelGroup direction="vertical" id="dispatch-view-panels">
        {/* Calendar Section - Default 66% */}
        <Panel defaultSize={66} minSize={30}>
          <div className="h-full flex flex-col min-h-0">
            <CalendarHeader />
            <CalendarGrid />
          </div>
        </Panel>

        {/* Resizable Divider */}
        <PanelResizeHandle className="h-1 bg-border hover:bg-primary/50 active:bg-primary transition-colors cursor-row-resize" />

        {/* Ticket List Section - Default 34% */}
        <Panel defaultSize={34} minSize={20}>
          <div className="h-full overflow-hidden">
            <TicketList />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
