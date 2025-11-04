import { useEffect, useRef, useState } from 'react';
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import type { Ticket, Appointment } from '@/types';

interface DropData {
  agentId: number; // Changed from string to number
  startTime: Date;
}

interface DropHandlers {
  onTicketDrop?: (ticket: Ticket, dropData: DropData) => void;
  onAppointmentDrop?: (appointment: Appointment, dropData: DropData) => void;
}

export function useDroppableSlot(dropData: DropData, handlers: DropHandlers) {
  const ref = useRef<HTMLDivElement>(null);
  const [isDraggedOver, setIsDraggedOver] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    return dropTargetForElements({
      element,
      onDragEnter: () => setIsDraggedOver(true),
      onDragLeave: () => setIsDraggedOver(false),
      onDrop: ({ source }) => {
        setIsDraggedOver(false);
        const data = source.data as {
          type: string;
          ticket?: Ticket;
          appointment?: Appointment;
        };

        if (data.type === 'ticket' && data.ticket && handlers.onTicketDrop) {
          handlers.onTicketDrop(data.ticket, dropData);
        } else if (data.type === 'appointment' && data.appointment && handlers.onAppointmentDrop) {
          handlers.onAppointmentDrop(data.appointment, dropData);
        }
      },
      canDrop: ({ source }) => {
        const data = source.data as { type: string };
        return data.type === 'ticket' || data.type === 'appointment';
      },
    });
  }, [dropData, handlers]);

  return { ref, isDraggedOver };
}
