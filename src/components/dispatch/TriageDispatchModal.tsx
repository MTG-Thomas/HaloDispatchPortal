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
  ticket: HaloTicket;
  dropLocation?: {
    agentId: number;
    startTime: Date;
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
      toast.error('Validation failed', {
        description: 'Please fill in all required fields',
      });
      return;
    }

    setSubmitting(true);

    try {
      let ticketUpdateSuccess = true;

      // Step 1: Update ticket if triage fields changed
      if (triageHasChanged) {
        try {
          await createOrUpdateTicket({
            tickettype_id: triage.tickettype_id!.toString(),
            summary: triage.summary,
            details_html: ticket.details || '<p></p>', // Keep existing details
            impact: triage.impact.toString(),
            urgency: triage.urgency.toString(),
            category_1: triage.category_1,
            team: triage.team,
            agent_id: triage.agent_id.toString(),
            user_id: triage.user_id!,
          });
        } catch (error) {
          console.error('Failed to update ticket:', error);
          ticketUpdateSuccess = false;
          throw error; // Stop here, don't create appointment if ticket update fails
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
          ticket_id: ticket.id,
          note_html: dispatch.note_html || '<p></p>',
          agent_id: dispatch.agent_id!,
          attendees: dispatch.attendees || '',
          // Include client/site/user from ticket
          client_id: ticket.client_id,
          site_id: ticket.site_id,
          user_id: ticket.user_id,
        });

        // Success!
        toast.success('Appointment scheduled successfully', {
          description: triageHasChanged
            ? 'Ticket updated and appointment created'
            : 'Appointment created',
        });

        onOpenChange(false);
      } catch (error) {
        console.error('Failed to create appointment:', error);

        if (ticketUpdateSuccess && triageHasChanged) {
          // Partial success: ticket updated but appointment failed
          toast.error('Appointment creation failed', {
            description:
              'Ticket was updated successfully, but the appointment could not be created. Please try creating the appointment manually.',
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
      // Ticket update failed, already logged and toasted above
      toast.error('Failed to update ticket', {
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
