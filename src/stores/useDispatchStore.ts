import { create } from "zustand";
import type {
    Agent,
    Team,
    Ticket,
    Appointment,
    CalendarView,
    TicketFilters,
    TicketSort,
    DaySchedule,
    AppointmentStatus,
} from "@/types";
import type {
    ClientCache,
    ViewList,
    Ticket as HaloTicket,
    EnrichedTicket,
    HaloAppointment,
    HaloAppointmentType,
} from "@/types/halo";
import {
    getClientCache,
    getViewLists,
    getTickets,
    getUtcOffset,
    getAppointments,
    getAppointmentTypes,
    createOrUpdateAppointment as apiCreateOrUpdateAppointment,
} from "@/services/halo-api";
import { enrichTicket } from "@/utils/enrich-ticket";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useConfigStore } from "@/stores/configStore";

interface DispatchState {
    // Data
    agents: Agent[];
    teams: Team[];
    tickets: Ticket[];
    appointments: Appointment[];

    // Calendar State
    calendarView: CalendarView;
    selectedDate: Date;

    // Ticket List State
    ticketFilters: TicketFilters;
    ticketSort: TicketSort;

    // ===== Halo PSA State =====
    // Reference Data
    clientCache: ClientCache | null;
    selectedTicketAreaId: number | null;

    // Lists
    viewLists: ViewList[];
    selectedListIds: number[];

    // Tickets
    haloTickets: EnrichedTicket[];
    ticketsByList: Map<number, HaloTicket[]>;

    // Appointments
    appointmentTypes: HaloAppointmentType[];
    haloAppointments: HaloAppointment[];

    // Loading States
    clientCacheLoading: boolean;
    viewListsLoading: boolean;
    ticketsLoading: boolean;
    ticketsRefreshing: boolean; // Background refresh without hiding content
    appointmentsLoading: boolean;
    appointmentTypesLoading: boolean;

    // Error States
    clientCacheError: string | null;
    viewListsError: string | null;
    ticketsError: string | null;
    appointmentsError: string | null;

    // Pagination
    currentPage: number;
    pageSize: number;
    totalRecords: number;

    // Auto-refresh
    autoRefreshEnabled: boolean;
    autoRefreshInterval: number;
    lastRefreshTime: Date | null;
    appointmentRefreshInterval: NodeJS.Timeout | null;

    // Global API Error State
    criticalApiError: {
        message: string;
        details?: string;
        timestamp: Date;
    } | null;

    // Actions - Calendar
    setCalendarView: (view: CalendarView) => void;
    setSelectedDate: (date: Date) => void;

    // Actions - Appointments
    createAppointment: (
        appointment: Omit<Appointment, "id" | "createdAt" | "updatedAt">
    ) => void;
    updateAppointment: (id: string, updates: Partial<Appointment>) => void;
    deleteAppointment: (id: string) => void;
    moveAppointment: (
        id: string,
        newStartTime: Date,
        newAgentId: number
    ) => void;
    resizeAppointment: (
        id: string,
        newStartTime: Date,
        newEndTime: Date
    ) => Promise<void>;
    createOrUpdateAppointment: (
        appointment: Partial<HaloAppointment> & { id?: number }
    ) => Promise<void>;

    // Actions - Tickets
    updateTicket: (id: string, updates: Partial<Ticket>) => void;
    scheduleTicket: (
        ticketId: string,
        agentId: string,
        startTime: Date
    ) => void;
    setTicketFilters: (filters: TicketFilters) => void;
    setTicketSort: (sort: TicketSort) => void;

    // Computed
    getVisibleAgents: () => Agent[];
    getAppointmentsForDateRange: (start: Date, end: Date) => Appointment[];
    getFilteredTickets: () => Ticket[];

    // ===== Halo PSA Actions =====
    // Client Cache
    loadClientCacheInternal: (cache: ClientCache) => void;
    loadClientCache: () => Promise<void>;

    // Ticket Area
    setSelectedTicketArea: (ticketAreaId: number) => void;

    // View Lists
    loadViewLists: (ticketAreaId: number) => Promise<void>;
    selectLists: (listIds: number[]) => void;
    toggleListSelection: (listId: number) => void;

