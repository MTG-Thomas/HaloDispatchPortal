import { useEffect } from 'react';
import { startOfWeek, addDays, format, isSameDay, setHours, setMinutes, isWithinInterval, endOfDay } from 'date-fns';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { AppointmentCard } from '../AppointmentCard';
import { UtilizationBar } from '../UtilizationBar';
import { TimeSlot } from '../TimeSlot';
import { cn } from '@/lib/utils';

export function WeekView() {
  const {
    calendarView,
    selectedDate,
    getVisibleAgents,
    getAppointmentsForDateRange,
    loadAppointments,
  } = useDispatchStore();

  const visibleAgents = getVisibleAgents();
  const daysToShow = calendarView === 'week5' ? 5 : 7;

  // Get week start (Monday)
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const days = Array.from({ length: daysToShow }, (_, i) => addDays(weekStart, i));

  // Time slots (8 AM to 6 PM) in 15-minute increments
  // 10 hours * 4 slots per hour = 40 slots
  // 45px per 15-minute slot (3px per minute)
  const timeSlots = Array.from({ length: 40 }, (_, i) => {
    const hour = Math.floor(i / 4) + 8;
    const minute = (i % 4) * 15;
    return { hour, minute, index: i };
  });

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
  }, [weekStart.getTime(), weekEnd.getTime(), visibleAgents.length]);

  // Separate appointments by time ranges
  const allDayAppointments = appointments.filter((apt) => apt.isAllDay);
  const beforeHoursAppointments = appointments.filter((apt) => {
    if (apt.isAllDay) return false;
    const startHour = apt.startTime.getHours();
    return startHour < 8;
  });
  const afterHoursAppointments = appointments.filter((apt) => {
    if (apt.isAllDay) return false;
    const endHour = apt.endTime.getHours();
    return endHour >= 18 || (endHour === 17 && apt.endTime.getMinutes() > 0);
  });
  const regularAppointments = appointments.filter((apt) => {
    if (apt.isAllDay) return false;
    const startHour = apt.startTime.getHours();
    const endHour = apt.endTime.getHours();
    return startHour >= 8 && endHour < 18;
  });

  // Helper to get appointments for a specific agent and day
  const getAppointmentsForAgentAndDay = (agentId: string, day: Date) => {
    return regularAppointments.filter(
      (apt) => apt.agentId === agentId && isSameDay(apt.startTime, day)
    );
  };

  // Helper to get all-day appointments for a specific agent and day
  const getAllDayAppointmentsForAgentAndDay = (agentId: string, day: Date) => {
    return allDayAppointments.filter((apt) => {
      return (
        apt.agentId === agentId &&
        isWithinInterval(day, {
          start: apt.startTime,
          end: endOfDay(apt.endTime),
        })
      );
    });
  };

  // Helper to get before hours appointments for a specific agent and day
  const getBeforeHoursAppointmentsForAgentAndDay = (agentId: string, day: Date) => {
    return beforeHoursAppointments.filter(
      (apt) => apt.agentId === agentId && isSameDay(apt.startTime, day)
    );
  };

  // Helper to get after hours appointments for a specific agent and day
  const getAfterHoursAppointmentsForAgentAndDay = (agentId: string, day: Date) => {
    return afterHoursAppointments.filter(
      (apt) => apt.agentId === agentId && isSameDay(apt.startTime, day)
    );
  };

  // Helper to check if two appointments overlap
  const appointmentsOverlap = (apt1: typeof appointments[number], apt2: typeof appointments[number]) => {
    return apt1.startTime < apt2.endTime && apt2.startTime < apt1.endTime;
  };

  // Assign columns to appointments using a greedy algorithm
  const assignColumns = (dayAppointments: typeof appointments[number][]) => {
    const sorted = [...dayAppointments].sort((a, b) =>
      a.startTime.getTime() - b.startTime.getTime()
    );

    const columns: typeof appointments[number][][] = [];
    const columnAssignment = new Map<string, number>();
    const maxColumns = new Map<string, number>();

    for (const apt of sorted) {
      // Find the first column where this appointment doesn't overlap with any existing appointment
      let assignedColumn = -1;
      for (let i = 0; i < columns.length; i++) {
        const hasConflict = columns[i].some(other => appointmentsOverlap(apt, other));
        if (!hasConflict) {
          assignedColumn = i;
          break;
        }
      }

      // If no column found, create a new one
      if (assignedColumn === -1) {
        assignedColumn = columns.length;
        columns.push([]);
      }

      columns[assignedColumn].push(apt);
      columnAssignment.set(apt.id, assignedColumn);

      // Track the maximum number of columns needed at this appointment's time
      let maxCols = 0;
      for (let i = 0; i < columns.length; i++) {
        if (columns[i].some(other => appointmentsOverlap(apt, other))) {
          maxCols = i + 1;
        }
      }
      maxColumns.set(apt.id, maxCols);
    }

    return { columnAssignment, maxColumns };
  };

  // Calculate overlap groups and positions for appointments
  const getAppointmentStyleWithOverlap = (appointment: typeof appointments[number], dayAppointments: typeof appointments[number][]) => {
    const startHour = appointment.startTime.getHours();
    const startMinute = appointment.startTime.getMinutes();
    const endHour = appointment.endTime.getHours();
    const endMinute = appointment.endTime.getMinutes();

    // Calculate position in 15-minute increments (3px per minute)
    const startMinutesFromStart = (startHour - 8) * 60 + startMinute;
    const endMinutesFromStart = (endHour - 8) * 60 + endMinute;
    const durationMinutes = endMinutesFromStart - startMinutesFromStart;

    // Get column assignments for all appointments in this day
    const { columnAssignment, maxColumns } = assignColumns(dayAppointments);

    const column = columnAssignment.get(appointment.id) ?? 0;
    const totalColumns = maxColumns.get(appointment.id) ?? 1;

    // Divide the available width based on the maximum columns needed
    const widthPercent = 100 / totalColumns;
    const leftPercent = widthPercent * column;

    return {
      top: `${startMinutesFromStart * 3}px`,
      height: `${durationMinutes * 3}px`,
      left: `${leftPercent}%`,
      width: `${widthPercent}%`,
      zIndex: 1,
    };
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
              <div className="w-48 border-r bg-muted/10 relative" style={{ minHeight: '1800px' }}>
                {timeSlots.map((slot) => (
                  <div
                    key={slot.index}
                    className="absolute text-right pr-2"
                    style={{ top: `${slot.index * 45}px`, height: '45px', right: 0, left: 0 }}
                  >
                    {slot.minute === 0 && (
                      <span className="text-[10px] text-muted-foreground/70">
                        {format(setHours(setMinutes(new Date(), slot.minute), slot.hour), 'h a')}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Day Columns - each contains all sections vertically */}
              {days.map((day) => {
                const dayAllDay = getAllDayAppointmentsForAgentAndDay(agent.id, day);
                const dayBefore = getBeforeHoursAppointmentsForAgentAndDay(agent.id, day);
                const dayAfter = getAfterHoursAppointmentsForAgentAndDay(agent.id, day);

                return (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      'flex-1 border-r flex flex-col overflow-hidden',
                      isSameDay(day, new Date()) && 'bg-primary/5'
                    )}
                  >
                    {/* All-Day Section */}
                    {dayAllDay.length > 0 && (
                      <div className="border-b bg-muted/10 p-1 min-h-[40px]">
                        {dayAllDay.map((appointment) => (
                          <div key={appointment.id} className="mb-1">
                            <div className="text-xs px-2 py-1 rounded truncate" style={{ backgroundColor: appointment.colour || '#6366f1' }}>
                              <span className="text-gray-900 font-medium">{appointment.subject}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Before Hours Section */}
                    {dayBefore.length > 0 && (
                      <div className="border-b bg-orange-50 dark:bg-orange-950/20 p-1 min-h-[40px] max-h-[100px] overflow-y-auto">
                        <div className="text-[10px] text-muted-foreground mb-1">Before 8 AM</div>
                        {dayBefore.map((appointment) => (
                          <div key={appointment.id} className="mb-1">
                            <div className="text-xs px-2 py-1 rounded truncate" style={{ backgroundColor: appointment.colour || '#6366f1' }}>
                              <span className="text-gray-900 font-medium">
                                {format(appointment.startTime, 'h:mm a')} - {appointment.subject}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Regular Hours Grid (8AM-5PM) */}
                    <div className="relative flex-1 overflow-hidden" style={{ minHeight: '1800px' }} data-calendar-day>
                      {/* Time Grid Lines with Drop Zones */}
                      {timeSlots.map((slot) => {
                        const slotStartTime = setHours(setMinutes(day, slot.minute), slot.hour);
                        return (
                          <TimeSlot
                            key={slot.index}
                            agentId={agent.id}
                            startTime={slotStartTime}
                            style={{ top: `${slot.index * 45}px`, height: '45px' }}
                          />
                        );
                      })}

                      {/* Appointments */}
                      <div className="absolute inset-0 pointer-events-none">
                        {getAppointmentsForAgentAndDay(agent.id, day).map((appointment) => {
                          const dayAppointments = getAppointmentsForAgentAndDay(agent.id, day);
                          const style = getAppointmentStyleWithOverlap(appointment, dayAppointments);
                          return (
                            <div
                              key={appointment.id}
                              className="absolute pointer-events-auto"
                              style={style}
                            >
                              <div className="h-full px-1">
                                <AppointmentCard appointment={appointment} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* After Hours Section */}
                    {dayAfter.length > 0 && (
                      <div className="border-t bg-orange-50 dark:bg-orange-950/20 p-1 min-h-[40px] max-h-[100px] overflow-y-auto">
                        <div className="text-[10px] text-muted-foreground mb-1">After 5 PM</div>
                        {dayAfter.map((appointment) => (
                          <div key={appointment.id} className="mb-1">
                            <div className="text-xs px-2 py-1 rounded truncate" style={{ backgroundColor: appointment.colour || '#6366f1' }}>
                              <span className="text-gray-900 font-medium">
                                {format(appointment.startTime, 'h:mm a')} - {appointment.subject}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
