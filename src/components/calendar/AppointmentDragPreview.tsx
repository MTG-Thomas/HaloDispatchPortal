import { format } from 'date-fns';
import { Clock, AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Appointment } from '@/types';

interface AppointmentDragPreviewProps {
  appointment: Appointment;
}

export function AppointmentDragPreview({ appointment }: AppointmentDragPreviewProps) {
  const getStatusIcon = () => {
    switch (appointment.status) {
      case 'in_progress':
        return <Clock className="h-3 w-3" />;
      case 'completed':
        return <CheckCircle2 className="h-3 w-3" />;
      case 'cancelled':
        return <AlertCircle className="h-3 w-3" />;
      default:
        return null;
    }
  };

  const isCompleted = appointment.complete_status === 0;

  return (
    <div
      className={cn(
        "rounded border-l-4 p-2 text-gray-900 shadow-lg min-w-[200px] max-w-[280px] opacity-90",
        isCompleted && "opacity-60"
      )}
      style={{
        backgroundColor: appointment.colour || '#6366f1',
        borderLeftColor: appointment.colour
          ? `color-mix(in srgb, ${appointment.colour} 60%, white)`
          : '#4f46e5',
      }}
    >
      <div className="flex items-start gap-1 mb-1">
        {getStatusIcon()}
        <div className="text-xs font-semibold truncate flex-1">
          {appointment.subject}
        </div>
      </div>
      {(appointment.client_name || appointment.user_name) && (
        <div className="text-xs opacity-90 truncate mb-1">
          {appointment.client_name || appointment.user_name}
        </div>
      )}
      <div className="text-xs opacity-80">
        {format(appointment.startTime, 'h:mm a')} - {format(appointment.endTime, 'h:mm a')}
      </div>
    </div>
  );
}
