import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, addMonths, addWeeks, subDays, subMonths, subWeeks } from "date-fns";
import { useDispatchStore } from "@/stores/useDispatchStore";
import { useTimeslotSelection } from "@/hooks/useTimeslotSelection";
import { resolveCalendarShortcut } from "@/lib/shortcuts";
import { getViewDateRange } from "@/lib/dates";
import { DayView } from "./views/DayView";
import { WeekView } from "./views/WeekView";
import { MonthView } from "./views/MonthView";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsHelp } from "./ShortcutsHelp";
import type { PaletteContext } from "./paletteActions";

function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

export function CalendarGrid() {
    const {
        calendarView,
        selectedDate,
        setCalendarView,
        setSelectedDate,
        appointmentsLoading,
        loadAppointments,
        loadAppointmentTypes,
        startAppointmentAutoRefresh,
    } = useDispatchStore();
    const { clearSelection } = useTimeslotSelection();
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);

    // Initialize appointment types and auto-refresh on mount
    useEffect(() => {
        // Load appointment types once
        loadAppointmentTypes();

        // Start auto-refresh for appointments
        startAppointmentAutoRefresh();
    }, [loadAppointmentTypes, startAppointmentAutoRefresh]);

    const goPrevious = useCallback(() => {
        switch (calendarView) {
            case "day":
                setSelectedDate(subDays(selectedDate, 1));
                break;
            case "week5":
            case "week7":
                setSelectedDate(subWeeks(selectedDate, 1));
                break;
            case "month":
                setSelectedDate(subMonths(selectedDate, 1));
                break;
        }
    }, [calendarView, selectedDate, setSelectedDate]);

    const goNext = useCallback(() => {
        switch (calendarView) {
            case "day":
                setSelectedDate(addDays(selectedDate, 1));
                break;
            case "week5":
            case "week7":
                setSelectedDate(addWeeks(selectedDate, 1));
                break;
            case "month":
                setSelectedDate(addMonths(selectedDate, 1));
                break;
        }
    }, [calendarView, selectedDate, setSelectedDate]);

    const refresh = useCallback(() => {
        if (appointmentsLoading) return;
        const { startDate, endDate } = getViewDateRange(calendarView, selectedDate);
        void loadAppointments(startDate, endDate);
    }, [appointmentsLoading, calendarView, selectedDate, loadAppointments]);

    const paletteContext: PaletteContext = useMemo(
        () => ({
            currentView: calendarView,
            goToday: () => setSelectedDate(new Date()),
            goPrevious,
            goNext,
            setView: setCalendarView,
            refresh,
            openHelp: () => setHelpOpen(true),
        }),
        [calendarView, setSelectedDate, goPrevious, goNext, setCalendarView, refresh],
    );

    // Keyboard shortcuts (Escape behavior retained: clear slot selection)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const action = resolveCalendarShortcut({
                key: e.key,
                metaKey: e.metaKey,
                ctrlKey: e.ctrlKey,
                inEditable: isEditableTarget(e.target),
            });
            if (!action) return;

            switch (action.kind) {
                case "clear-selection":
                    // Don't preventDefault: dialogs and inputs still need Escape.
                    clearSelection();
                    return;
                case "today":
                    setSelectedDate(new Date());
                    break;
                case "previous":
                    goPrevious();
                    break;
                case "next":
                    goNext();
                    break;
                case "view":
                    setCalendarView(action.view);
                    break;
                case "focus-search":
                    document.getElementById("ticket-search-input")?.focus();
                    break;
                case "refresh":
                    refresh();
                    break;
                case "help":
                    setHelpOpen((open) => !open);
                    break;
                case "palette":
                    setPaletteOpen((open) => !open);
                    break;
            }
            e.preventDefault();
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [clearSelection, setSelectedDate, goPrevious, goNext, setCalendarView, refresh]);

    return (
        <div className="flex-1 overflow-auto bg-background">
            {calendarView === "day" && <DayView />}
            {(calendarView === "week5" || calendarView === "week7") && <WeekView />}
            {calendarView === "month" && <MonthView />}
            <CommandPalette
                open={paletteOpen}
                onOpenChange={setPaletteOpen}
                context={paletteContext}
            />
            <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
        </div>
    );
}
