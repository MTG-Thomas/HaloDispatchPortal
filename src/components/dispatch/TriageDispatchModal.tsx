import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { TriageSection } from './TriageSection';
import { DispatchSection } from './DispatchSection';
import { useTriageDispatchForm } from '@/hooks/useTriageDispatchForm';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { createOrUpdateTicket } from '@/services/halo-api';
import type { Ticket as HaloTicket } from '@/types/halo';

interface TriageDispatchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket?: HaloTicket; // Optional for creating new tickets
  dropLocation?: {
    agentId: number;
    startTime: Date;
    endTime?: Date; // Optional end time from timeslot selection
  };
}

/**
 * TriageDispatchModal Component
 *
 * Main modal for triaging tickets and creating appointments
 * Two-column layout: Triage on left, Dispatch on right
 * Handles form submission with partial success scenarios
 */
export function TriageDispatchModal({
  open,
  onOpenChange,
  ticket,
  dropLocation,
}: TriageDispatchModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const { createOrUpdateAppointment, clientCache } = useDispatchStore();

  const {
    triage,
    dispatch,
    updateTriage,
    updateDispatch,
    handleUserSelect,
    setDuration,
    triageHasChanged,
    validate,
    getError,
  } = useTriageDispatchForm({
    ticket,
    clientCache,
    dropLocation,
  });

  const handleSubmit = async () => {
    // Validate form
    if (!validate()) {
      // Check if error is due to Unknown client
      const isUnknownClient = triage.user?.client_id === 1;
      toast.error('Validation failed', {
        description: isUnknownClient
          ? 'Cannot save to Unknown client. Please select a valid user.'
          : 'Please fill in all required fields',
      });
      return;
    }

    setSubmitting(true);

    try {
      let ticketUpdateSuccess = true;
      let createdOrUpdatedTicketId = ticket?.id;
      const isNewTicket = !ticket || !ticket.id || ticket.id <= 0;

      // Step 1: Create or update ticket if triage fields changed or if creating new
      if (triageHasChanged || isNewTicket) {
        try {
          const ticketData: Record<string, string | number> = {
            tickettype_id: triage.tickettype_id!.toString(),
            summary: triage.summary,
            details_html: ticket?.details || '<p></p>',
            impact: triage.impact.toString(),
            urgency: triage.urgency.toString(),
            category_1: triage.category_1,
            team: triage.team,
            agent_id: triage.agent_id.toString(),
            user_id: triage.user_id!,
          };

          // Only include ID if updating existing ticket
          if (!isNewTicket) {
            ticketData.id = ticket!.id;
          }

          const result = await createOrUpdateTicket(ticketData);
          // The API returns an array with the created/updated ticket
          createdOrUpdatedTicketId = result[0]?.id;
        } catch (error) {
          console.error('Failed to create/update ticket:', error);
          ticketUpdateSuccess = false;
          throw error; // Stop here, don't create appointment if ticket creation/update fails
        }
      }

      // Step 2: Create appointment (always)
      try {
        await createOrUpdateAppointment({
          start_date: dispatch.start_date!.toISOString(),
          end_date: dispatch.end_date!.toISOString(),
          event_type: 'a', // Appointment
          appointment_type_id: dispatch.appointment_type_id!,
          reminderminutes: 15,
          agent_status: 1,
          open_appointment_status: 0,
          appointment_location: dispatch.appointment_location || 0,
          subject: dispatch.subject,
          ticket_id: createdOrUpdatedTicketId || 0,
          note_html: dispatch.note_html || '<p></p>',
          agent_id: dispatch.agent_id!,
          attendees: dispatch.attendees || '',
          // Include client/site/user from triage form
          client_id: triage.user?.client_id || 0,
          site_id: triage.user?.site_id || 0,
          user_id: triage.user_id || 0,
        });

        // Success!
        const successMessage = isNewTicket
          ? 'Ticket created and appointment scheduled'
          : triageHasChanged
          ? 'Ticket updated and appointment created'
          : 'Appointment created';

        toast.success('Appointment scheduled successfully', {
          description: successMessage,
        });

        onOpenChange(false);
      } catch (error) {
        console.error('Failed to create appointment:', error);

        if (ticketUpdateSuccess && (triageHasChanged || isNewTicket)) {
          // Partial success: ticket created/updated but appointment failed
          const partialSuccessMsg = isNewTicket
            ? 'Ticket was created successfully, but the appointment could not be created. Please try creating the appointment manually.'
            : 'Ticket was updated successfully, but the appointment could not be created. Please try creating the appointment manually.';

          toast.error('Appointment creation failed', {
            description: partialSuccessMsg,
          });
          onOpenChange(false); // Close modal per user preference
        } else {
          toast.error('Failed to create appointment', {
            description:
              error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    } catch (error) {
      // Ticket creation/update failed, already logged and toasted above
      const errorMsg = isNewTicket ? 'Failed to create ticket' : 'Failed to update ticket';
      toast.error(errorMsg, {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Triage & Dispatch Ticket</DialogTitle>
          <DialogDescription>
            Fill out ticket details and schedule an appointment
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="grid grid-cols-2 gap-6 py-4">
            {/* Left Column: Triage */}
            <TriageSection
              formData={triage}
              onUpdate={updateTriage}
              onUserSelect={handleUserSelect}
              getError={getError}
            />

            {/* Right Column: Dispatch */}
            <DispatchSection
              formData={dispatch}
              onUpdate={updateDispatch}
              setDuration={setDuration}
              getError={getError}
            />
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitting ? 'Scheduling...' : 'Schedule Appointment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
