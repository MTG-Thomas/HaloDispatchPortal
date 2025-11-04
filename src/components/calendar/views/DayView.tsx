import { useEffect } from 'react';
import { format, setHours, setMinutes, startOfDay, endOfDay } from 'date-fns';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { AppointmentCard } from '../AppointmentCard';
import { UtilizationBar } from '../UtilizationBar';
import { TimeSlot } from '../TimeSlot';
import { cn } from '@/lib/utils';

export function DayView() {
  const { selectedDate, getVisibleAgents, appointments, loadAppointments } = useDispatchStore();

  // Subscribe to selectedResources to detect agent selection changes
  const selectedResources = usePreferencesStore((state) => state.selectedResources);

  const visibleAgents = getVisibleAgents();

  // Time slots (8 AM to 6 PM) in 15-minute increments
  // 10 hours * 4 slots per hour = 40 slots
  const timeSlots = Array.from({ length: 40 }, (_, i) => {
    const hour = Math.floor(i / 4) + 8;
    const minute = (i % 4) * 15;
    return { hour, minute, index: i };
  });

  // Load appointments when date or visible agents change
  useEffect(() => {
    if (visibleAgents.length === 0) {
      console.log('📅 DayView: Skipping appointment load - no agents selected');
      return;
    }
    const dayStart = startOfDay(selectedDate);
    const dayEnd = endOfDay(selectedDate);
    console.log('📅 DayView: Loading appointments for', dayStart.toISOString(), 'to', dayEnd.toISOString());
    console.log('📅 DayView: Visible agents:', visibleAgents.length, visibleAgents.map(a => a.id));
    loadAppointments(dayStart, dayEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate.toDateString(), selectedResources]);

  // Get appointments for today
  const dayAppointments = appointments.filter((apt) => {
    const aptDate = apt.startTime.toDateString();
    const selDate = selectedDate.toDateString();
    return aptDate === selDate;
  });

  // Separate appointments by time ranges
  const allDayAppointments = dayAppointments.filter((apt) => apt.isAllDay);
  const beforeHoursAppointments = dayAppointments.filter((apt) => {
    if (apt.isAllDay) return false;
    const startHour = apt.startTime.getHours();
    return startHour < 8;
  });
  const afterHoursAppointments = dayAppointments.filter((apt) => {
    if (apt.isAllDay) return false;
    const endHour = apt.endTime.getHours();
    return endHour >= 18 || (endHour === 17 && apt.endTime.getMinutes() > 0);
  });
  const regularAppointments = dayAppointments.filter((apt) => {
    if (apt.isAllDay) return false;
    const startHour = apt.startTime.getHours();
    const endHour = apt.endTime.getHours();
    return startHour >= 8 && endHour < 18;
  });

  const getAppointmentsForAgent = (agentId: string) => {
    return regularAppointments.filter((apt) => apt.agentId === agentId);
  };

  const getAllDayAppointmentsForAgent = (agentId: string) => {
    return allDayAppointments.filter((apt) => apt.agentId === agentId);
  };

  const getBeforeHoursAppointmentsForAgent = (agentId: string) => {
    return beforeHoursAppointments.filter((apt) => apt.agentId === agentId);
  };

  const getAfterHoursAppointmentsForAgent = (agentId: string) => {
    return afterHoursAppointments.filter((apt) => apt.agentId === agentId);
  };

  // Helper to check if two appointments overlap on the selected day
  const appointmentsOverlapOnDay = (apt1: typeof dayAppointments[number], apt2: typeof dayAppointments[number]) => {
    // Get day boundaries for the selected day
    const dayStart = new Date(selectedDate);
    dayStart.setHours(8, 0, 0, 0); // 8 AM start of work day
    const dayEnd = new Date(selectedDate);
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

  const getAppointmentLayout = (agentAppointments: typeof dayAppointments[number][], targetAppointment: typeof dayAppointments[number]) => {
    // Create a cache key based on the agent's appointments
    const cacheKey = agentAppointments.map(a => a.id).sort().join(',');

    if (!columnCache.has(cacheKey)) {
      // Sort appointments by start time
      const sorted = [...agentAppointments].sort((a, b) =>
        a.startTime.getTime() - b.startTime.getTime()
      );

      // Track which appointments are in which columns
      const columns: typeof dayAppointments[number][][] = [];
      const columnAssignment = new Map<string, number>();

      // Assign each appointment to the leftmost available column
      for (const apt of sorted) {
        let assignedColumn = -1;

        // Try to place in existing columns
        for (let col = 0; col < columns.length; col++) {
          const hasConflict = columns[col].some(other => appointmentsOverlapOnDay(apt, other));
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
          other.id !== apt.id && appointmentsOverlapOnDay(apt, other)
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
  const getAppointmentStyleWithOverlap = (appointment: typeof dayAppointments[number], agentAppointments: typeof dayAppointments[number][]) => {
    // Clip appointment times to this day's work hours (8 AM - 6 PM)
    const dayStart = new Date(selectedDate);
    dayStart.setHours(8, 0, 0, 0);
    const dayEnd = new Date(selectedDate);
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
    const { column, totalColumns } = getAppointmentLayout(agentAppointments, appointment);

    // Divide the available width based on columns in this overlap group
    const widthPercent = 100 / totalColumns;
    const leftPercent = widthPercent * column;

    // Extend height by 2px to create slight visual overlap with next appointment
    const heightWithOverlap = durationMinutes * 3 + 2;

    return {
      top: `${startMinutesFromStart * 3}px`,
      height: `${heightWithOverlap}px`,
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
    <div className="h-full flex">
      {/* Sticky Time Column */}
      <div className="w-20 border-r bg-card flex-shrink-0">
        <div className="sticky top-0 z-30 bg-card border-b p-2">
          <div className="font-medium text-sm">Time</div>
        </div>
        <div className="h-full">
          {/* Placeholder for scroll alignment */}
          <div className="h-[40px]" /> {/* All Day header */}
          {allDayAppointments.length > 0 && <div className="h-[40px]" />} {/* All Day content */}
          {beforeHoursAppointments.length > 0 && (
            <>
              <div className="h-[24px]" /> {/* Before Hours header */}
              <div className="h-[40px]" /> {/* Before Hours content */}
            </>
          )}
          {/* Time labels */}
          {timeSlots.map((slot) => (
            <div
              key={slot.index}
              className={cn(
                'h-[45px] border-t p-1 text-xs text-muted-foreground flex items-center',
                slot.minute === 0 && 'border-t-2 font-medium'
              )}
            >
              {slot.minute === 0 && format(setHours(setMinutes(selectedDate, 0), slot.hour), 'h a')}
            </div>
          ))}
          {afterHoursAppointments.length > 0 && (
            <>
              <div className="h-[24px]" /> {/* After Hours header */}
              <div className="h-[40px]" /> {/* After Hours content */}
            </>
          )}
        </div>
      </div>

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

          {/* All-Day Appointments Section */}
          {allDayAppointments.length > 0 && (
            <div className="border-b bg-muted/10">
              <div className="flex">
                {visibleAgents.map((agent) => (
                  <div key={agent.id} className="flex-1 border-r p-1 min-h-[40px]">
                    {getAllDayAppointmentsForAgent(agent.id).map((appointment) => (
                      <div key={appointment.id} className="mb-1">
                        <div className="text-xs px-2 py-1 rounded truncate" style={{ backgroundColor: appointment.colour || '#6366f1' }}>
                          <span className="text-gray-900 font-medium">{appointment.subject}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Before Hours Appointments Section */}
          {beforeHoursAppointments.length > 0 && (
            <div className="border-b bg-orange-50 dark:bg-orange-950/20">
              <div className="px-2 py-1 text-xs text-muted-foreground font-medium">
                Before 8 AM
              </div>
              <div className="flex max-h-[100px] overflow-y-auto">
                {visibleAgents.map((agent) => (
                  <div key={agent.id} className="flex-1 border-r p-1 min-h-[40px]">
                    {getBeforeHoursAppointmentsForAgent(agent.id).map((appointment) => (
                      <div key={appointment.id} className="mb-1">
                        <div className="text-xs px-2 py-1 rounded truncate" style={{ backgroundColor: appointment.colour || '#6366f1' }}>
                          <span className="text-gray-900 font-medium">
                            {format(appointment.startTime, 'h:mm a')} - {appointment.subject}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Time Grid with Agent Columns */}
          <div className="flex">
            {/* Agent Columns */}
          {visibleAgents.map((agent) => (
            <div key={agent.id} className="flex-1 border-r relative" style={{ minHeight: '1800px' }} data-calendar-day>
              {/* Time Grid Lines with Drop Zones */}
              {timeSlots.map((slot) => {
                const slotStartTime = setHours(setMinutes(selectedDate, slot.minute), slot.hour);
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
                {getAppointmentsForAgent(agent.id).map((appointment) => {
                  const agentAppointments = getAppointmentsForAgent(agent.id);
                  const style = getAppointmentStyleWithOverlap(appointment, agentAppointments);
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
          ))}
          </div>

          {/* After Hours Appointments Section */}
          {afterHoursAppointments.length > 0 && (
            <div className="border-t bg-orange-50 dark:bg-orange-950/20">
              <div className="px-2 py-1 text-xs text-muted-foreground font-medium">
                After 5 PM
              </div>
              <div className="flex max-h-[100px] overflow-y-auto">
                {visibleAgents.map((agent) => (
                  <div key={agent.id} className="flex-1 border-r p-1 min-h-[40px]">
                    {getAfterHoursAppointmentsForAgent(agent.id).map((appointment) => (
                      <div key={appointment.id} className="mb-1">
                        <div className="text-xs px-2 py-1 rounded truncate" style={{ backgroundColor: appointment.colour || '#6366f1' }}>
                          <span className="text-gray-900 font-medium">
                            {format(appointment.startTime, 'h:mm a')} - {appointment.subject}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
