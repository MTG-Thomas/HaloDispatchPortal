import type { StateCreator } from "zustand";
import { isAbortError } from "@/lib/api-client";
import { getTickets, getUtcOffset } from "@/services/halo-api";
import { enrichTicket } from "@/utils/enrich-ticket";
import { DEFAULT_PAGE_SIZE, TICKET_AUTO_REFRESH_INTERVAL_MS } from "@/lib/constants";
import { logger } from "@/lib/logger";
import type { Ticket as HaloTicket, EnrichedTicket } from "@/types/halo";
import type { DispatchState } from "../useDispatchStore";

export interface TicketsSlice {
    haloTickets: EnrichedTicket[];
    ticketsByList: Map<number, HaloTicket[]>;
    ticketsLoading: boolean;
    ticketsRefreshing: boolean;
    ticketsError: string | null;
    currentPage: number;
    pageSize: number;
    totalRecords: number;
    autoRefreshEnabled: boolean;
    autoRefreshInterval: number;
    lastRefreshTime: Date | null;
    loadTicketsForLists: (listIds?: number[], page?: number, isRefresh?: boolean) => Promise<void>;
    refreshTickets: () => Promise<void>;
    setPage: (page: number) => void;
    setPageSize: (size: number) => void;
    toggleAutoRefresh: () => void;
    setAutoRefreshInterval: (interval: number) => void;
}

/**
 * In-flight ticket load. A new load aborts the previous one so rapid
 * list/page changes cannot resolve out of order and show stale tickets.
 */
let ticketsLoadController: AbortController | null = null;

export function cancelTicketsLoad(): void {
    ticketsLoadController?.abort();
    ticketsLoadController = null;
}

export const createTicketsSlice: StateCreator<DispatchState, [], [], TicketsSlice> = (
    set,
    get,
) => ({
    haloTickets: [],
    ticketsByList: new Map(),
    ticketsLoading: false,
    ticketsRefreshing: false,
    ticketsError: null,
    currentPage: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    totalRecords: 0,
    autoRefreshEnabled: false,
    autoRefreshInterval: TICKET_AUTO_REFRESH_INTERVAL_MS,
    lastRefreshTime: null,

    loadTicketsForLists: async (listIds?: number[], page?: number, isRefresh = false) => {
        const state = get();
        const listsToLoad = listIds || state.selectedListIds;
        const pageToLoad = page !== undefined ? page : state.currentPage;

        if (listsToLoad.length === 0 || !state.selectedTicketAreaId) {
            logger.warn("Cannot load tickets: no lists selected or no ticket area selected");
            return;
        }

        // Cancel any in-flight load so only the latest request resolves.
        ticketsLoadController?.abort();
        const controller = new AbortController();
        ticketsLoadController = controller;
        const signal = controller.signal;

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
                    getUtcOffset(),
                    { signal },
                ).then((response) => ({
                    listId,
                    tickets: response.tickets,
                    recordCount: response.record_count,
                })),
            );

            const results = await Promise.all(ticketPromises);

            // Store tickets by list
            const newTicketsByList = new Map<number, HaloTicket[]>();

            results.forEach(({ listId, tickets }) => {
                newTicketsByList.set(listId, tickets);
            });

            // Merge all tickets and deduplicate by ticket ID
            const ticketMap = new Map<
                number,
                {
                    ticket: HaloTicket;
                    listIds: number[];
                    listNames: string[];
                }
            >();

            results.forEach(({ listId, tickets }) => {
                const list = state.viewLists.find((l) => l.id === listId);
                const listName = list?.name || `List ${listId}`;

                tickets.forEach((ticket) => {
                    const existing = ticketMap.get(ticket.id);
                    if (existing) {
                        // Ticket already exists, add this list to it
                        if (!existing.listIds.includes(listId)) {
                            existing.listIds.push(listId);
                            existing.listNames.push(listName);
                        }
                    } else {
                        // New ticket
                        ticketMap.set(ticket.id, {
                            ticket,
                            listIds: [listId],
                            listNames: [listName],
                        });
                    }
                });
            });

            // Convert map to array and add combined list information
            const allTickets = Array.from(ticketMap.values()).map(
                ({ ticket, listIds, listNames }) => ({
                    ...ticket,
                    _listId: listIds[0], // Use first list ID for compatibility
                    _listName: listNames.join(", "), // Comma-separated list names
                }),
            );

            // Enrich tickets with lookup data
            const enrichedTickets = allTickets.map((ticket) =>
                enrichTicket(ticket, state.clientCache),
            );

            set({
                ticketsByList: newTicketsByList,
                haloTickets: enrichedTickets,
                totalRecords: enrichedTickets.length, // Use deduplicated count
                ticketsLoading: false,
                ticketsRefreshing: false,
                lastRefreshTime: new Date(),
            });
        } catch (error) {
            if (isAbortError(error) || signal.aborted) {
                // Superseded by a newer load: clear spinners (unless a newer
                // load owns them now), keep old data.
                if (ticketsLoadController === controller || ticketsLoadController === null) {
                    set({ ticketsLoading: false, ticketsRefreshing: false });
                }
                return;
            }
            logger.error("Failed to load tickets:", error);
            set({
                ticketsError: error instanceof Error ? error.message : "Failed to load tickets",
                ticketsLoading: false,
                ticketsRefreshing: false,
            });
        } finally {
            if (ticketsLoadController === controller) {
                ticketsLoadController = null;
            }
        }
    },

    refreshTickets: async () => {
        const state = get();
        await state.loadTicketsForLists(
            state.selectedListIds,
            state.currentPage,
            true, // isRefresh - don't show loading spinner
        );
    },

    setPage: (page) => {
        set({ currentPage: page });
        get().loadTicketsForLists(undefined, page);
    },

    setPageSize: (size) => {
        set({ pageSize: size, currentPage: 1 });
        get().loadTicketsForLists(undefined, 1);
    },

    toggleAutoRefresh: () => {
        set((state) => ({ autoRefreshEnabled: !state.autoRefreshEnabled }));
    },

    setAutoRefreshInterval: (interval) => {
        set({ autoRefreshInterval: interval });
    },
});
