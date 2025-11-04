import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import type { Appointment } from '@/types';

interface CompletionDialogProps {
  appointment: Appointment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (noteHtml: string, timeTaken: number) => Promise<void>;
}

export function CompletionDialog({
  appointment,
  open,
  onOpenChange,
  onComplete,
}: CompletionDialogProps) {
  // Calculate appointment duration in hours
  const durationMs = appointment.endTime.getTime() - appointment.startTime.getTime();
  const durationHours = durationMs / (1000 * 60 * 60);

  const [noteHtml, setNoteHtml] = useState('');
  const [timeTaken, setTimeTaken] = useState(durationHours.toFixed(2));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await onComplete(noteHtml, parseFloat(timeTaken));
      onOpenChange(false);
      // Reset form
      setNoteHtml('');
      setTimeTaken(durationHours.toFixed(2));
    } catch (error) {
      console.error('Failed to complete appointment:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark Appointment Done</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Appointment Details */}
          <div className="space-y-1">
            <p className="text-sm font-medium">{appointment.subject || 'Appointment'}</p>
            <p className="text-xs text-muted-foreground">
              {appointment.client_name && `${appointment.client_name} / `}
              {appointment.site_name && `${appointment.site_name} / `}
              {appointment.user_name}
            </p>
          </div>

          {/* Completion Note */}
          <div className="space-y-2">
            <Label htmlFor="completion-note">Completion Note</Label>
            <textarea
              id="completion-note"
              value={noteHtml}
              onChange={(e) => setNoteHtml(e.target.value)}
              className="w-full min-h-[100px] px-3 py-2 text-sm border rounded-md resize-y focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Enter completion notes..."
            />
            <p className="text-xs text-muted-foreground">
              Add any notes about the completed appointment
            </p>
          </div>

          {/* Time Taken */}
          <div className="space-y-2">
            <Label htmlFor="time-taken">Time Taken (hours)</Label>
            <Input
              id="time-taken"
              type="number"
              step="0.01"
              min="0"
              value={timeTaken}
              onChange={(e) => setTimeTaken(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Pre-filled with appointment duration: {durationHours.toFixed(2)} hours
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Completing...
              </>
            ) : (
              'Mark Done'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
