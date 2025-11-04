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
    const config = { dayStartHour: 8, dayEndHour: 18, slotIncrement: 15 };
    const slotHeight = 48; // Must match CalendarColumn

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

    const startRow = getGridRow(previewStartTime);
    const endRow = getGridRow(previewEndTime);
    const startOffset = getSubSlotOffset(previewStartTime);
    const endOffset = getSubSlotOffset(previewEndTime);

    // Calculate actual pixel position
    const topPx = (startRow - 1) * slotHeight + startOffset * slotHeight;
    const bottomPx = (endRow - 1) * slotHeight + endOffset * slotHeight;
    const heightPx = bottomPx - topPx;

    return {
      position: 'absolute' as const,
      top: `${topPx}px`,
      left: 0,
      right: 0,
      height: `${heightPx}px`,
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
          'rounded border-l-4 p-2 text-gray-900 shadow-md hover:shadow-lg cursor-grab active:cursor-grabbing relative group',
          !isResizing && 'h-full transition-all hover:scale-[1.02]',
          isResizing && 'z-50',
          isCompleted && 'opacity-60'
        )}
        style={{
          ...(isResizing ? getPreviewStyle() : undefined),
          backgroundColor: appointment.colour || undefined,
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
