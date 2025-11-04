import { useEffect } from 'react';
import { format, setHours, setMinutes, startOfDay, endOfDay } from 'date-fns';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { AppointmentCard } from '../AppointmentCard';
import { UtilizationBar } from '../UtilizationBar';
import { TimeSlot } from '../TimeSlot';

export function DayView() {
  const { selectedDate, getVisibleAgents, appointments, loadAppointments } = useDispatchStore();

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
  }, [selectedDate.toDateString(), visibleAgents.length]);

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

  // Helper to check if two appointments overlap
  const appointmentsOverlap = (apt1: typeof dayAppointments[number], apt2: typeof dayAppointments[number]) => {
    return apt1.startTime < apt2.endTime && apt2.startTime < apt1.endTime;
  };

  // Assign columns to appointments using a greedy algorithm
  const assignColumns = (agentAppointments: typeof dayAppointments[number][]) => {
    const sorted = [...agentAppointments].sort((a, b) =>
      a.startTime.getTime() - b.startTime.getTime()
    );

    const columns: typeof dayAppointments[number][][] = [];
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
  const getAppointmentStyleWithOverlap = (appointment: typeof dayAppointments[number], agentAppointments: typeof dayAppointments[number][]) => {
    const startHour = appointment.startTime.getHours();
    const startMinute = appointment.startTime.getMinutes();
    const endHour = appointment.endTime.getHours();
    const endMinute = appointment.endTime.getMinutes();

    // Calculate position in 15-minute increments (3px per minute)
    const startMinutesFromStart = (startHour - 8) * 60 + startMinute;
    const endMinutesFromStart = (endHour - 8) * 60 + endMinute;
    const durationMinutes = endMinutesFromStart - startMinutesFromStart;

    // Get column assignments for all appointments for this agent
    const { columnAssignment, maxColumns } = assignColumns(agentAppointments);

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
