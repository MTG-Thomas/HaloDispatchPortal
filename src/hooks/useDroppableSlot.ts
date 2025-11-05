import { useEffect, useRef, useState } from 'react';
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import type { Ticket, Appointment } from '@/types';
import { useDrag } from '@/contexts/DragContext';

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
  const { setHoveredSlot } = useDrag();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    return dropTargetForElements({
      element,
      onDragEnter: ({ source }) => {
        setIsDraggedOver(true);
        const data = source.data as { type: string };
        // Only update hovered slot for appointments (not tickets)
        // Don't clear on leave - only update on enter to prevent flickering
        if (data.type === 'appointment') {
          setHoveredSlot(dropData);
        }
      },
      onDragLeave: () => {
        setIsDraggedOver(false);
        // Don't clear hover state here - causes flickering
        // It will be cleared on drop or when entering another slot
      },
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

        // Don't clear hover state here - let the draggable component handle it
        // This prevents race conditions
      },
      canDrop: ({ source }) => {
        const data = source.data as { type: string };
        return data.type === 'ticket' || data.type === 'appointment';
      },
    });
  }, [dropData, handlers, setHoveredSlot]);

  return { ref, isDraggedOver };
}
