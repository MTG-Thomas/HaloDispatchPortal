import { useDroppableSlot } from '@/hooks/useDroppableSlot';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { TimeSlotContextMenu } from './TimeSlotContextMenu';
import { cn } from '@/lib/utils';
import type { Ticket, Appointment } from '@/types';

interface TimeSlotProps {
  agentId: string;
  startTime: Date;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export function TimeSlot({ agentId, startTime, className, style, children }: TimeSlotProps) {
  const { scheduleTicket, moveAppointment } = useDispatchStore();

  const handleTicketDrop = (ticket: Ticket, dropData: { agentId: string; startTime: Date }) => {
    scheduleTicket(ticket.id, dropData.agentId, dropData.startTime);
  };

  const handleAppointmentDrop = (appointment: Appointment, dropData: { agentId: string; startTime: Date }) => {
    moveAppointment(appointment.id, dropData.startTime, dropData.agentId);
  };

  const { ref, isDraggedOver } = useDroppableSlot(
    { agentId, startTime },
    {
      onTicketDrop: handleTicketDrop,
      onAppointmentDrop: handleAppointmentDrop,
    }
  );

  return (
    <TimeSlotContextMenu agentId={agentId} startTime={startTime}>
      <div
        ref={ref}
        className={cn(
          'absolute w-full border-t border-border/50 transition-colors',
          isDraggedOver && 'bg-primary/10 border-primary',
          className
        )}
        style={style}
      >
        {children}
      </div>
    </TimeSlotContextMenu>
  );
}