    // Tickets
    loadTicketsForLists: (listIds?: number[], page?: number, isRefresh?: boolean) => Promise<void>;
    refreshTickets: () => Promise<void>;

    // Appointments
    loadAppointmentTypes: () => Promise<void>;
    loadAppointments: (startDate: Date, endDate: Date) => Promise<void>;
    startAppointmentAutoRefresh: () => void;
    stopAppointmentAutoRefresh: () => void;

    // Pagination
    setPage: (page: number) => void;
    setPageSize: (size: number) => void;

    // Auto-refresh
    toggleAutoRefresh: () => void;
    setAutoRefreshInterval: (interval: number) => void;

    // Global API Error Handling
    setCriticalApiError: (message: string, details?: string) => void;
    clearCriticalApiError: () => void;
    retryAfterError: () => void;
}

export const useDispatchStore = create<DispatchState>((set, get) => ({
    // Initial Data
    agents: [],
    teams: [],
    tickets: [],
    appointments: [],

    // Initial Calendar State
    calendarView: "week5",
    selectedDate: new Date(),

    // Initial Ticket List State
    ticketFilters: {},
    ticketSort: { field: "priority", direction: "desc" },

    // Initial Halo PSA State
    clientCache: null,
    selectedTicketAreaId: null,
    viewLists: [],
    selectedListIds: [],
    haloTickets: [],
    ticketsByList: new Map(),
    appointmentTypes: [],
    haloAppointments: [],
    clientCacheLoading: false,
    viewListsLoading: false,
    ticketsLoading: false,
    ticketsRefreshing: false,
    appointmentsLoading: false,
    appointmentTypesLoading: false,
    clientCacheError: null,
    viewListsError: null,
    ticketsError: null,
    appointmentsError: null,
    currentPage: 1,
    pageSize: 100,
    totalRecords: 0,
    autoRefreshEnabled: false,
    autoRefreshInterval: 60000, // 60 seconds
    lastRefreshTime: null,
    appointmentRefreshInterval: null,
    criticalApiError: null,

    // Calendar Actions
    setCalendarView: (view) => set({ calendarView: view }),

    setSelectedDate: (date) => set({ selectedDate: date }),

    // Appointment Actions
    createAppointment: (appointmentData) =>
        set((state) => {
            const newAppointment: Appointment = {
                ...appointmentData,
                id: Date.now().toString(),
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            return { appointments: [...state.appointments, newAppointment] };
        }),

    updateAppointment: (id, updates) =>
        set((state) => ({
            appointments: state.appointments.map((apt) =>
                apt.id === id
                    ? { ...apt, ...updates, updatedAt: new Date() }
                    : apt
            ),
        })),

    deleteAppointment: (id) =>
        set((state) => ({
            appointments: state.appointments.filter((apt) => apt.id !== id),
        })),

    moveAppointment: (id, newStartTime, newAgentId) =>
        set((state) => ({
            appointments: state.appointments.map((apt) => {
                if (apt.id !== id) return apt;

                const duration =
                    apt.endTime.getTime() - apt.startTime.getTime();
                const newEndTime = new Date(newStartTime.getTime() + duration);

                return {
                    ...apt,
                    startTime: newStartTime,
                    endTime: newEndTime,
                    agentId: newAgentId,
                    updatedAt: new Date(),
                };
            }),
        })),

    resizeAppointment: async (id, newStartTime, newEndTime) => {
        const currentState = get();
        const appointment = currentState.appointments.find(
            (apt) => apt.id === id
        );
        if (!appointment) {
            throw new Error("Appointment not found");
        }

        // Store original times for rollback
        const originalStartTime = appointment.startTime;
        const originalEndTime = appointment.endTime;

        // Optimistically update the store immediately
        set({
            appointments: currentState.appointments.map((apt) =>
                apt.id === id
                    ? { ...apt, startTime: newStartTime, endTime: newEndTime }
                    : apt
            ),
        });

        try {
            // Parse the appointment ID
            const haloAppointmentId = parseInt(id);

            // Determine which field changed and build partial update
            const update: Partial<HaloAppointment> & { id: number } = {
                id: haloAppointmentId,
            };

            // Check if start time changed
            if (originalStartTime.getTime() !== newStartTime.getTime()) {
                update.start_date = newStartTime.toISOString();
            }

            // Check if end time changed
            if (originalEndTime.getTime() !== newEndTime.getTime()) {
                update.end_date = newEndTime.toISOString();
            }

            // Call the API
            await apiCreateOrUpdateAppointment(update);

            // Success - optimistic update is already applied, no need to refresh
        } catch (error) {
            // Rollback optimistic update on failure
            const state = get();
            set({
                appointments: state.appointments.map((apt) =>
                    apt.id === id
                        ? {
                              ...apt,
                              startTime: originalStartTime,
                              endTime: originalEndTime,
                          }
                        : apt
                ),
            });

            const { toast } = await import("sonner");
            console.error("Failed to resize appointment:", error);
            toast.error("Failed to resize appointment", {
                description:
                    error instanceof Error
                        ? error.message
                        : "An unknown error occurred",
            });
            throw error;
        }
    },

    createOrUpdateAppointment: async (appointment) => {
        try {
            // Call the API
            const result = await apiCreateOrUpdateAppointment(appointment);

            // API returns an array with the created/updated appointment
            if (result && result.length > 0) {
                const updatedAppointment = result[0];

                // Update the local state
                set((state) => {
                    const appointmentId = updatedAppointment.id.toString();
                    const existingIndex = state.appointments.findIndex(
                        (apt) => apt.id === appointmentId
                    );

                    // Convert HaloAppointment to Appointment format
                    const mappedAppointment: Appointment = {
                        id: appointmentId,
                        ticketId: updatedAppointment.ticket_id?.toString() || "",
                        agentId: updatedAppointment.agent_id,
                        startTime: new Date(
                            updatedAppointment.start_date.endsWith("Z")
                                ? updatedAppointment.start_date
                                : `${updatedAppointment.start_date}Z`
                        ),
                        endTime: new Date(
                            updatedAppointment.end_date.endsWith("Z")
                                ? updatedAppointment.end_date
                                : `${updatedAppointment.end_date}Z`
                        ),
                        status:
                            updatedAppointment.complete_status === 0
                                ? "completed"
                                : "scheduled",
                        location: updatedAppointment.appointment_location_name,
                        isAllDay: updatedAppointment.allday,
                        isTentative: false,
                        notes: updatedAppointment.note,
                        createdAt:
                            existingIndex >= 0
                                ? state.appointments[existingIndex].createdAt
                                : new Date(),
                        updatedAt: new Date(),
                        subject: updatedAppointment.subject,
                        colour: updatedAppointment.colour,
                        complete_status: updatedAppointment.complete_status,
                        client_name: updatedAppointment.client_name,
                        site_name: updatedAppointment.site_name,
                        user_name: updatedAppointment.user_name,
                        appointment_type_name:
                            updatedAppointment.appointment_type_name,
                        canUpdate: updatedAppointment._canupdate,
                        canDelete: updatedAppointment._candelete,
                        canComplete: updatedAppointment._cancomplete,
                    };

                    if (existingIndex >= 0) {
                        // Update existing appointment
                        const updatedAppointments = [...state.appointments];
                        updatedAppointments[existingIndex] = {
                            ...updatedAppointments[existingIndex],
                            ...mappedAppointment,
                        };
                        return { appointments: updatedAppointments };
                    } else {
                        // Add new appointment
                        return {
                            appointments: [
                                ...state.appointments,
                                mappedAppointment,
                            ],
                        };
                    }
                });
            }
        } catch (error) {
            const { toast } = await import("sonner");
            console.error("Failed to create/update appointment:", error);
            toast.error("Failed to update appointment", {
                description:
                    error instanceof Error
                        ? error.message
                        : "An unknown error occurred",
            });
            throw error;
        }
    },

    // Ticket Actions
    updateTicket: (id, updates) =>
        set((state) => ({
            tickets: state.tickets.map((ticket) =>
                ticket.id === id
                    ? { ...ticket, ...updates, updatedAt: new Date() }
                    : ticket
            ),
        })),

    scheduleTicket: (ticketId, agentId, startTime) =>
        set((state) => {
            const ticket = state.tickets.find((t) => t.id === ticketId);
            if (!ticket) return state;

            // Calculate end time based on estimated duration
            const endTime = new Date(
                startTime.getTime() + ticket.estimatedDuration * 60000
            );

            // Create appointment
            const newAppointment: Appointment = {
                id: Date.now().toString(),
                ticketId: ticket.id,
                ticket,
                agentId,
                startTime,
                endTime,
                status: "scheduled",
                isAllDay: false,
                isTentative: false,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            // Update ticket status
            const updatedTickets = state.tickets.map((t) =>
                t.id === ticketId
                    ? {
                          ...t,
                          status: "scheduled" as const,
                          updatedAt: new Date(),
                      }
                    : t
            );

            return {
                appointments: [...state.appointments, newAppointment],
                tickets: updatedTickets,
            };
        }),

    setTicketFilters: (filters) => set({ ticketFilters: filters }),

    setTicketSort: (sort) => set({ ticketSort: sort }),

    // Computed Getters
    getVisibleAgents: () => {
        const state = get();
        // Read selectedResources from preferences store
        const { selectedResources } = usePreferencesStore.getState();
        const selectedAgentIds = new Set<number>();

        selectedResources.forEach((resource) => {
            if (resource.type === "agent") {
                // resource.id is string but should be parseable to number
                const agentId =
                    typeof resource.id === "string"
                        ? parseInt(resource.id.replace("agent-", ""))
                        : resource.id;
                selectedAgentIds.add(agentId);
            } else if (resource.type === "team") {
                const team = state.teams.find((t) => t.id === resource.id);
                if (team) {
                    team.memberIds.forEach((agentId) =>
                        selectedAgentIds.add(agentId)
                    );
                }
            }
        });

        return state.agents.filter((agent) => selectedAgentIds.has(agent.id));
    },

    getAppointmentsForDateRange: (start, end) => {
        const state = get();
        return state.appointments.filter(
            (apt) =>
                (apt.startTime >= start && apt.startTime <= end) ||
                (apt.endTime >= start && apt.endTime <= end) ||
                (apt.startTime <= start && apt.endTime >= end)
        );
    },

    getFilteredTickets: () => {
        const state = get();
        let filtered = [...state.tickets];

        // Apply filters
        if (
            state.ticketFilters.status &&
            state.ticketFilters.status.length > 0
        ) {
            filtered = filtered.filter((t) =>
                state.ticketFilters.status!.includes(t.status)
            );
        }

        if (
            state.ticketFilters.priority &&
            state.ticketFilters.priority.length > 0
        ) {
            filtered = filtered.filter((t) =>
                state.ticketFilters.priority!.includes(t.priority)
            );
        }

        if (state.ticketFilters.category) {
            filtered = filtered.filter(
                (t) => t.category === state.ticketFilters.category
            );
        }

        if (state.ticketFilters.searchTerm) {
            const term = state.ticketFilters.searchTerm.toLowerCase();
            filtered = filtered.filter(
                (t) =>
                    t.title.toLowerCase().includes(term) ||
                    t.description.toLowerCase().includes(term) ||
                    t.ticketNumber.toLowerCase().includes(term) ||
                    t.customerName.toLowerCase().includes(term)
            );
        }

        // Apply sorting
        filtered.sort((a, b) => {
            const { field, direction } = state.ticketSort;
            let comparison = 0;

            switch (field) {
                case "priority": {
                    const priorityOrder = {
                        urgent: 4,
                        high: 3,
                        medium: 2,
                        low: 1,
                    };
                    comparison =
                        priorityOrder[a.priority] - priorityOrder[b.priority];
                    break;
                }
                case "createdAt":
                    comparison = a.createdAt.getTime() - b.createdAt.getTime();
                    break;
                case "updatedAt":
                    comparison = a.updatedAt.getTime() - b.updatedAt.getTime();
                    break;
                case "ticketNumber":
                    comparison = a.ticketNumber.localeCompare(b.ticketNumber);
                    break;
                case "status":
                    comparison = a.status.localeCompare(b.status);
                    break;
            }

            return direction === "asc" ? comparison : -comparison;
        });

        return filtered;
    },

    // ===== Halo PSA Action Implementations =====

    // Internal helper to process ClientCache data
    loadClientCacheInternal: (cache: ClientCache) => {
        // Map Halo agents to Agent type
        const agents = cache.agents
            .filter((a) => !a.isdisabled && !a.isapiagent)
            .map((haloAgent): Agent => {
                // Generate default working hours (9-5, Monday-Friday)
                const standardSchedule: DaySchedule = {
                    isWorking: true,
                    startTime: "09:00",
                    endTime: "17:00",
                };
                const weekendSchedule: DaySchedule = {
                    isWorking: false,
                    startTime: "09:00",
                    endTime: "17:00",
                };

                return {
                    id: haloAgent.id,
                    name: haloAgent.name,
                    email: haloAgent.email,
                    avatar: haloAgent.agentphotopath,
                    role: haloAgent.jobtitle || "Agent",
                    teamIds: [], // Will be filled after teams are created
                    skills: [],
                    workingHours: {
                        monday: standardSchedule,
                        tuesday: standardSchedule,
                        wednesday: standardSchedule,
                        thursday: standardSchedule,
                        friday: standardSchedule,
                        saturday: weekendSchedule,
                        sunday: weekendSchedule,
                    },
                    isActive: !haloAgent.isdisabled,
                    color: haloAgent.colour || "#6366f1",
                };
            });

        // Create teams from agent team names
        const teamMap = new Map<string, Set<number>>();
        cache.agents
            .filter((a) => !a.isdisabled && !a.isapiagent && a.team)
            .forEach((agent) => {
                const teamName = agent.team;
                if (!teamMap.has(teamName)) {
                    teamMap.set(teamName, new Set());
                }
                teamMap.get(teamName)!.add(agent.id);
            });

        const teams: Team[] = Array.from(teamMap.entries()).map(
            ([name, memberIds], index) => {
                // Generate stable team ID from team name (slugify)
                const teamId = `team-${name
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-|-$/g, "")}`;

                return {
                    id: teamId,
                    name,
                    memberIds: Array.from(memberIds),
                    color: `hsl(${(index * 137.5) % 360}, 70%, 50%)`, // Generate colors
                    isActive: true,
                };
            }
        );

        // Update agents with their team IDs
        const teamByName = new Map(teams.map((t) => [t.name, t.id]));
        agents.forEach((agent) => {
            const haloAgent = cache.agents.find((a) => a.id === agent.id);
            if (haloAgent?.team && teamByName.has(haloAgent.team)) {
                agent.teamIds = [teamByName.get(haloAgent.team)!];
            }
        });

        // Auto-select all agents if no agents are currently selected
        const { selectedResources, setSelectedResources } =
            usePreferencesStore.getState();
        if (selectedResources.length === 0 && agents.length > 0) {
            const allAgentSelections = agents.map((agent) => ({
                type: "agent" as const,
                id: agent.id.toString(), // Convert to string for ResourceSelection
            }));
            setSelectedResources(allAgentSelections);
        }

        set({
            clientCache: cache,
            clientCacheLoading: false,
            agents,
            teams,
        });
    },

    // Load ClientCache
    loadClientCache: async () => {
        set({ clientCacheLoading: true, clientCacheError: null });
        try {
            const cache = await getClientCache();

            // Validate cache has required data (agents array means we're authorized)
            if (!cache || !cache.agents || !Array.isArray(cache.agents)) {
                console.error(
                    "Invalid ClientCache response (no agents - token likely expired):",
                    cache
                );

                // Token is likely expired/invalid. Try to refresh it.
                const { refreshToken } = await import(
                    "@/services/auth/authService"
                );
                const { config } = useConfigStore.getState();

                const refreshSuccess = await refreshToken({
                    authServer: config.authServer,
                    clientId: config.clientId,
                    redirectUri: config.redirectUri,
                });

                if (refreshSuccess) {
                    // Retry loading ClientCache with new token
                    const retryCache = await getClientCache();

                    if (
                        !retryCache ||
                        !retryCache.agents ||
                        !Array.isArray(retryCache.agents)
                    ) {
                        // Still no agents after refresh - clear tokens and force re-login
                        console.error(
                            "ClientCache still invalid after token refresh, forcing re-login"
                        );
                        const { logout } = await import(
                            "@/services/auth/authService"
                        );
                        logout();
                        return;
                    }

                    // Success! Continue with the retry cache
                    return get().loadClientCacheInternal(retryCache);
                } else {
                    // Token refresh failed - clear tokens and force re-login
                    console.error("Token refresh failed, forcing re-login");
                    const { logout } = await import(
                        "@/services/auth/authService"
                    );
                    logout();
                    return;
                }
            }

            // Process the valid cache
            get().loadClientCacheInternal(cache);
        } catch (error) {
            console.error("Failed to load client cache:", error);
            set({
                clientCacheError:
                    error instanceof Error
                        ? error.message
                        : "Failed to load client cache",
                clientCacheLoading: false,
            });
        }
    },

    // Set Selected Ticket Area
    setSelectedTicketArea: (ticketAreaId) => {
        set({
            selectedTicketAreaId: ticketAreaId,
            viewLists: [],
            selectedListIds: [],
            haloTickets: [],
            ticketsByList: new Map(),
            currentPage: 1,
        });

        // Automatically load view lists for the new area
        get().loadViewLists(ticketAreaId);
    },

    // Load View Lists
    loadViewLists: async (ticketAreaId) => {
        set({ viewListsLoading: true, viewListsError: null });
        try {
            const lists = await getViewLists(ticketAreaId, getUtcOffset());
            set({
                viewLists: lists,
                viewListsLoading: false,
            });
        } catch (error) {
            console.error("Failed to load view lists:", error);
            set({
                viewListsError:
                    error instanceof Error
                        ? error.message
                        : "Failed to load view lists",
                viewListsLoading: false,
            });
        }
    },

    // Select Lists
    selectLists: (listIds) => {
        set({ selectedListIds: listIds, currentPage: 1 });

        // Automatically load tickets for the new selection
        if (listIds.length > 0) {
            get().loadTicketsForLists(listIds, 1);
        } else {
            set({ haloTickets: [], ticketsByList: new Map(), totalRecords: 0 });
        }
    },

    // Toggle List Selection
    toggleListSelection: (listId) => {
        const state = get();
        const currentIds = state.selectedListIds;
        const newIds = currentIds.includes(listId)
            ? currentIds.filter((id) => id !== listId)
            : [...currentIds, listId];

        state.selectLists(newIds);
    },

    // Load Tickets for Lists
    loadTicketsForLists: async (listIds?: number[], page?: number, isRefresh = false) => {
        const state = get();
        const listsToLoad = listIds || state.selectedListIds;
        const pageToLoad = page !== undefined ? page : state.currentPage;

        if (listsToLoad.length === 0 || !state.selectedTicketAreaId) {
            console.warn(
                "Cannot load tickets: no lists selected or no ticket area selected"
            );
            return;
        }

        // Use ticketsRefreshing for background refreshes, ticketsLoading for initial load
        if (isRefresh) {
            set({ ticketsRefreshing: true, ticketsError: null });
        } else {
            set({ ticketsLoading: true, ticketsError: null });
        }

        try {
            // Fetch tickets for each list separately
            const ticketPromises = listsToLoad.map((listId) =>
                getTickets(
                    listId,
                    state.selectedTicketAreaId!,
                    pageToLoad,
                    state.pageSize,
                    undefined,
                    getUtcOffset()
                ).then((response) => ({
                    listId,
                    tickets: response.tickets,
                    recordCount: response.record_count,
                }))
            );

            const results = await Promise.all(ticketPromises);

            // Store tickets by list
            const newTicketsByList = new Map<number, HaloTicket[]>();
            let totalCount = 0;

            results.forEach(({ listId, tickets, recordCount }) => {
                newTicketsByList.set(listId, tickets);
                totalCount += recordCount;
            });

            // Merge all tickets and add list information
            const allTickets = results.flatMap(({ listId, tickets }) => {
                const list = state.viewLists.find((l) => l.id === listId);
                return tickets.map((ticket) => ({
                    ...ticket,
                    _listId: listId,
                    _listName: list?.name || `List ${listId}`,
                }));
            });

            // Enrich tickets with lookup data
            const enrichedTickets = allTickets.map((ticket) =>
                enrichTicket(ticket, state.clientCache)
            );

            set({
                ticketsByList: newTicketsByList,
                haloTickets: enrichedTickets,
                totalRecords: totalCount,
                ticketsLoading: false,
                ticketsRefreshing: false,
                lastRefreshTime: new Date(),
            });
        } catch (error) {
            console.error("Failed to load tickets:", error);
            set({
                ticketsError:
                    error instanceof Error
                        ? error.message
                        : "Failed to load tickets",
                ticketsLoading: false,
                ticketsRefreshing: false,
            });
        }
    },

    // Refresh Tickets
    refreshTickets: async () => {
        const state = get();
        await state.loadTicketsForLists(
            state.selectedListIds,
            state.currentPage,
            true // isRefresh - don't show loading spinner
        );
    },

    // Set Page
    setPage: (page) => {
        set({ currentPage: page });
        get().loadTicketsForLists(undefined, page);
    },

    // Set Page Size
    setPageSize: (size) => {
        set({ pageSize: size, currentPage: 1 });
        get().loadTicketsForLists(undefined, 1);
    },

    // Toggle Auto-refresh
    toggleAutoRefresh: () => {
        set((state) => ({ autoRefreshEnabled: !state.autoRefreshEnabled }));
    },

    // Set Auto-refresh Interval
    setAutoRefreshInterval: (interval) => {
        set({ autoRefreshInterval: interval });
    },

    // Set Critical API Error
    setCriticalApiError: (message, details) => {
        set({
            criticalApiError: {
                message,
                details,
                timestamp: new Date(),
            },
            // Disable auto-refresh when there's a critical error
            autoRefreshEnabled: false,
        });
    },

    // Clear Critical API Error
    clearCriticalApiError: () => {
        set({ criticalApiError: null });
    },

    // Retry After Error
    retryAfterError: async () => {
        const state = get();

        // Clear the error state and reset the API client flag
        set({ criticalApiError: null });

        // Reset the critical error flag in the API client
        const { resetCriticalErrorFlag } = await import("@/lib/api-client");
        resetCriticalErrorFlag();

        // Reload client cache if it failed
        if (!state.clientCache && !state.clientCacheLoading) {
            state.loadClientCache();
        }

        // Reload tickets if we had lists selected
        if (state.selectedListIds.length > 0 && !state.ticketsLoading) {
            state.loadTicketsForLists();
        }
    },

    // ===== Appointment Actions =====

    // Load Appointment Types
    loadAppointmentTypes: async () => {
        set({ appointmentTypesLoading: true });
        try {
            const types = await getAppointmentTypes();
            set({
                appointmentTypes: types,
                appointmentTypesLoading: false,
            });
        } catch (error) {
            console.error("Failed to load appointment types:", error);
            set({
                appointmentTypesLoading: false,
            });
        }
    },

    // Load Appointments
    loadAppointments: async (startDate: Date, endDate: Date) => {
        const state = get();

        // Get selected agent IDs
        const visibleAgents = state.getVisibleAgents();

        const agentIds = visibleAgents.map((agent) => agent.id);

        if (agentIds.length === 0) {
            console.warn("⚠️ No agents selected, skipping appointment load");
            set({ appointments: [] });
            return;
        }

        set({ appointmentsLoading: true, appointmentsError: null });

        try {
            const haloAppointments = await getAppointments(
                startDate.toISOString(),
                endDate.toISOString(),
                agentIds
            );

            // Map HaloAppointment to Appointment
            const appointments: Appointment[] = haloAppointments.map(
                (haloApt) => {
                    // Appointments come in UTC, ensure they're properly converted to local time
                    // If the date string doesn't have 'Z' suffix, append it to indicate UTC
                    const startDateStr = haloApt.start_date.endsWith("Z")
                        ? haloApt.start_date
                        : `${haloApt.start_date}Z`;
                    const endDateStr = haloApt.end_date.endsWith("Z")
                        ? haloApt.end_date
                        : `${haloApt.end_date}Z`;

                    const startTime = new Date(startDateStr);
                    const endTime = new Date(endDateStr);

                    // Determine status based on complete_status
                    let status: AppointmentStatus = "scheduled";
                    if (haloApt.complete_status === 0) {
                        status = "completed";
                    } else if (haloApt.status === 1) {
                        status = "in_progress";
                    }

                    // Determine color (grey if completed, otherwise use appointment color)
                    const colour =
                        status === "completed" ? "#9ca3af" : haloApt.colour;

                    return {
                        id: haloApt.id.toString(),
                        ticketId: haloApt.ticket_id?.toString() || "",
                        agentId: haloApt.agent_id,
                        startTime,
                        endTime,
                        status,
                        isAllDay: haloApt.allday,
                        isTentative: false,
                        notes: haloApt.note || "",
                        createdAt: haloApt.last_modified
                            ? new Date(haloApt.last_modified)
                            : startTime,
                        updatedAt: haloApt.last_modified
                            ? new Date(haloApt.last_modified)
                            : startTime,

                        // Halo-specific fields
                        subject: haloApt.subject,
                        colour,
                        complete_status: haloApt.complete_status,
                        client_name: haloApt.client_name,
                        site_name: haloApt.site_name,
                        user_name: haloApt.user_name,
                        appointment_type_name: haloApt.appointment_type_name,
                        canUpdate: haloApt._canupdate,
                        canDelete: haloApt._candelete,
                        canComplete: haloApt._cancomplete,
                    };
                }
            );

            set({
                haloAppointments,
                appointments,
                appointmentsLoading: false,
            });
        } catch (error) {
            set({
                appointmentsError:
                    error instanceof Error
                        ? error.message
                        : "Failed to load appointments",
                appointmentsLoading: false,
            });
        }
    },

    // Start auto-refresh for appointments
    startAppointmentAutoRefresh: () => {
        // Clear any existing interval
        const state = get();
        if (state.appointmentRefreshInterval) {
            clearInterval(state.appointmentRefreshInterval);
        }

        // Set up new interval (refresh every 3 minutes)
        const interval = setInterval(() => {
            const currentState = get();

            // Calculate date range based on current view
            let startDate: Date;
            let endDate: Date;

            if (currentState.calendarView === "day") {
                // Day view: load just today
                startDate = new Date(currentState.selectedDate);
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date(startDate);
                endDate.setHours(23, 59, 59, 999);
            } else if (
                currentState.calendarView === "week5" ||
                currentState.calendarView === "week7"
            ) {
                // Week view: load from Monday of the current week
                const daysToShow =
                    currentState.calendarView === "week5" ? 5 : 7;
                startDate = new Date(currentState.selectedDate);
                // Get to Monday (day 1)
                const day = startDate.getDay();
                const diff = day === 0 ? -6 : 1 - day; // If Sunday, go back 6 days, else go to Monday
                startDate.setDate(startDate.getDate() + diff);
                startDate.setHours(0, 0, 0, 0);

                endDate = new Date(startDate);
                endDate.setDate(endDate.getDate() + daysToShow);
                endDate.setHours(0, 0, 0, 0);
            } else {
                // Month view or default: load week range from start of week
                startDate = new Date(currentState.selectedDate);
                const day = startDate.getDay();
                const diff = day === 0 ? -6 : 1 - day;
                startDate.setDate(startDate.getDate() + diff);
                startDate.setHours(0, 0, 0, 0);

                endDate = new Date(startDate);
                endDate.setDate(endDate.getDate() + 7);
                endDate.setHours(0, 0, 0, 0);
            }

            currentState.loadAppointments(startDate, endDate);
        }, 3 * 60 * 1000); // 3 minutes

        // Store interval ID on the state object
        set({ appointmentRefreshInterval: interval });
    },

    // Stop auto-refresh for appointments
    stopAppointmentAutoRefresh: () => {
        const state = get();
        if (state.appointmentRefreshInterval) {
            clearInterval(state.appointmentRefreshInterval);
            set({ appointmentRefreshInterval: null });
        }
    },
}));
