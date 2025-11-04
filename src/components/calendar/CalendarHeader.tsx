import { format, addDays, subDays, startOfWeek, endOfWeek, addWeeks, subWeeks, addMonths, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Moon, Sun, LogOut, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { TicketAreaSelector } from '@/components/halo/TicketAreaSelector';
import { ListCombobox } from '@/components/halo/ListCombobox';
import { AgentTeamCombobox } from './AgentTeamCombobox';
import { cn } from '@/lib/utils';
import type { CalendarView } from '@/types';

export function CalendarHeader() {
  const { calendarView, selectedDate, setCalendarView, setSelectedDate, selectedTicketAreaId, appointmentsLoading, loadAppointments } = useDispatchStore();
  const { theme, toggleTheme } = useTheme();
  const { logout } = useAuth();

  const navigatePrevious = () => {
    switch (calendarView) {
      case 'day':
        setSelectedDate(subDays(selectedDate, 1));
        break;
      case 'week5':
      case 'week7':
        setSelectedDate(subWeeks(selectedDate, 1));
        break;
      case 'month':
        setSelectedDate(subMonths(selectedDate, 1));
        break;
    }
  };

  const navigateNext = () => {
    switch (calendarView) {
      case 'day':
        setSelectedDate(addDays(selectedDate, 1));
        break;
      case 'week5':
      case 'week7':
        setSelectedDate(addWeeks(selectedDate, 1));
        break;
      case 'month':
        setSelectedDate(addMonths(selectedDate, 1));
        break;
    }
  };

  const handleToday = () => {
    setSelectedDate(new Date());
  };

  const getDateRangeText = () => {
    switch (calendarView) {
      case 'day':
        return format(selectedDate, 'MMMM d, yyyy');
      case 'week5':
      case 'week7': {
        const start = startOfWeek(selectedDate, { weekStartsOn: 1 });
        const end = endOfWeek(selectedDate, { weekStartsOn: 1 });
        return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`;
      }
      case 'month':
        return format(selectedDate, 'MMMM yyyy');
    }
  };

  const handleRefreshAppointments = async () => {
    if (appointmentsLoading) return;

    // Calculate date range based on current view
    let startDate: Date;
    let endDate: Date;

    switch (calendarView) {
      case 'day':
        startDate = selectedDate;
        endDate = selectedDate;
        break;
      case 'week5':
      case 'week7': {
        startDate = startOfWeek(selectedDate, { weekStartsOn: 1 });
        endDate = endOfWeek(selectedDate, { weekStartsOn: 1 });
        break;
      }
      case 'month': {
        startDate = startOfMonth(selectedDate);
        endDate = endOfMonth(selectedDate);
        break;
      }
    }

    await loadAppointments(startDate, endDate);
  };

  return (
    <div className="border-b bg-card p-4 space-y-4">
      {/* Top Row: Navigation and View Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Date Navigation */}
          <Button
            variant="outline"
            size="icon"
            onClick={navigatePrevious}
            aria-label="Previous"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={navigateNext}
            aria-label="Next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          <Button variant="outline" onClick={handleToday}>
            Today
          </Button>

          <div className="flex items-center gap-2 px-3 text-sm font-medium">
            <CalendarIcon className="h-4 w-4" />
            {getDateRangeText()}
          </div>
        </div>

        {/* View Switcher and Actions */}
        <div className="flex items-center gap-2">
          <Tabs value={calendarView} onValueChange={(v) => setCalendarView(v as CalendarView)}>
            <TabsList>
              <TabsTrigger value="day">Day</TabsTrigger>
              <TabsTrigger value="week5">Week (5)</TabsTrigger>
              <TabsTrigger value="week7">Week (7)</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Dark Mode Toggle */}
          <Button
            variant="outline"
            size="icon"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </Button>

          {/* Logout Button */}
          <Button
            variant="outline"
            size="icon"
            onClick={logout}
            aria-label="Logout"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Bottom Row: Ticket Area, Lists, Agents/Teams */}
      <div className="flex items-center gap-3">
        <TicketAreaSelector />
        {selectedTicketAreaId && (
          <>
            <div className="h-6 w-px bg-border" />
            <ListCombobox />
          </>
        )}
        <div className="h-6 w-px bg-border" />
        <AgentTeamCombobox />
        <div className="flex-1" />
        <Button
          variant="outline"
          size="icon"
          onClick={handleRefreshAppointments}
          disabled={appointmentsLoading}
          className="h-8 w-8"
          title="Refresh appointments"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', appointmentsLoading && 'animate-spin')} />
        </Button>
      </div>
    </div>
  );
}
