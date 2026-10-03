import type { StateCreator } from "zustand";
import { isAbortError } from "@/lib/api-client";
import { getViewLists, getUtcOffset } from "@/services/halo-api";
import { logger } from "@/lib/logger";
import type { ViewList } from "@/types/halo";
import type { DispatchState } from "../useDispatchStore";
import { readLegacySelection } from "../legacy-selection";
import { cancelTicketsLoad } from "./ticketsSlice";

export interface ListsSlice {
    selectedTicketAreaId: number | null;
    viewLists: ViewList[];
    selectedListIds: number[];
    viewListsLoading: boolean;
    viewListsError: string | null;
    setSelectedTicketArea: (ticketAreaId: number) => void;
    loadViewLists: (ticketAreaId: number) => Promise<void>;
    selectLists: (listIds: number[]) => void;
    toggleListSelection: (listId: number) => void;
}

/**
 * In-flight view-list load. Area switches abort the previous load so a slow
 * response for the old area cannot overwrite the new one.
 */
let viewListsLoadController: AbortController | null = null;

export function cancelViewListsLoad(): void {
    viewListsLoadController?.abort();
    viewListsLoadController = null;
}

export const createListsSlice: StateCreator<DispatchState, [], [], ListsSlice> = (set, get) => {
    // Seed from legacy manual-localStorage keys on first run; the persisted
    // selection overwrites these on rehydrate when it exists.
    const legacy = readLegacySelection();

    return {
        selectedTicketAreaId: legacy.selectedTicketAreaId,
        viewLists: [],
        selectedListIds: legacy.selectedListIds,
        viewListsLoading: false,
        viewListsError: null,

        setSelectedTicketArea: (ticketAreaId) => {
            // Stop any in-flight ticket load first so it can't restore
            // results for the previous area after the reset below.
            cancelTicketsLoad();
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

        loadViewLists: async (ticketAreaId) => {
            viewListsLoadController?.abort();
            const controller = new AbortController();
            viewListsLoadController = controller;
            const signal = controller.signal;

            set({ viewListsLoading: true, viewListsError: null });
            try {
                const lists = await getViewLists(ticketAreaId, getUtcOffset(), {
                    signal,
                });
                if (signal.aborted) {
                    if (
                        viewListsLoadController === controller ||
                        viewListsLoadController === null
                    ) {
                        set({ viewListsLoading: false });
                    }
                    return;
                }
                set({
                    viewLists: lists,
                    viewListsLoading: false,
                });
            } catch (error) {
                if (isAbortError(error) || signal.aborted) {
                    if (
                        viewListsLoadController === controller ||
                        viewListsLoadController === null
                    ) {
                        set({ viewListsLoading: false });
                    }
                    return;
                }
                logger.error("Failed to load view lists:", error);
                set({
                    viewListsError:
                        error instanceof Error ? error.message : "Failed to load view lists",
                    viewListsLoading: false,
                });
            } finally {
                if (viewListsLoadController === controller) {
                    viewListsLoadController = null;
                }
            }
        },

        selectLists: (listIds) => {
            set({ selectedListIds: listIds, currentPage: 1 });

            // Automatically load tickets for the new selection
            if (listIds.length > 0) {
                get().loadTicketsForLists(listIds, 1);
            } else {
                cancelTicketsLoad();
                set({
                    haloTickets: [],
                    ticketsByList: new Map(),
                    totalRecords: 0,
                });
            }
        },

        toggleListSelection: (listId) => {
            const state = get();
            const currentIds = state.selectedListIds;
            const newIds = currentIds.includes(listId)
                ? currentIds.filter((id) => id !== listId)
                : [...currentIds, listId];

            state.selectLists(newIds);
        },
    };
};
