import { format } from 'date-fns';
import { Clock, AlertCircle, GripHorizontal, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDraggableAppointment } from '@/hooks/useDraggableAppointment';
import { useAppointmentResize } from '@/hooks/useAppointmentResize';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { AppointmentContextMenu } from './AppointmentContextMenu';
import type { Appointment } from '@/types';

interface AppointmentCardProps {
  appointment: Appointment;
}

export function AppointmentCard({ appointment }: AppointmentCardProps) {
  const { ticket } = appointment;
  const { resizeAppointment } = useDispatchStore();
  const dragRef = useDraggableAppointment(appointment);

  const { startResize, isResizing, previewStartTime, previewEndTime } = useAppointmentResize(
    appointment,
    resizeAppointment
  );

  // Calculate preview dimensions when resizing
  const getPreviewStyle = () => {
    if (!isResizing) return {};

    // Import config to calculate grid positioning
    const config = { dayStartHour: 8, dayEndHour: 17, slotIncrement: 15 };
    const slotHeight = 48; // Must match CalendarColumn
    const spacing = 1; // Must match CalendarColumn spacing

    // Calculate grid rows for preview times
    const getGridRow = (time: Date) => {
      const totalMinutesFromMidnight = time.getHours() * 60 + time.getMinutes();
      const startMinutes = config.dayStartHour * 60;
      const minutesFromStart = totalMinutesFromMidnight - startMinutes;
      const slotIndex = Math.floor(minutesFromStart / config.slotIncrement);
      return slotIndex + 1; // CSS Grid is 1-indexed
    };

    // Calculate sub-slot offset (0-1 fraction within the slot)
    const getSubSlotOffset = (time: Date) => {
      const totalMinutesFromMidnight = time.getHours() * 60 + time.getMinutes();
      const startMinutes = config.dayStartHour * 60;
      const minutesFromStart = totalMinutesFromMidnight - startMinutes;
      const slotIndex = Math.floor(minutesFromStart / config.slotIncrement);
      const slotStartMinutes = slotIndex * config.slotIncrement;
      const offsetWithinSlot = minutesFromStart - slotStartMinutes;
      return offsetWithinSlot / config.slotIncrement;
    };

    // Calculate preview position
    const previewStartRow = getGridRow(previewStartTime);
    const previewEndRow = getGridRow(previewEndTime);
    const previewStartOffset = getSubSlotOffset(previewStartTime);
    const previewEndOffset = getSubSlotOffset(previewEndTime);

    const previewTopPx = (previewStartRow - 1) * slotHeight + previewStartOffset * slotHeight;
    const previewBottomPx = (previewEndRow - 1) * slotHeight + previewEndOffset * slotHeight;
    const previewHeightPx = previewBottomPx - previewTopPx;

    // Calculate current position
    const currentStartRow = getGridRow(appointment.startTime);
    const currentStartOffset = getSubSlotOffset(appointment.startTime);
    const currentTopPx = (currentStartRow - 1) * slotHeight + currentStartOffset * slotHeight;

    // Calculate the delta to translate the card to preview position
    const deltaY = previewTopPx - currentTopPx;

    // Use transform to move the card and update height
    // This keeps the card in its positioned context but visually moves it
    return {
      transform: `translateY(${deltaY}px)`,
      height: `${previewHeightPx - spacing * 2}px`,
    };
  };

  const getStatusIcon = () => {
    switch (appointment.status) {
      case 'in_progress':
        return <Clock className="h-3 w-3" />;
      case 'completed':
        return null;
      case 'cancelled':
        return <AlertCircle className="h-3 w-3" />;
      default:
        return null;
    }
  };

  // Determine if appointment is completed (complete_status === 0)
  const isCompleted = appointment.complete_status === 0;

  return (
    <AppointmentContextMenu appointment={appointment}>
      <div
        ref={dragRef}
        className={cn(
          'h-full rounded border-l-4 p-2 text-gray-900 shadow-sm hover:shadow-md cursor-grab active:cursor-grabbing relative group',
          !isResizing && 'transition-all hover:scale-[1.01]',
          isResizing && 'z-50',
          isCompleted && 'opacity-60'
        )}
        style={{
          ...(isResizing ? getPreviewStyle() : undefined),
          backgroundColor: appointment.colour || undefined,
          borderLeftColor: appointment.colour ? `color-mix(in srgb, ${appointment.colour} 60%, white)` : undefined,
        }}
        onClick={() => console.log('Open appointment', appointment.id)}
      >
      {/* Completed checkmark icon in top right */}
      {isCompleted && (
        <div className="absolute top-1 right-1">
          <CheckCircle2 className="h-4 w-4 text-gray-900/70" />
        </div>
      )}

      {/* Top resize handle */}
      <div
        data-resize-handle="top"
        className="absolute top-0 left-0 right-0 h-3 cursor-n-resize opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center bg-black/20 hover:bg-black/30 z-10"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          startResize('top', e);
        }}
      >
        <GripHorizontal className="h-3 w-3 opacity-90" />
      </div>

      <div className="flex items-start gap-1 mb-1">
        {getStatusIcon()}
        <div className="text-xs font-semibold truncate flex-1">
          {appointment.subject}
        </div>
      </div>
      {(appointment.client_name || appointment.user_name) && (
        <div className="text-xs opacity-90 truncate">
          {appointment.client_name || appointment.user_name}
        </div>
      )}
      <div className="text-[10px] opacity-75 mt-1">
        {format(previewStartTime, 'h:mm a')} -{' '}
        {format(previewEndTime, 'h:mm a')}
        {isResizing && <span className="ml-1 opacity-60">(resizing)</span>}
      </div>

      {/* Bottom resize handle */}
      <div
        data-resize-handle="bottom"
        className="absolute bottom-0 left-0 right-0 h-3 cursor-s-resize opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center bg-black/20 hover:bg-black/30 z-10"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          startResize('bottom', e);
        }}
      >
        <GripHorizontal className="h-3 w-3 opacity-90" />
      </div>
    </div>
    </AppointmentContextMenu>
  );
}
