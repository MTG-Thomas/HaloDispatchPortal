import type { StateCreator } from "zustand";
import type { CalendarView } from "@/types";
import type { DispatchState } from "../useDispatchStore";

export interface CalendarSlice {
    calendarView: CalendarView;
    selectedDate: Date;
    setCalendarView: (view: CalendarView) => void;
    setSelectedDate: (date: Date) => void;
}

export const createCalendarSlice: StateCreator<
    DispatchState,
    [],
    [],
    CalendarSlice
> = (set) => ({
    calendarView: "week5",
    selectedDate: new Date(),

    setCalendarView: (view) => set({ calendarView: view }),
    setSelectedDate: (date) => set({ selectedDate: date }),
});
