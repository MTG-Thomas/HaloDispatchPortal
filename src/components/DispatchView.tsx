import { useEffect, useRef } from "react";
import { startOfDay, endOfDay } from "date-fns";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { CalendarHeader } from "./calendar/CalendarHeader";
import { CalendarGrid } from "./calendar/CalendarGrid";
import { TicketList } from "./tickets/TicketListDnd";
import { LoadingScreen } from "./LoadingScreen";
import { useDispatchStore } from "@/stores/useDispatchStore";

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
        loadViewLists,
        viewLists,
        viewListsLoading,
        selectedListIds,
        selectLists,
        loadTicketsForLists,
        selectedDate,
        getVisibleAgents,
        loadAppointments,
        ticketsLoading,
        ticketsRefreshing,
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

    // Apply the persisted ticket-area selection once reference data is loaded.
    // Falls back to the first area for fresh users or stale persisted ids.
    // Guarded by the loading flags so user-initiated area switches (which clear
    // viewLists before reloading) don't retrigger this effect.
    useEffect(() => {
        if (!clientCache || viewListsLoading || viewLists.length > 0) {
            return;
        }
        if (selectedTicketAreaId) {
            const area = clientCache.ticketareas.find((a) => a.id === selectedTicketAreaId);
            const targetId = area ? area.id : clientCache.ticketareas[0]?.id;
            if (targetId !== undefined) {
                if (targetId === selectedTicketAreaId) {
                    // Same area as the persisted selection: load its lists without
                    // resetting (setSelectedTicketArea clears the persisted lists).
                    loadViewLists(targetId);
                } else {
                    setSelectedTicketArea(targetId);
                }
            }
        } else if (clientCache.ticketareas.length > 0) {
            setSelectedTicketArea(clientCache.ticketareas[0].id);
        }
    }, [
        clientCache,
        selectedTicketAreaId,
        viewLists.length,
        viewListsLoading,
        setSelectedTicketArea,
        loadViewLists,
    ]);

    // Apply the persisted list selection after view lists load: prune ids that
    // no longer exist, then load tickets. Persisted ids rehydrate silently, so
    // this effect is what turns them into a ticket load. The signature ref
    // gives "apply once per selection" semantics so legitimately empty lists
    // don't retrigger a load on every render.
    const appliedListsRef = useRef<string | null>(null);
    useEffect(() => {
        if (viewLists.length === 0 || selectedListIds.length === 0) {
            return;
        }
        const signature = `${selectedTicketAreaId}:${[...selectedListIds].sort((a, b) => a - b).join(",")}`;
        if (appliedListsRef.current === signature) {
            return;
        }
        appliedListsRef.current = signature;
        const validIds = selectedListIds.filter((id) => viewLists.some((list) => list.id === id));
        if (validIds.length !== selectedListIds.length) {
            // Pruning also triggers the ticket load via selectLists.
            selectLists(validIds);
        } else if (!ticketsLoading && !ticketsRefreshing && haloTickets.length === 0) {
            loadTicketsForLists(selectedListIds, 1);
        }
    }, [
        viewLists,
        selectedListIds,
        selectedTicketAreaId,
        ticketsLoading,
        ticketsRefreshing,
        haloTickets.length,
        selectLists,
        loadTicketsForLists,
    ]);

    // Load appointments on initial load once we have agents
    useEffect(() => {
        const visibleAgents = getVisibleAgents();
        if (
            isInitialLoad &&
            clientCache &&
            visibleAgents.length > 0 &&
            appointments.length === 0 &&
            !appointmentsLoading
        ) {
            const dayStart = startOfDay(selectedDate);
            const dayEnd = endOfDay(selectedDate);
            loadAppointments(dayStart, dayEnd);
        }
    }, [
        isInitialLoad,
        clientCache,
        getVisibleAgents,
        appointments.length,
        appointmentsLoading,
        selectedDate,
        loadAppointments,
    ]);

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
    }, [
        isInitialLoad,
        clientCacheLoading,
        ticketsLoading,
        appointmentsLoading,
        haloTickets.length,
        selectedListIds.length,
        getVisibleAgents,
        clientCache,
        completeInitialLoad,
    ]);

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
