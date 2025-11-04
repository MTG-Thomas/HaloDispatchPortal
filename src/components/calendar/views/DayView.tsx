import { useEffect, useState } from 'react';
import { startOfDay, endOfDay } from 'date-fns';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { UtilizationBar } from '../UtilizationBar';
import { CalendarColumn } from '../CalendarColumn';
import { TimeLabelsColumn } from '../TimeLabelsColumn';
import { DEFAULT_CALENDAR_CONFIG } from '@/lib/calendarConfig';

export function DayView() {
  // Shared heights for all columns
  const [allDayHeight, setAllDayHeight] = useState(40);
  const [beforeHoursHeight, setBeforeHoursHeight] = useState(64);
  const [afterHoursHeight, setAfterHoursHeight] = useState(64);
  const { selectedDate, getVisibleAgents, appointments, loadAppointments } = useDispatchStore();

  // Subscribe to selectedResources to detect agent selection changes
  const selectedResources = usePreferencesStore((state) => state.selectedResources);

  const visibleAgents = getVisibleAgents();
  const config = DEFAULT_CALENDAR_CONFIG;

  // Load appointments when date or visible agents change
  useEffect(() => {
    if (visibleAgents.length === 0) {
      return;
    }
    const dayStart = startOfDay(selectedDate);
    const dayEnd = endOfDay(selectedDate);
    loadAppointments(dayStart, dayEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate.toDateString(), selectedResources, visibleAgents.length]);

  // Get appointments for today
  const dayAppointments = appointments.filter((apt) => {
    const aptDate = apt.startTime.toDateString();
    const selDate = selectedDate.toDateString();
    return aptDate === selDate;
  });

  // Helper to get appointments for a specific agent
  const getAppointmentsForAgent = (agentId: string) => {
    return dayAppointments.filter((apt) => apt.agentId === agentId);
  };

  // Check if any agent has before/after hours appointments
  const hasBeforeHours = dayAppointments.some(
    (apt) => !apt.isAllDay && apt.startTime.getHours() < config.dayStartHour
  );

  const hasAfterHours = dayAppointments.some((apt) => {
    if (apt.isAllDay) return false;
    const endHour = apt.endTime.getHours();
    const endMinute = apt.endTime.getMinutes();
    return endHour >= config.dayEndHour || (endHour === config.dayEndHour - 1 && endMinute > 45);
  });

  if (visibleAgents.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No agents selected. Please select agents or teams to view their schedules.
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* Sticky Time Column */}
      <TimeLabelsColumn
        config={config}
        hasBeforeHours={hasBeforeHours}
        hasAfterHours={hasAfterHours}
        className="w-20 sticky left-0 z-10"
        allDayHeight={allDayHeight}
        beforeHoursHeight={beforeHoursHeight}
        afterHoursHeight={afterHoursHeight}
      />

      {/* Scrollable Calendar Content */}
      <div className="flex-1 overflow-auto">
        <div className="min-w-[700px]">
          {/* Header */}
          <div className="sticky top-0 z-20 bg-card border-b">
            <div className="flex">
              {visibleAgents.map((agent) => (
                <div key={agent.id} className="flex-1 border-r p-2 text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: agent.color }}
                    />
                    <span className="font-medium text-sm">{agent.name}</span>
                  </div>
                  <UtilizationBar agentId={agent.id} date={selectedDate} />
                </div>
              ))}
            </div>
          </div>

          {/* Agent Columns */}
          <div className="flex">
            {visibleAgents.map((agent) => {
              const agentAppointments = getAppointmentsForAgent(agent.id);
              return (
                <CalendarColumn
                  key={agent.id}
                  agentId={agent.id}
                  date={selectedDate}
                  appointments={agentAppointments}
                  config={config}
                  allDayHeight={allDayHeight}
                  beforeHoursHeight={beforeHoursHeight}
                  afterHoursHeight={afterHoursHeight}
                  onAllDayHeightChange={setAllDayHeight}
                  onBeforeHoursHeightChange={setBeforeHoursHeight}
                  onAfterHoursHeightChange={setAfterHoursHeight}
                  showBeforeHours={hasBeforeHours}
                  showAfterHours={hasAfterHours}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
