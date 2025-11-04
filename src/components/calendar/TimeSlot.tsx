import { useState } from 'react';
import { useDroppableSlot } from '@/hooks/useDroppableSlot';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { TimeSlotContextMenu } from './TimeSlotContextMenu';
import { TriageDispatchModal } from '@/components/dispatch/TriageDispatchModal';
import { cn } from '@/lib/utils';
import type { Ticket, Appointment } from '@/types';

interface TimeSlotProps {
  agentId: number; // Changed from string to number
  startTime: Date;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  isCurrentTime?: boolean;
}

export function TimeSlot({ agentId, startTime, className, style, children, isCurrentTime = false }: TimeSlotProps) {
  const { moveAppointment, haloTickets } = useDispatchStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [droppedTicketId, setDroppedTicketId] = useState<number | null>(null);
  const [dropLocation, setDropLocation] = useState<{ agentId: number; startTime: Date } | undefined>();

  const handleTicketDrop = (ticket: Ticket, dropData: { agentId: number; startTime: Date }) => {
    // Open triage/dispatch modal instead of directly scheduling
    // Need to find the full Halo ticket from the store
    const ticketId = parseInt(ticket.id);

    setDroppedTicketId(ticketId);
    setDropLocation({
      agentId: dropData.agentId,
      startTime: dropData.startTime,
    });
    setModalOpen(true);
  };

  const handleAppointmentDrop = (appointment: Appointment, dropData: { agentId: number; startTime: Date }) => {
    // Appointments are just moved/rescheduled, not triaged
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
    <>
      <TimeSlotContextMenu agentId={agentId} startTime={startTime}>
        <div
          ref={ref}
          className={cn(
            'border-t transition-colors',
            isCurrentTime
              ? 'border-primary/70 border-t-2'
              : 'border-border/50',
            isDraggedOver && 'bg-primary/10 border-primary',
            className
          )}
          style={style}
        >
          {children}
        </div>
      </TimeSlotContextMenu>

      {/* Triage & Dispatch Modal */}
      {droppedTicketId !== null && (() => {
        const ticket = haloTickets.find((t) => t.id === droppedTicketId);
        if (!ticket) return null;
        return (
          <TriageDispatchModal
            open={modalOpen}
            onOpenChange={setModalOpen}
            ticket={ticket}
            dropLocation={dropLocation}
          />
        );
      })()}
    </>
  );
}
