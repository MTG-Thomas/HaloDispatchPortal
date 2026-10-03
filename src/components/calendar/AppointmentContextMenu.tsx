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
import { CheckCircle, ExternalLink, FileText } from 'lucide-react';
import { getViewDateRange } from '@/lib/dates';
import { APPOINTMENT_COMPLETE_STATUS } from '@/lib/constants';
import type { Appointment } from '@/types';

interface AppointmentContextMenuProps {
  appointment: Appointment;
  children: React.ReactNode;
}

export function AppointmentContextMenu({ appointment, children }: AppointmentContextMenuProps) {
  const { createOrUpdateAppointment, calendarView, selectedDate, loadAppointments } = useDispatchStore();
  const { config } = useConfigStore();
  const [isCompletionDialogOpen, setIsCompletionDialogOpen] = useState(false);

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
      complete_status: APPOINTMENT_COMPLETE_STATUS,
      complete_notehtml: formattedNote,
      complete_timetaken: timeTaken,
    });

    // Refresh appointments to show the updated status
    const { startDate, endDate } = getViewDateRange(calendarView, selectedDate);
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
