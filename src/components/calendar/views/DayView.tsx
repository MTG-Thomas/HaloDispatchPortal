import { useEffect, useState } from 'react';
import { startOfDay, endOfDay } from 'date-fns';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useConfigStore } from '@/stores/configStore';
import { UtilizationBar } from '../UtilizationBar';
import { CalendarColumn } from '../CalendarColumn';
import { TimeLabelsColumn } from '../TimeLabelsColumn';
import { AgentAvatar } from '@/components/AgentAvatar';
import { DEFAULT_CALENDAR_CONFIG } from '@/lib/calendarConfig';
import type { Appointment } from '@/types';

export function DayView() {
  // Shared heights for all columns
  const [allDayHeight, setAllDayHeight] = useState(40);
  const [beforeHoursHeight, setBeforeHoursHeight] = useState(64);
  const [afterHoursHeight, setAfterHoursHeight] = useState(64);
  const { selectedDate, getVisibleAgents, appointments, loadAppointments } = useDispatchStore();
  const { config } = useConfigStore();

  // Subscribe to selectedResources to detect agent selection changes
  const selectedResources = usePreferencesStore((state) => state.selectedResources);
  const calendarZoomLevel = usePreferencesStore((state) => state.calendarZoomLevel);

  const visibleAgents = getVisibleAgents();
  const calendarConfig = DEFAULT_CALENDAR_CONFIG;

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

  // Helper to check if appointment should be treated as all-day (matches CalendarColumn logic)
  const isAllDayAppointment = (apt: Appointment) => {
    if (apt.isAllDay) return true;
    const numericId = parseInt(apt.id);
    return numericId < 0; // Negative IDs are treated as all-day
  };

  // Check if any agent has before/after hours appointments
  const hasBeforeHours = dayAppointments.some(
    (apt) => !isAllDayAppointment(apt) && apt.startTime.getHours() < calendarConfig.dayStartHour
  );

  const hasAfterHours = dayAppointments.some((apt) => {
    if (isAllDayAppointment(apt)) return false;
    const endHour = apt.endTime.getHours();
    const endMinute = apt.endTime.getMinutes();
    // Only show after hours if appointment ends after dayEndHour (5 PM = 17:00)
    return endHour > calendarConfig.dayEndHour || (endHour === calendarConfig.dayEndHour && endMinute > 0);
  });

  if (visibleAgents.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No agents selected. Please select agents or teams to view their schedules.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="min-w-[700px]">
        {/* Header Row */}
        <div className="sticky top-0 z-20 bg-card border-b flex">
          {/* Resource Column Header */}
          <div className="w-48 flex-shrink-0 border-r p-2 bg-muted font-medium text-sm flex items-center">
            Resource
          </div>
          {/* Agent Headers */}
          {visibleAgents.map((agent) => (
            <div key={agent.id} className="flex-1 border-r p-2">
              <div className="flex items-center gap-2">
                <AgentAvatar
                  agent={agent}
                  size="sm"
                  resourceServer={config.resourceServer}
                />
                <span className="font-medium text-sm whitespace-nowrap">{agent.name}</span>
                <div className="flex-1 min-w-0">
                  <UtilizationBar agentId={agent.id} date={selectedDate} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Content Row */}
        <div className="flex">
          {/* Time Labels Column */}
          <TimeLabelsColumn
            config={calendarConfig}
            hasBeforeHours={hasBeforeHours}
            hasAfterHours={hasAfterHours}
            className="w-48 flex-shrink-0"
            allDayHeight={allDayHeight}
            beforeHoursHeight={beforeHoursHeight}
            afterHoursHeight={afterHoursHeight}
            zoomLevel={calendarZoomLevel}
          />

          {/* Agent Columns */}
          {visibleAgents.map((agent) => {
            const agentAppointments = getAppointmentsForAgent(agent.id);
            return (
              <CalendarColumn
                key={agent.id}
                agentId={agent.id}
                date={selectedDate}
                appointments={agentAppointments}
                config={calendarConfig}
                allDayHeight={allDayHeight}
                beforeHoursHeight={beforeHoursHeight}
                afterHoursHeight={afterHoursHeight}
                onAllDayHeightChange={setAllDayHeight}
                onBeforeHoursHeightChange={setBeforeHoursHeight}
                onAfterHoursHeightChange={setAfterHoursHeight}
                showBeforeHours={hasBeforeHours}
                showAfterHours={hasAfterHours}
                zoomLevel={calendarZoomLevel}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
