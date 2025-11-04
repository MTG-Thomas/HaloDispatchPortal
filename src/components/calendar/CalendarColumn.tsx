import { format, setHours, setMinutes } from 'date-fns';
import { AppointmentCard } from './AppointmentCard';
import { TimeSlot } from './TimeSlot';
import { GripHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Appointment } from '@/types';
import type { CalendarConfig } from '@/lib/calendarConfig';
import { generateTimeSlots, getGridRowFromTime, getSubSlotOffset } from '@/lib/calendarConfig';

interface CalendarColumnProps {
  agentId: number; // Changed from string to number
  date: Date;
  appointments: Appointment[];
  config: CalendarConfig;
  className?: string;
  isToday?: boolean;
  allDayHeight: number;
  beforeHoursHeight: number;
  afterHoursHeight: number;
  onAllDayHeightChange: (height: number) => void;
  onBeforeHoursHeightChange: (height: number) => void;
  onAfterHoursHeightChange: (height: number) => void;
  showBeforeHours?: boolean;
  showAfterHours?: boolean;
}

export function CalendarColumn({
  agentId,
  date,
  appointments,
  config,
  className,
  isToday = false,
  allDayHeight,
  beforeHoursHeight,
  afterHoursHeight,
  onAllDayHeightChange,
  onBeforeHoursHeightChange,
  onAfterHoursHeightChange,
  showBeforeHours = false,
  showAfterHours = false,
}: CalendarColumnProps) {
  const timeSlots = generateTimeSlots(config);

  // Helper to check if appointment has negative ID (should be treated as all-day)
  const hasNegativeId = (apt: Appointment) => {
    const numericId = parseInt(apt.id.replace(/^apt-/, ''));
    return numericId < 0;
  };

  // Separate appointments by time ranges
  const allDayAppointments = appointments.filter((apt) => apt.isAllDay || hasNegativeId(apt));
  const beforeHoursAppointments = appointments.filter((apt) => {
    if (apt.isAllDay || hasNegativeId(apt)) return false;
    const startHour = apt.startTime.getHours();
    return startHour < config.dayStartHour;
  });
  const afterHoursAppointments = appointments.filter((apt) => {
    if (apt.isAllDay || hasNegativeId(apt)) return false;
    const endHour = apt.endTime.getHours();
    const endMinute = apt.endTime.getMinutes();
    // After hours if ends after dayEndHour (e.g., after 5 PM)
    return endHour >= config.dayEndHour || (endHour === config.dayEndHour - 1 && endMinute > 45);
  });
  const regularAppointments = appointments.filter((apt) => {
    if (apt.isAllDay || hasNegativeId(apt)) return false;
    const startHour = apt.startTime.getHours();
    const endHour = apt.endTime.getHours();
    const endMinute = apt.endTime.getMinutes();
    // Regular hours: starts at or after dayStartHour and ends before dayEndHour
    return startHour >= config.dayStartHour &&
           (endHour < config.dayEndHour || (endHour === config.dayEndHour && endMinute === 0));
  });

  // Helper to check if two appointments overlap on this day
  const appointmentsOverlap = (apt1: Appointment, apt2: Appointment) => {
    const dayStart = new Date(date);
    dayStart.setHours(config.dayStartHour, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(config.dayEndHour, 0, 0, 0);

    const apt1Start = apt1.startTime > dayStart ? apt1.startTime : dayStart;
    const apt1End = apt1.endTime < dayEnd ? apt1.endTime : dayEnd;
    const apt2Start = apt2.startTime > dayStart ? apt2.startTime : dayStart;
    const apt2End = apt2.endTime < dayEnd ? apt2.endTime : dayEnd;

    return apt1Start < apt2End && apt2Start < apt1End;
  };

  // Outlook-style column-packing: appointments only constrain each other if they overlap in time
  // Sort appointments by start time to avoid recursion issues
  const sortedAppointments = [...regularAppointments].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime()
  );

  const columnCache = new Map<string, number>();

  // Process appointments in order and assign columns
  for (const appointment of sortedAppointments) {
    // Find which columns are occupied by earlier appointments that overlap with this one
    const overlapping = sortedAppointments.filter(
      (other) =>
        other.id !== appointment.id &&
        appointmentsOverlap(appointment, other) &&
        columnCache.has(other.id) // Only consider already-processed appointments
    );

    if (overlapping.length === 0) {
      columnCache.set(appointment.id, 0);
      continue;
    }

    // Get columns used by overlapping appointments
    const occupiedColumns = new Set<number>();
    for (const other of overlapping) {
      occupiedColumns.add(columnCache.get(other.id)!);
    }

    // Find first available column
    let column = 0;
    while (occupiedColumns.has(column)) {
      column++;
    }

    columnCache.set(appointment.id, column);
  }

  const getAppointmentLayout = (appointment: Appointment) => {
    const myColumn = columnCache.get(appointment.id) ?? 0;

    // totalColumns is based ONLY on appointments that actually overlap with this one
    const overlapping = regularAppointments.filter(
      (other) => other.id !== appointment.id && appointmentsOverlap(appointment, other)
    );

    if (overlapping.length === 0) {
      return { column: 0, totalColumns: 1 };
    }

    // Find the maximum column among this appointment and its overlapping appointments
    let maxColumn = myColumn;
    for (const other of overlapping) {
      const otherColumn = columnCache.get(other.id) ?? 0;
      maxColumn = Math.max(maxColumn, otherColumn);
    }

    return {
      column: myColumn,
      totalColumns: maxColumn + 1,
    };
  };

  // Get positioning for appointment (using pixels for absolute positioning)
  const getAppointmentGridStyle = (appointment: Appointment) => {
    const dayStart = new Date(date);
    dayStart.setHours(config.dayStartHour, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(config.dayEndHour, 0, 0, 0);

    const clippedStartTime = appointment.startTime > dayStart ? appointment.startTime : dayStart;
    const clippedEndTime = appointment.endTime < dayEnd ? appointment.endTime : dayEnd;

    const startRow = getGridRowFromTime(clippedStartTime, config);
    const endRow = getGridRowFromTime(clippedEndTime, config);

    // Calculate sub-slot positioning for exact time rendering
    const startOffset = getSubSlotOffset(clippedStartTime, config);
    const endOffset = getSubSlotOffset(clippedEndTime, config);

    const { column, totalColumns } = getAppointmentLayout(appointment);

    // Convert grid positioning to pixels for absolute positioning
    const slotHeight = 48;
    const spacing = 1; // 1px spacing around appointments (Outlook-style)
    const topPx = (startRow - 1) * slotHeight + startOffset * slotHeight;
    const bottomPx = (endRow - 1) * slotHeight + endOffset * slotHeight;
    const heightPx = bottomPx - topPx;

    // Calculate width percentage with spacing
    const widthPercent = (1 / totalColumns) * 100;
    const leftPercent = (column / totalColumns) * 100;

    return {
      top: `${topPx + spacing}px`,
      height: `${heightPx - spacing * 2}px`,
      left: `calc(${leftPercent}% + ${spacing}px)`,
      width: `calc(${widthPercent}% - ${spacing * 2}px)`,
      zIndex: column + 1,
    };
  };

  const slotHeight = 48; // Height in pixels for each time slot

  return (
    <div className={cn('flex-1 border-r flex flex-col', isToday && 'bg-primary/5', className)}>
      {/* All-Day Section - Resizable and scrollable */}
      <div
        className="border-b bg-muted/10 overflow-y-auto p-1 relative group"
        style={{ height: `${allDayHeight}px` }}
      >
        {allDayAppointments.map((appointment) => (
          <div key={appointment.id} className="mb-1">
            <div
              className="text-xs px-2 py-1 rounded truncate"
              style={{ backgroundColor: appointment.colour || '#6366f1' }}
            >
              <span className="text-gray-900 font-medium">{appointment.subject}</span>
            </div>
          </div>
        ))}
        {/* Resize handle */}
        <div
          className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center bg-border/50 hover:bg-border"
          onMouseDown={(e) => {
            e.preventDefault();
            const startY = e.clientY;
            const startHeight = allDayHeight;

            const handleMouseMove = (moveEvent: MouseEvent) => {
              const delta = moveEvent.clientY - startY;
              const newHeight = Math.max(40, Math.min(300, startHeight + delta));
              onAllDayHeightChange(newHeight);
            };

            const handleMouseUp = () => {
              document.removeEventListener('mousemove', handleMouseMove);
              document.removeEventListener('mouseup', handleMouseUp);
            };

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
          }}
        >
          <GripHorizontal className="h-3 w-3" />
        </div>
      </div>

      {/* Before Hours Section - Always render when any column needs it */}
      {showBeforeHours && (
        <div
          className="border-b bg-orange-50 dark:bg-orange-950/20 overflow-y-auto p-1 relative group"
          style={{ height: `${beforeHoursHeight}px` }}
        >
          {beforeHoursAppointments.map((appointment) => (
            <div key={appointment.id} className="mb-1">
              <div
                className="text-xs px-2 py-1 rounded truncate"
                style={{ backgroundColor: appointment.colour || '#6366f1' }}
              >
                <span className="text-gray-900 font-medium">
                  {format(appointment.startTime, 'h:mm a')} - {appointment.subject}
                </span>
              </div>
            </div>
          ))}
          {/* Resize handle */}
          <div
            className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center bg-border/50 hover:bg-border"
            onMouseDown={(e) => {
              e.preventDefault();
              const startY = e.clientY;
              const startHeight = beforeHoursHeight;

              const handleMouseMove = (moveEvent: MouseEvent) => {
                const delta = moveEvent.clientY - startY;
                const newHeight = Math.max(40, Math.min(300, startHeight + delta));
                onBeforeHoursHeightChange(newHeight);
              };

              const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
              };

              document.addEventListener('mousemove', handleMouseMove);
              document.addEventListener('mouseup', handleMouseUp);
            }}
          >
            <GripHorizontal className="h-3 w-3" />
          </div>
        </div>
      )}

      {/* Regular Hours Grid */}
      <div
        className="relative grid"
        style={{
          gridTemplateRows: `repeat(${timeSlots.length}, ${slotHeight}px)`,
          minHeight: `${timeSlots.length * slotHeight}px`,
        }}
        data-calendar-day
      >
        {/* Time grid slots with drop zones */}
        {timeSlots.map((slot, index) => {
          const slotStartTime = setHours(setMinutes(date, slot.minute), slot.hour);

          // Highlight the next upcoming time slot (only for today)
          // This is the slot that the current time is within or the next one
          const now = new Date();
          const nextSlotTime = index < timeSlots.length - 1
            ? setHours(setMinutes(date, timeSlots[index + 1].minute), timeSlots[index + 1].hour)
            : null;

          const isCurrentTime = isToday &&
            slotStartTime <= now &&
            (nextSlotTime === null || now < nextSlotTime);

          return (
            <TimeSlot
              key={slot.index}
              agentId={agentId}
              startTime={slotStartTime}
              isCurrentTime={isCurrentTime}
              className={cn(
                slot.minute === 0 && 'border-t-2'
              )}
            />
          );
        })}

        {/* Appointments positioned in grid */}
        {regularAppointments.map((appointment) => {
          const style = getAppointmentGridStyle(appointment);
          return (
            <div
              key={appointment.id}
              className="absolute pointer-events-auto"
              style={style}
            >
              <AppointmentCard appointment={appointment} />
            </div>
          );
        })}
      </div>

      {/* After Hours Section - Always render when any column needs it */}
      {showAfterHours && (
        <div
          className="border-t bg-orange-50 dark:bg-orange-950/20 overflow-y-auto p-1 relative group"
          style={{ height: `${afterHoursHeight}px` }}
        >
          {afterHoursAppointments.map((appointment) => (
            <div key={appointment.id} className="mb-1">
              <div
                className="text-xs px-2 py-1 rounded truncate"
                style={{ backgroundColor: appointment.colour || '#6366f1' }}
              >
                <span className="text-gray-900 font-medium">
                  {format(appointment.startTime, 'h:mm a')} - {appointment.subject}
                </span>
              </div>
            </div>
          ))}
          {/* Resize handle */}
          <div
            className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center bg-border/50 hover:bg-border"
            onMouseDown={(e) => {
              e.preventDefault();
              const startY = e.clientY;
              const startHeight = afterHoursHeight;

              const handleMouseMove = (moveEvent: MouseEvent) => {
                const delta = moveEvent.clientY - startY;
                const newHeight = Math.max(40, Math.min(300, startHeight + delta));
                onAfterHoursHeightChange(newHeight);
              };

              const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
              };

              document.addEventListener('mousemove', handleMouseMove);
              document.addEventListener('mouseup', handleMouseUp);
            }}
          >
            <GripHorizontal className="h-3 w-3" />
          </div>
        </div>
      )}
    </div>
  );
}
