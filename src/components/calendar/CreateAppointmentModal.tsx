import { useState, useMemo, useCallback } from 'react';
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
import { DispatchSection } from '@/components/dispatch/DispatchSection';
import { useDispatchStore } from '@/stores/useDispatchStore';
import type { DispatchFormData } from '@/types/halo';

interface CreateAppointmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: number;
  startTime: Date;
  endTime: Date;
}

interface FormErrors {
  dispatch?: Partial<Record<keyof DispatchFormData, string>>;
}

/**
 * CreateAppointmentModal Component
 *
 * Simplified modal for creating appointments without tickets
 * Shows only dispatch/appointment fields (no triage)
 */
export function CreateAppointmentModal({
  open,
  onOpenChange,
  agentId,
  startTime,
  endTime,
}: CreateAppointmentModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const { createOrUpdateAppointment, clientCache } = useDispatchStore();

  // Get default appointment type (first by ID from lookup 63)
  const defaultAppointmentTypeId = useMemo(() => {
    const appointmentTypes = clientCache?.lookups
      ?.filter((l) => l.lookupid === 63)
      .sort((a, b) => a.id - b.id);
    return appointmentTypes?.[0]?.id ?? null;
  }, [clientCache]);

  // Initialize form state
  const [formData, setFormData] = useState<DispatchFormData>({
    subject: '',
    start_date: startTime,
    end_date: endTime,
    agent_id: agentId,
    appointment_type_id: defaultAppointmentTypeId,
    attendees: '',
    note_html: '',
    appointment_location: null,
  });

  const [errors, setErrors] = useState<FormErrors>({});

  // Reset form when modal opens with new data
  useState(() => {
    if (open) {
      setFormData({
        subject: '',
        start_date: startTime,
        end_date: endTime,
        agent_id: agentId,
        appointment_type_id: defaultAppointmentTypeId,
        attendees: '',
        note_html: '',
        appointment_location: null,
      });
      setErrors({});
    }
  });

  // Update form data
  const updateFormData = useCallback((updates: Partial<DispatchFormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  }, []);

  // Set duration using preset buttons
  const setDuration = useCallback(
    (minutes: number) => {
      if (formData.start_date) {
        const newEndDate = new Date(
          formData.start_date.getTime() + minutes * 60 * 1000
        );
        updateFormData({ end_date: newEndDate });
      }
    },
    [formData.start_date, updateFormData]
  );

  // Get error for a specific field
  const getError = useCallback(
    (section: 'dispatch', field: string): string | undefined => {
      return errors[section]?.[field as keyof DispatchFormData];
    },
    [errors]
  );

  // Validate form
  const validate = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.start_date) {
      newErrors.dispatch = {
        ...newErrors.dispatch,
        start_date: 'Start date is required',
      };
    }
    if (!formData.end_date) {
      newErrors.dispatch = {
        ...newErrors.dispatch,
        end_date: 'End date is required',
      };
    }
    if (formData.start_date && formData.end_date) {
      if (formData.end_date <= formData.start_date) {
        newErrors.dispatch = {
          ...newErrors.dispatch,
          end_date: 'End date must be after start date',
        };
      }
    }
    if (!formData.agent_id) {
      newErrors.dispatch = {
        ...newErrors.dispatch,
        agent_id: 'Agent is required',
      };
    }
    if (!formData.appointment_type_id) {
      newErrors.dispatch = {
        ...newErrors.dispatch,
        appointment_type_id: 'Appointment type is required',
      };
    }
    if (!formData.subject.trim()) {
      newErrors.dispatch = {
        ...newErrors.dispatch,
        subject: 'Subject is required',
      };
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

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
      // Create appointment without ticket
      await createOrUpdateAppointment({
        start_date: formData.start_date!.toISOString(),
        end_date: formData.end_date!.toISOString(),
        event_type: 'a', // Appointment
        appointment_type_id: formData.appointment_type_id!,
        reminderminutes: 15,
        agent_status: 1,
        open_appointment_status: 0,
        appointment_location: formData.appointment_location || 0,
        subject: formData.subject,
        ticket_id: 0, // No ticket association
        note_html: formData.note_html || '<p></p>',
        agent_id: formData.agent_id!,
        attendees: formData.attendees || '',
        // No client/site/user for standalone appointments
        client_id: 0,
        site_id: 0,
        user_id: 0,
      });

      toast.success('Appointment created successfully');
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to create appointment:', error);
      toast.error('Failed to create appointment', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Create Appointment</DialogTitle>
          <DialogDescription>
            Schedule a new appointment
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="py-4">
            <DispatchSection
              formData={formData}
              onUpdate={updateFormData}
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
            {submitting ? 'Creating...' : 'Create Appointment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
