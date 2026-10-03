import type { StateCreator } from "zustand";
import { resetCriticalErrorFlag } from "@/lib/api-client";
import type { DispatchState } from "../useDispatchStore";

export interface StatusSlice {
    isInitialLoad: boolean;
    criticalApiError: {
        message: string;
        details?: string;
        timestamp: Date;
    } | null;
    completeInitialLoad: () => void;
    setCriticalApiError: (message: string, details?: string) => void;
    clearCriticalApiError: () => void;
    retryAfterError: () => void;
}

export const createStatusSlice: StateCreator<
    DispatchState,
    [],
    [],
    StatusSlice
> = (set, get) => ({
    isInitialLoad: true,
    criticalApiError: null,

    completeInitialLoad: () => {
        set({ isInitialLoad: false });
    },

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

    clearCriticalApiError: () => {
        set({ criticalApiError: null });
    },

    retryAfterError: async () => {
        const state = get();

        // Clear the error state and reset the API client flag
        set({ criticalApiError: null });

        // Reset the critical error flag in the API client
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
});
