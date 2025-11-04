import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Calendar, FileText } from 'lucide-react';

interface TimeSlotContextMenuProps {
  agentId: number;
  startTime: Date;
  children: React.ReactNode;
  onCreateTicket?: () => void;
  onCreateAppointment?: () => void;
}

/**
 * Context menu for calendar timeslots
 * Provides actions for creating tickets and appointments
 */
export function TimeSlotContextMenu({
  children,
  onCreateTicket,
  onCreateAppointment,
}: TimeSlotContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onClick={onCreateTicket}>
          <FileText className="h-4 w-4 mr-2" />
          Create New Ticket
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onClick={onCreateAppointment}>
          <Calendar className="h-4 w-4 mr-2" />
          Create Appointment
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
