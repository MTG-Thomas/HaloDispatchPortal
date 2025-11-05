import { useState, useEffect } from 'react';
import { useDroppableSlot } from '@/hooks/useDroppableSlot';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { useTimeslotSelection } from '@/hooks/useTimeslotSelection';
import { useDrag } from '@/contexts/DragContext';
import { TimeSlotContextMenu } from './TimeSlotContextMenu';
import { TriageDispatchModal } from '@/components/dispatch/TriageDispatchModal';
import { CreateAppointmentModal } from './CreateAppointmentModal';
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
  const { setDraggedAppointment, setHoveredSlot } = useDrag();
  const {
    isSlotSelected,
    isFirstSelectedSlot,
    isLastSelectedSlot,
    clearSelection,
    getSelectionInfo,
    startDragSelect,
    updateDragSelect,
    endDragSelect,
    setDraggedOver: setSelectionDraggedOver,
    isDraggedOver: isSelectionDraggedOver
  } = useTimeslotSelection();
  const [triageModalOpen, setTriageModalOpen] = useState(false);
  const [appointmentModalOpen, setAppointmentModalOpen] = useState(false);
  const [droppedTicketId, setDroppedTicketId] = useState<number | null>(null);
  const [isCreatingNewTicket, setIsCreatingNewTicket] = useState(false);
  const [dropLocation, setDropLocation] = useState<{ agentId: number; startTime: Date; endTime?: Date } | undefined>();

  // Check if this slot is selected
  const isSelected = isSlotSelected(agentId, startTime);
  const isFirstSelected = isFirstSelectedSlot(agentId, startTime);
  const isLastSelected = isLastSelectedSlot(agentId, startTime);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only start drag-select on left click
    if (e.button !== 0) return;

    // Prevent text selection during drag
    e.preventDefault();

    // Start drag-to-select
    startDragSelect(agentId, startTime);
  };

  const handleMouseEnter = () => {
    // Update selection as mouse moves during drag
    updateDragSelect(agentId, startTime);
  };

  const handleMouseUp = () => {
    // End drag-to-select
    endDragSelect();
  };

  const handleCreateTicket = () => {
    // Get selection info if this slot is part of a selection
    const selectionInfo = getSelectionInfo();
    const useSelection = isSelected && selectionInfo.agentId === agentId;

    // Set flag to indicate we're creating a new ticket (no ticket to load)
    setIsCreatingNewTicket(true);
    setDroppedTicketId(null); // No ticket ID for new tickets

    setDropLocation({
      agentId: useSelection ? selectionInfo.agentId! : agentId,
      startTime: useSelection ? selectionInfo.startTime! : startTime,
      endTime: useSelection ? selectionInfo.endTime! : undefined,
    });

    setTriageModalOpen(true);

    // Clear selection after opening modal
    if (useSelection) {
      clearSelection();
    }
  };

  const handleCreateAppointment = () => {
    // Get selection info if this slot is part of a selection
    const selectionInfo = getSelectionInfo();
    const useSelection = isSelected && selectionInfo.agentId === agentId;

    // Open appointment modal
    setDropLocation({
      agentId: useSelection ? selectionInfo.agentId! : agentId,
      startTime: useSelection ? selectionInfo.startTime! : startTime,
      endTime: useSelection ? selectionInfo.endTime! : new Date(startTime.getTime() + 30 * 60 * 1000),
    });
    setAppointmentModalOpen(true);

    // Clear selection after opening modal
    if (useSelection) {
      clearSelection();
    }
  };

  const handleTicketDrop = (ticket: Ticket, dropData: { agentId: number; startTime: Date }) => {
    // Check if dropping on a selection
    const selectionInfo = getSelectionInfo();
    const isDropOnSelection = isSelected && selectionInfo.agentId === dropData.agentId;

    // Open triage/dispatch modal instead of directly scheduling
    // Need to find the full Halo ticket from the store
    const ticketId = parseInt(ticket.id);

    setIsCreatingNewTicket(false); // We have an existing ticket
    setDroppedTicketId(ticketId);

    // If dropping on selection, use selection start and end time
    // Otherwise use default drop location
    setDropLocation({
      agentId: dropData.agentId,
      startTime: isDropOnSelection ? selectionInfo.startTime! : dropData.startTime,
      endTime: isDropOnSelection ? selectionInfo.endTime! : undefined,
    });
    setTriageModalOpen(true);

    // Clear selection drag state
    setSelectionDraggedOver(false);

    // Clear selection after drop
    if (isDropOnSelection) {
      clearSelection();
    }
  };

  const handleAppointmentDrop = (appointment: Appointment, dropData: { agentId: number; startTime: Date }) => {
    // Appointments are just moved/rescheduled, not triaged
    moveAppointment(appointment.id, dropData.startTime, dropData.agentId);

    // Clear selection drag state
    setSelectionDraggedOver(false);

    // Clear drag state immediately to remove placeholder
    setDraggedAppointment(null);
    setHoveredSlot(null);
  };

  const { ref, isDraggedOver } = useDroppableSlot(
    { agentId, startTime },
    {
      onTicketDrop: handleTicketDrop,
      onAppointmentDrop: handleAppointmentDrop,
    }
  );

  // Sync individual slot drag state with selection drag state
  // Set to true immediately when dragging over a selected slot
  // Use a small delay before clearing to avoid flickering between slots
  useEffect(() => {
    if (isSelected && isDraggedOver) {
      setSelectionDraggedOver(true);
    } else if (isSelected && !isDraggedOver && isSelectionDraggedOver) {
      // Small delay before clearing to handle transitions between slots
      const timeout = setTimeout(() => {
        setSelectionDraggedOver(false);
      }, 50);
      return () => clearTimeout(timeout);
    }
  }, [isSelected, isDraggedOver, isSelectionDraggedOver, setSelectionDraggedOver]);

  return (
    <>
      <TimeSlotContextMenu
        agentId={agentId}
        startTime={startTime}
        onCreateTicket={handleCreateTicket}
        onCreateAppointment={handleCreateAppointment}
      >
        <div
          ref={ref}
          onMouseDown={handleMouseDown}
          onMouseEnter={handleMouseEnter}
          onMouseUp={handleMouseUp}
          className={cn(
            'transition-colors cursor-pointer select-none',
            // Top border: show for unselected or first selected slot
            !isSelected && 'border-t',
            !isSelected && isCurrentTime && 'border-primary/70 border-t-2',
            !isSelected && !isCurrentTime && 'border-border/50',
            isFirstSelected && 'border-t border-primary',
            // Explicitly remove top border for middle/last selected slots
            // This overrides hour mark borders (border-t-2) from CalendarColumn
            isSelected && !isFirstSelected && '!border-t-0',
            // Bottom border: only if last in selection
            isLastSelected && 'border-b border-primary',
            // Selection styling - use selection's drag state for all selected slots
            !isSelected && isDraggedOver && 'bg-primary/10',
            isSelected && !isSelectionDraggedOver && 'bg-primary/20 border-l border-r border-primary',
            isSelected && isSelectionDraggedOver && 'bg-primary/30 border-l border-r border-primary',
            // Hover only when not selected
            !isSelected && 'hover:bg-primary/10',
            className
          )}
          style={style}
        >
          {children}
        </div>
      </TimeSlotContextMenu>

      {/* Triage & Dispatch Modal (for dropped tickets or new tickets) */}
      {triageModalOpen && (() => {
        // For new tickets, don't pass a ticket prop
        if (isCreatingNewTicket) {
          return (
            <TriageDispatchModal
              open={triageModalOpen}
              onOpenChange={setTriageModalOpen}
              dropLocation={dropLocation}
            />
          );
        }

        // For existing tickets, find the ticket
        if (droppedTicketId !== null) {
          const ticket = haloTickets.find((t) => t.id === droppedTicketId);
          if (!ticket) return null;
          return (
            <TriageDispatchModal
              open={triageModalOpen}
              onOpenChange={setTriageModalOpen}
              ticket={ticket}
              dropLocation={dropLocation}
            />
          );
        }

        return null;
      })()}

      {/* Create Appointment Modal */}
      {dropLocation && appointmentModalOpen && (
        <CreateAppointmentModal
          open={appointmentModalOpen}
          onOpenChange={setAppointmentModalOpen}
          agentId={dropLocation.agentId}
          startTime={dropLocation.startTime}
          endTime={dropLocation.endTime || new Date(dropLocation.startTime.getTime() + 30 * 60 * 1000)}
        />
      )}
    </>
  );
}
