import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SELECTION_STORAGE_KEY } from "@/lib/constants";
import { createCalendarSlice, type CalendarSlice } from "./slices/calendarSlice";
import {
    createReferenceSlice,
    type ReferenceSlice,
} from "./slices/referenceSlice";
import { createListsSlice, type ListsSlice } from "./slices/listsSlice";
import { createTicketsSlice, type TicketsSlice } from "./slices/ticketsSlice";
import {
    createAppointmentsSlice,
    type AppointmentsSlice,
} from "./slices/appointmentsSlice";
import { createStatusSlice, type StatusSlice } from "./slices/statusSlice";

export type DispatchState = CalendarSlice &
    ReferenceSlice &
    ListsSlice &
    TicketsSlice &
    AppointmentsSlice &
    StatusSlice;

/**
 * Dispatch store: domain slices composed into one zustand store.
 *
 * Only the ticket-area/list selection is persisted (single persist —
 * replaces the three manual localStorage readers/writers that used to live
 * in DispatchView, TicketAreaSelector, ListSelector, and ListCombobox).
 * Everything else is session state reloaded from Halo on mount.
 */
export const useDispatchStore = create<DispatchState>()(
    persist(
        (set, get, api) => ({
            ...createCalendarSlice(set, get, api),
            ...createReferenceSlice(set, get, api),
            ...createListsSlice(set, get, api),
            ...createTicketsSlice(set, get, api),
            ...createAppointmentsSlice(set, get, api),
            ...createStatusSlice(set, get, api),
        }),
        {
            name: SELECTION_STORAGE_KEY,
            partialize: (state) => ({
                selectedTicketAreaId: state.selectedTicketAreaId,
                selectedListIds: state.selectedListIds,
            }),
        }
    )
);
