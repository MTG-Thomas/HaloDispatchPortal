import { useEffect, useState } from 'react';
import { startOfWeek, addDays, format, isSameDay } from 'date-fns';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { UtilizationBar } from '../UtilizationBar';
import { CalendarColumn } from '../CalendarColumn';
import { TimeLabelsColumn } from '../TimeLabelsColumn';
import { cn } from '@/lib/utils';
import { DEFAULT_CALENDAR_CONFIG } from '@/lib/calendarConfig';

export function WeekView() {
  // Shared heights for all columns
  const [allDayHeight, setAllDayHeight] = useState(40);
  const [beforeHoursHeight, setBeforeHoursHeight] = useState(64);
  const [afterHoursHeight, setAfterHoursHeight] = useState(64);
  const {
    calendarView,
    selectedDate,
    getVisibleAgents,
    getAppointmentsForDateRange,
    loadAppointments,
  } = useDispatchStore();

  const selectedResources = usePreferencesStore((state) => state.selectedResources);

  const visibleAgents = getVisibleAgents();
  const daysToShow = calendarView === 'week5' ? 5 : 7;
  const config = DEFAULT_CALENDAR_CONFIG;

  // Get week start (Monday)
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const days = Array.from({ length: daysToShow }, (_, i) => addDays(weekStart, i));

  // Get appointments for this week
  const weekEnd = addDays(weekStart, daysToShow);
  const appointments = getAppointmentsForDateRange(weekStart, weekEnd);

  // Load appointments when date range or visible agents change
  useEffect(() => {
    if (visibleAgents.length === 0) {
      console.log('📅 WeekView: Skipping appointment load - no agents selected');
      return;
    }
    console.log('📅 WeekView: Loading appointments for range', weekStart.toISOString(), 'to', weekEnd.toISOString());
    console.log('📅 WeekView: Visible agents:', visibleAgents.length, visibleAgents.map(a => a.id));
    loadAppointments(weekStart, weekEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart.getTime(), weekEnd.getTime(), selectedResources]);

  // Helper to get appointments for a specific agent and day
  const getAppointmentsForAgentAndDay = (agentId: string, day: Date) => {
    return appointments.filter((apt) => {
      if (apt.agentId !== agentId) return false;

      // Check if appointment falls on this day (handles multi-day appointments)
      const dayStart = new Date(day);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(day);
      dayEnd.setHours(23, 59, 59, 999);

      // Appointment overlaps with this day if it starts before day ends and ends after day starts
      return apt.startTime <= dayEnd && apt.endTime >= dayStart;
    });
  };

  // Check if any appointments exist in before/after hours for any day
  const hasBeforeHours = (agentId: string) => {
    return days.some((day) => {
      const dayAppointments = getAppointmentsForAgentAndDay(agentId, day);
      return dayAppointments.some(
        (apt) => !apt.isAllDay && apt.startTime.getHours() < config.dayStartHour
      );
    });
  };

  const hasAfterHours = (agentId: string) => {
    return days.some((day) => {
      const dayAppointments = getAppointmentsForAgentAndDay(agentId, day);
      return dayAppointments.some((apt) => {
        if (apt.isAllDay) return false;
        const endHour = apt.endTime.getHours();
        const endMinute = apt.endTime.getMinutes();
        return endHour >= config.dayEndHour || (endHour === config.dayEndHour - 1 && endMinute > 45);
      });
    });
  };

  if (visibleAgents.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No agents selected. Please select agents or teams to view their schedules.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="min-w-[1000px]">
        {/* Header Row - Days */}
        <div className="sticky top-0 z-20 bg-card border-b flex">
          {/* Agent/Resource Column Header */}
          <div className="w-48 border-r p-2 bg-muted font-medium text-sm flex items-center">
            Agent / Resource
          </div>
          {/* Day Headers */}
          {days.map((day) => (
            <div
              key={day.toISOString()}
              className={cn(
                'flex-1 border-r p-2 text-center',
                isSameDay(day, new Date()) && 'bg-primary/5'
              )}
            >
              <div className="font-medium">{format(day, 'EEE')}</div>
              <div className="text-sm text-muted-foreground">{format(day, 'M/d')}</div>
            </div>
          ))}
        </div>

        {/* Agent Rows */}
        {visibleAgents.map((agent) => (
          <div key={agent.id} className="border-b">
            {/* Agent Name and Utilization Row */}
            <div className="flex border-b bg-muted/30">
              {/* Agent Info Column */}
              <div className="w-48 border-r p-2 flex items-center gap-2">
                <div
                  className="h-3 w-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: agent.color }}
                />
                <span className="text-sm font-medium truncate">{agent.name}</span>
              </div>
              {/* Utilization Columns */}
              {days.map((day) => (
                <div key={day.toISOString()} className="flex-1 border-r p-1">
                  <UtilizationBar agentId={agent.id} date={day} />
                </div>
              ))}
            </div>

            {/* Agent Schedule Row */}
            <div className="flex">
              {/* Time labels column */}
              <TimeLabelsColumn
                config={config}
                hasBeforeHours={hasBeforeHours(agent.id)}
                hasAfterHours={hasAfterHours(agent.id)}
                className="w-48"
                allDayHeight={allDayHeight}
                beforeHoursHeight={beforeHoursHeight}
                afterHoursHeight={afterHoursHeight}
              />

              {/* Day Columns */}
              {days.map((day) => {
                const dayAppointments = getAppointmentsForAgentAndDay(agent.id, day);
                return (
                  <CalendarColumn
                    key={day.toISOString()}
                    agentId={agent.id}
                    date={day}
                    appointments={dayAppointments}
                    config={config}
                    isToday={isSameDay(day, new Date())}
                    allDayHeight={allDayHeight}
                    beforeHoursHeight={beforeHoursHeight}
                    afterHoursHeight={afterHoursHeight}
                    onAllDayHeightChange={setAllDayHeight}
                    onBeforeHoursHeightChange={setBeforeHoursHeight}
                    onAfterHoursHeightChange={setAfterHoursHeight}
                    showBeforeHours={hasBeforeHours(agent.id)}
                    showAfterHours={hasAfterHours(agent.id)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
