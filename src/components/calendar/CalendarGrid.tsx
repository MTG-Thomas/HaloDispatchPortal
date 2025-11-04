import { useEffect } from 'react';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { useTimeslotSelection } from '@/hooks/useTimeslotSelection';
import { DayView } from './views/DayView';
import { WeekView } from './views/WeekView';
import { MonthView } from './views/MonthView';

export function CalendarGrid() {
  const { calendarView, loadAppointmentTypes, startAppointmentAutoRefresh } = useDispatchStore();
  const { clearSelection } = useTimeslotSelection();

  // Initialize appointment types and auto-refresh on mount
  useEffect(() => {
    // Load appointment types once
    loadAppointmentTypes();

    // Start auto-refresh for appointments
    startAppointmentAutoRefresh();
  }, [loadAppointmentTypes, startAppointmentAutoRefresh]);

  // Add keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape key clears selection
      if (e.key === 'Escape') {
        clearSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearSelection]);

  return (
    <div className="flex-1 overflow-auto bg-background">
      {calendarView === 'day' && <DayView />}
      {(calendarView === 'week5' || calendarView === 'week7') && <WeekView />}
      {calendarView === 'month' && <MonthView />}
    </div>
  );
}
