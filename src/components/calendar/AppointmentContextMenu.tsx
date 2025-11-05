import { useState } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { CompletionDialog } from '@/components/calendar/CompletionDialog';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { useConfigStore } from '@/stores/configStore';
import { CheckCircle, Trash2, ExternalLink, FileText } from 'lucide-react';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import type { Appointment } from '@/types';

interface AppointmentContextMenuProps {
  appointment: Appointment;
  children: React.ReactNode;
}

export function AppointmentContextMenu({ appointment, children }: AppointmentContextMenuProps) {
  const { deleteAppointment, updateTicket, createOrUpdateAppointment, calendarView, selectedDate, loadAppointments } = useDispatchStore();
  const { config } = useConfigStore();
  const [isCompletionDialogOpen, setIsCompletionDialogOpen] = useState(false);

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this appointment?')) {
      deleteAppointment(appointment.id);
      // Revert ticket to in_progress if it was scheduled
      updateTicket(appointment.ticketId, { status: 'in_progress' });
    }
  };

  const handleOpenAppointment = () => {
    // Build the URL to open in Halo PSA (resourceServer already includes https://)
    const url = `${config.resourceServer}/appointment?id=${appointment.id}&showmenu=false`;

    // Open in a new tab
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleOpenTicket = () => {
    if (!appointment.ticketId) return;

    // Build the URL to open ticket in Halo PSA
    const url = `${config.resourceServer}/tickets?id=${appointment.ticketId}`;

    // Open in a new tab
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleMarkDone = () => {
    setIsCompletionDialogOpen(true);
  };

  const handleComplete = async (noteHtml: string, timeTaken: number) => {
    // Parse the appointment ID
    const haloAppointmentId = parseInt(appointment.id);

    // Wrap the note in HTML paragraph tags
    const formattedNote = noteHtml.trim() ? `<p>${noteHtml}</p>` : '';

    // Send partial appointment update to Halo API
    await createOrUpdateAppointment({
      id: haloAppointmentId,
      complete_status: 0, // 0 = completed
      complete_notehtml: formattedNote,
      complete_timetaken: timeTaken,
    });

    // Also update the ticket status to resolved
    if (appointment.ticketId) {
      updateTicket(appointment.ticketId, { status: 'resolved' });
    }

    // Refresh appointments to show the updated status
    let startDate: Date;
    let endDate: Date;

    switch (calendarView) {
      case 'day':
        startDate = selectedDate;
        endDate = selectedDate;
        break;
      case 'week5':
      case 'week7': {
        startDate = startOfWeek(selectedDate, { weekStartsOn: 1 });
        endDate = endOfWeek(selectedDate, { weekStartsOn: 1 });
        break;
      }
      case 'month': {
        startDate = startOfMonth(selectedDate);
        endDate = endOfMonth(selectedDate);
        break;
      }
    }

    await loadAppointments(startDate, endDate);
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-64">
          <ContextMenuItem onClick={handleOpenAppointment}>
            <ExternalLink className="h-4 w-4 mr-2" />
            Open Appointment
          </ContextMenuItem>

          <ContextMenuItem
            onClick={handleOpenTicket}
            disabled={!appointment.ticketId}
          >
            <FileText className="h-4 w-4 mr-2" />
            Open Ticket
          </ContextMenuItem>

          <ContextMenuSeparator />

          <ContextMenuItem
            onClick={handleMarkDone}
            disabled={appointment.status === 'completed'}
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            Mark Done
          </ContextMenuItem>

          <ContextMenuSeparator />

          <ContextMenuItem onClick={handleDelete} className="text-destructive">
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Appointment
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Completion Dialog */}
      <CompletionDialog
        appointment={appointment}
        open={isCompletionDialogOpen}
        onOpenChange={setIsCompletionDialogOpen}
        onComplete={handleComplete}
      />
    </>
  );
}
