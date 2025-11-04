import { useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AgentCombobox } from './AgentCombobox';
import { SiteCombobox } from './SiteCombobox';
import { AttendeesCombobox } from './AttendeesCombobox';
import { useDispatchStore } from '@/stores/useDispatchStore';
import type { DispatchFormData } from '@/types/halo';

interface DispatchSectionProps {
  formData: DispatchFormData;
  onUpdate: (updates: Partial<DispatchFormData>) => void;
  setDuration: (minutes: number) => void;
  getError: (section: 'triage' | 'dispatch', field: string) => string | undefined;
}

/**
 * DispatchSection Component
 *
 * Right column of the triage/dispatch modal
 * Contains all fields needed to create an appointment
 */
export function DispatchSection({
  formData,
  onUpdate,
  setDuration,
  getError,
}: DispatchSectionProps) {
  const { clientCache } = useDispatchStore();

  // Duration presets in minutes
  const durationPresets = [15, 30, 45, 60];

  // Calculate current duration in minutes
  const currentDuration = useMemo(() => {
    if (!formData.start_date || !formData.end_date) return null;
    const durationMs = formData.end_date.getTime() - formData.start_date.getTime();
    return Math.round(durationMs / (1000 * 60)); // Convert to minutes
  }, [formData.start_date, formData.end_date]);

  // Get appointment types from clientCache lookups (lookup ID 63)
  const appointmentTypes = useMemo(() => {
    const types = clientCache?.lookups?.filter((l) => l.lookupid === 63) || [];
    return types;
  }, [clientCache]);

  // Get selected appointment type
  const selectedAppointmentType = useMemo(() => {
    return appointmentTypes.find(
      (type) => type.id === formData.appointment_type_id
    );
  }, [appointmentTypes, formData.appointment_type_id]);

  // Check if attendees field should be shown (when value10_bool is false)
  const showAttendees = selectedAppointmentType
    ? !selectedAppointmentType.value10_bool
    : true;

  // Format date for input[type="date"] (YYYY-MM-DD)
  const formatDateForInput = (date: Date | null): string => {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Format time for input[type="time"] (HH:MM)
  const formatTimeForInput = (date: Date | null): string => {
    if (!date) return '';
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  // Parse date and time inputs and update formData
  const handleDateTimeChange = (
    field: 'start_date' | 'end_date',
    dateValue?: string,
    timeValue?: string
  ) => {
    const currentDate = formData[field];
    const newDate = new Date(currentDate || new Date());

    if (dateValue !== undefined) {
      const [year, month, day] = dateValue.split('-').map(Number);
      newDate.setFullYear(year, month - 1, day);
    }

    if (timeValue !== undefined) {
      const [hours, minutes] = timeValue.split(':').map(Number);
      newDate.setHours(hours, minutes, 0, 0);
    }

    onUpdate({ [field]: newDate });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Dispatch</h3>
        <p className="text-sm text-muted-foreground">
          Schedule appointment details
        </p>
      </div>

      {/* Subject */}
      <div className="space-y-2">
        <Label htmlFor="subject">
          Subject <span className="text-red-500">*</span>
        </Label>
        <Input
          id="subject"
          value={formData.subject}
          onChange={(e) => onUpdate({ subject: e.target.value })}
          placeholder="Enter appointment subject..."
          className={getError('dispatch', 'subject') ? 'border-red-500' : ''}
        />
        {getError('dispatch', 'subject') && (
          <p className="text-xs text-red-500">{getError('dispatch', 'subject')}</p>
        )}
      </div>

      {/* Start Date & Time */}
      <div className="space-y-2">
        <Label htmlFor="start_date">
          Start Date & Time <span className="text-red-500">*</span>
        </Label>
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="date"
            value={formatDateForInput(formData.start_date)}
            onChange={(e) => handleDateTimeChange('start_date', e.target.value)}
            className={getError('dispatch', 'start_date') ? 'border-red-500' : ''}
          />
          <Input
            type="time"
            value={formatTimeForInput(formData.start_date)}
            onChange={(e) =>
              handleDateTimeChange('start_date', undefined, e.target.value)
            }
            className={getError('dispatch', 'start_date') ? 'border-red-500' : ''}
          />
        </div>
        {getError('dispatch', 'start_date') && (
          <p className="text-xs text-red-500">{getError('dispatch', 'start_date')}</p>
        )}
      </div>

      {/* Duration Presets */}
      <div className="space-y-2">
        <Label>Duration Presets</Label>
        <div className="flex gap-2">
          {durationPresets.map((minutes) => {
            const isActive = currentDuration === minutes;
            return (
              <Button
                key={minutes}
                type="button"
                variant={isActive ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDuration(minutes)}
                disabled={!formData.start_date}
              >
                {minutes} min
              </Button>
            );
          })}
        </div>
      </div>

      {/* End Date & Time */}
      <div className="space-y-2">
        <Label htmlFor="end_date">
          End Date & Time <span className="text-red-500">*</span>
        </Label>
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="date"
            value={formatDateForInput(formData.end_date)}
            onChange={(e) => handleDateTimeChange('end_date', e.target.value)}
            className={getError('dispatch', 'end_date') ? 'border-red-500' : ''}
          />
          <Input
            type="time"
            value={formatTimeForInput(formData.end_date)}
            onChange={(e) =>
              handleDateTimeChange('end_date', undefined, e.target.value)
            }
            className={getError('dispatch', 'end_date') ? 'border-red-500' : ''}
          />
        </div>
        {getError('dispatch', 'end_date') && (
          <p className="text-xs text-red-500">{getError('dispatch', 'end_date')}</p>
        )}
      </div>

      {/* Agent */}
      <div className="space-y-2">
        <Label htmlFor="agent">
          Agent <span className="text-red-500">*</span>
        </Label>
        <AgentCombobox
          value={formData.agent_id}
          onValueChange={(value) => onUpdate({ agent_id: value })}
          error={getError('dispatch', 'agent_id')}
        />
      </div>

      {/* Appointment Type */}
      <div className="space-y-2">
        <Label htmlFor="appointment_type">
          Appointment Type <span className="text-red-500">*</span>
        </Label>
        <Select
          value={formData.appointment_type_id?.toString() || ''}
          onValueChange={(value) =>
            onUpdate({ appointment_type_id: parseInt(value) })
          }
        >
          <SelectTrigger
            className={
              getError('dispatch', 'appointment_type_id') ? 'border-red-500' : ''
            }
          >
            <SelectValue placeholder="Select appointment type..." />
          </SelectTrigger>
          <SelectContent>
            {appointmentTypes.map((type) => (
              <SelectItem key={type.id} value={type.id.toString()}>
                <div className="flex items-center gap-2">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: type.value2 }}
                  />
                  {type.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {getError('dispatch', 'appointment_type_id') && (
          <p className="text-xs text-red-500">
            {getError('dispatch', 'appointment_type_id')}
          </p>
        )}
      </div>

      {/* Attendees (conditional on appointment type) */}
      {showAttendees && (
        <div className="space-y-2">
          <Label htmlFor="attendees">Attendees</Label>
          <AttendeesCombobox
            value={formData.attendees}
            onValueChange={(value) => onUpdate({ attendees: value })}
          />
        </div>
      )}

      {/* Site */}
      <div className="space-y-2">
        <Label htmlFor="site">Appointment Location</Label>
        <SiteCombobox
          value={formData.appointment_location}
          onValueChange={(value) => onUpdate({ appointment_location: value })}
        />
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={formData.note_html.replace(/<[^>]*>/g, '')} // Strip HTML tags for display
          onChange={(e) => onUpdate({ note_html: `<p>${e.target.value}</p>` })}
          placeholder="Add appointment notes..."
          rows={3}
        />
      </div>
    </div>
  );
}
