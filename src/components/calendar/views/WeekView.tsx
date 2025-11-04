import { useEffect } from 'react';
import { startOfWeek, addDays, format, isSameDay, setHours, setMinutes, isWithinInterval, endOfDay } from 'date-fns';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
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

  // Subscribe to selectedResources to detect agent selection changes
  const selectedResources = usePreferencesStore((state) => state.selectedResources);

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
  }, [weekStart.getTime(), weekEnd.getTime(), selectedResources]);

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
    return regularAppointments.filter((apt) => {
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

  // Helper to check if two appointments overlap on a specific day
  const appointmentsOverlapOnDay = (apt1: typeof appointments[number], apt2: typeof appointments[number], day: Date) => {
    // Get day boundaries
    const dayStart = new Date(day);
    dayStart.setHours(8, 0, 0, 0); // 8 AM start of work day
    const dayEnd = new Date(day);
    dayEnd.setHours(18, 0, 0, 0); // 6 PM end of work day

    // Clip appointment times to this day's boundaries
    const apt1Start = apt1.startTime > dayStart ? apt1.startTime : dayStart;
    const apt1End = apt1.endTime < dayEnd ? apt1.endTime : dayEnd;
    const apt2Start = apt2.startTime > dayStart ? apt2.startTime : dayStart;
    const apt2End = apt2.endTime < dayEnd ? apt2.endTime : dayEnd;

    // Check if clipped times overlap
    return apt1Start < apt2End && apt2Start < apt1End;
  };

  // Google Calendar column-packing algorithm
  const columnCache = new Map<string, Map<string, { column: number; totalColumns: number }>>();

  const getAppointmentLayout = (dayAppointments: typeof appointments[number][], targetAppointment: typeof appointments[number], day: Date) => {
    // Create a cache key based on the day's appointments and the day
    const cacheKey = `${day.toDateString()}-${dayAppointments.map(a => a.id).sort().join(',')}`;

    if (!columnCache.has(cacheKey)) {
      // Sort appointments by start time (clipped to day boundaries)
      const sorted = [...dayAppointments].sort((a, b) => {
        const dayStart = new Date(day);
        dayStart.setHours(8, 0, 0, 0);
        const aStart = a.startTime > dayStart ? a.startTime : dayStart;
        const bStart = b.startTime > dayStart ? b.startTime : dayStart;
        return aStart.getTime() - bStart.getTime();
      });

      // Track which appointments are in which columns
      const columns: typeof appointments[number][][] = [];
      const columnAssignment = new Map<string, number>();

      // Assign each appointment to the leftmost available column
      for (const apt of sorted) {
        let assignedColumn = -1;

        // Try to place in existing columns
        for (let col = 0; col < columns.length; col++) {
          const hasConflict = columns[col].some(other => appointmentsOverlapOnDay(apt, other, day));
          if (!hasConflict) {
            assignedColumn = col;
            break;
          }
        }

        // If no column works, create a new one
        if (assignedColumn === -1) {
          assignedColumn = columns.length;
          columns.push([]);
        }

        columns[assignedColumn].push(apt);
        columnAssignment.set(apt.id, assignedColumn);
      }

      // Calculate layout for each appointment
      const layoutMap = new Map<string, { column: number; totalColumns: number }>();

      for (const apt of sorted) {
        const myColumn = columnAssignment.get(apt.id)!;

        // Find all appointments that overlap with this one on this day
        const overlapping = sorted.filter(other =>
          other.id !== apt.id && appointmentsOverlapOnDay(apt, other, day)
        );

        if (overlapping.length === 0) {
          // No overlaps - full width
          layoutMap.set(apt.id, { column: 0, totalColumns: 1 });
        } else {
          // Find max column among overlapping appointments
          let maxColumn = myColumn;
          for (const other of overlapping) {
            const otherColumn = columnAssignment.get(other.id)!;
            maxColumn = Math.max(maxColumn, otherColumn);
          }

          layoutMap.set(apt.id, {
            column: myColumn,
            totalColumns: maxColumn + 1,
          });
        }
      }

      columnCache.set(cacheKey, layoutMap);
    }

    return columnCache.get(cacheKey)!.get(targetAppointment.id)!;
  };

  // Calculate overlap groups and positions for appointments
  const getAppointmentStyleWithOverlap = (appointment: typeof appointments[number], dayAppointments: typeof appointments[number][], day: Date) => {
    // Clip appointment times to this day's work hours (8 AM - 6 PM)
    const dayStart = new Date(day);
    dayStart.setHours(8, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(18, 0, 0, 0);

    const clippedStartTime = appointment.startTime > dayStart ? appointment.startTime : dayStart;
    const clippedEndTime = appointment.endTime < dayEnd ? appointment.endTime : dayEnd;

    const startHour = clippedStartTime.getHours();
    const startMinute = clippedStartTime.getMinutes();
    const endHour = clippedEndTime.getHours();
    const endMinute = clippedEndTime.getMinutes();

    // Calculate position in 15-minute increments (3px per minute)
    const startMinutesFromStart = (startHour - 8) * 60 + startMinute;
    const endMinutesFromStart = (endHour - 8) * 60 + endMinute;
    const durationMinutes = endMinutesFromStart - startMinutesFromStart;

    // Get layout for this specific appointment
    const { column, totalColumns } = getAppointmentLayout(dayAppointments, appointment, day);

    // Divide the available width based on columns in this overlap group
    const widthPercent = 100 / totalColumns;
    const leftPercent = widthPercent * column;

    return {
      top: `${startMinutesFromStart * 3}px`,
      height: `${durationMinutes * 3}px`,
      left: `${leftPercent}%`,
      width: `${widthPercent}%`,
      zIndex: column + 1, // Higher z-index for appointments in later columns
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
              <div className="w-48 border-r bg-muted/10">
                {/* All Day Section Label */}
                <div className="h-[40px] border-b flex items-center px-2 text-xs text-muted-foreground bg-muted/10">
                  All Day
                </div>

                {/* Before Hours Section Label - check if any day has before hours appointments */}
                {days.some(day => getBeforeHoursAppointmentsForAgentAndDay(agent.id, day).length > 0) && (
                  <>
                    <div className="h-[16px] border-b flex items-center px-2 text-[10px] text-muted-foreground bg-orange-50 dark:bg-orange-950/20">
                      Before 8 AM
                    </div>
                    <div className="h-[48px] border-b" /> {/* Before Hours content spacer */}
                  </>
                )}

                {/* Time labels for regular hours */}
                <div className="relative" style={{ minHeight: '1800px' }}>
                  {timeSlots.map((slot) => (
                    <div
                      key={slot.index}
                      className={cn(
                        'h-[45px] border-t text-xs text-muted-foreground relative',
                        slot.minute === 0 && 'border-t-2 font-medium'
                      )}
                    >
                      {slot.minute === 0 && (
                        <span className="absolute -top-2 right-2">
                          {format(setHours(setMinutes(new Date(), slot.minute), slot.hour), 'h a')}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {/* After Hours Section Label - check if any day has after hours appointments */}
                {days.some(day => getAfterHoursAppointmentsForAgentAndDay(agent.id, day).length > 0) && (
                  <>
                    <div className="h-[16px] border-t flex items-center px-2 text-[10px] text-muted-foreground bg-orange-50 dark:bg-orange-950/20">
                      After 5 PM
                    </div>
                    <div className="h-[48px]" /> {/* After Hours content spacer */}
                  </>
                )}
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
                    {/* All-Day Section - Always render with fixed height for alignment */}
                    <div className="border-b bg-muted/10 p-1 h-[40px] overflow-hidden">
                      {dayAllDay.map((appointment) => (
                        <div key={appointment.id} className="mb-1">
                          <div className="text-xs px-2 py-1 rounded truncate" style={{ backgroundColor: appointment.colour || '#6366f1' }}>
                            <span className="text-gray-900 font-medium">{appointment.subject}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Before Hours Section - Fixed height for alignment */}
                    {dayBefore.length > 0 && (
                      <div className="border-b bg-orange-50 dark:bg-orange-950/20">
                        <div className="text-[10px] text-muted-foreground mb-1 h-[16px] flex items-center px-1">Before 8 AM</div>
                        <div className="h-[48px] overflow-hidden p-1">
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
                          const style = getAppointmentStyleWithOverlap(appointment, dayAppointments, day);
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

                    {/* After Hours Section - Fixed height for alignment */}
                    {dayAfter.length > 0 && (
                      <div className="border-t bg-orange-50 dark:bg-orange-950/20">
                        <div className="text-[10px] text-muted-foreground mb-1 h-[16px] flex items-center px-1">After 5 PM</div>
                        <div className="h-[48px] overflow-hidden p-1">
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
