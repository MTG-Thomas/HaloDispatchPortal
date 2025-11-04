import { useState, useCallback, useEffect } from 'react';
import type { Appointment } from '@/types';

type ResizeEdge = 'top' | 'bottom';

interface ResizeState {
  isResizing: boolean;
  edge: ResizeEdge | null;
  originalStartTime: Date | null;
  originalEndTime: Date | null;
  previewStartTime: Date | null;
  previewEndTime: Date | null;
  initialMouseY: number | null;
}

export function useAppointmentResize(
  appointment: Appointment,
  onResizeComplete: (appointmentId: string, newStartTime: Date, newEndTime: Date) => void
) {
  const [resizeState, setResizeState] = useState<ResizeState>({
    isResizing: false,
    edge: null,
    originalStartTime: null,
    originalEndTime: null,
    previewStartTime: null,
    previewEndTime: null,
    initialMouseY: null,
  });

  const startResize = useCallback((edge: ResizeEdge, event: React.MouseEvent) => {
    event.stopPropagation();
    setResizeState({
      isResizing: true,
      edge,
      originalStartTime: appointment.startTime,
      originalEndTime: appointment.endTime,
      previewStartTime: appointment.startTime,
      previewEndTime: appointment.endTime,
      initialMouseY: event.clientY,
    });
  }, [appointment]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!resizeState.isResizing || !resizeState.edge || resizeState.initialMouseY === null) return;

    // Only start resizing after moving at least 5 pixels from initial click
    const mouseDelta = Math.abs(event.clientY - resizeState.initialMouseY);
    if (mouseDelta < 5) return;

    // Get the calendar grid element to calculate position
    const calendarElement = (event.target as HTMLElement).closest('[data-calendar-day]');
    if (!calendarElement) return;

    const rect = calendarElement.getBoundingClientRect();
    const y = event.clientY - rect.top;

    // Calendar uses 3px per minute (180px per hour, 45px per 15-min slot)
    const pixelsPerMinute = 3;
    const totalMinutes = y / pixelsPerMinute;

    // Round to nearest 15 minutes
    const roundedMinutes = Math.round(totalMinutes / 15) * 15;

    // Calendar starts at 8 AM (480 minutes from midnight)
    const workDayStartMinutes = 8 * 60;
    const actualMinutesFromMidnight = workDayStartMinutes + roundedMinutes;

    // Calculate hours and minutes
    const hours = Math.floor(actualMinutesFromMidnight / 60);
    const minutes = actualMinutesFromMidnight % 60;

    // Get the date part from the appropriate time (start for top resize, end for bottom resize)
    const referenceTime = resizeState.edge === 'top' ? resizeState.originalStartTime! : resizeState.originalEndTime!;
    const newTime = new Date(referenceTime);
    newTime.setHours(hours, minutes, 0, 0);

    if (resizeState.edge === 'top') {
      // Resizing from top - adjust start time
      if (newTime < resizeState.originalEndTime!) {
        setResizeState(prev => ({
          ...prev,
          previewStartTime: newTime,
          previewEndTime: prev.originalEndTime,
        }));
      }
    } else {
      // Resizing from bottom - adjust end time
      if (newTime > resizeState.originalStartTime!) {
        setResizeState(prev => ({
          ...prev,
          previewStartTime: prev.originalStartTime,
          previewEndTime: newTime,
        }));
      }
    }
  }, [resizeState]);

  const handleMouseUp = useCallback(() => {
    if (resizeState.isResizing && resizeState.previewStartTime && resizeState.previewEndTime) {
      // Only call onResizeComplete if the times actually changed
      const startChanged = resizeState.previewStartTime.getTime() !== resizeState.originalStartTime!.getTime();
      const endChanged = resizeState.previewEndTime.getTime() !== resizeState.originalEndTime!.getTime();

      if (startChanged || endChanged) {
        onResizeComplete(
          appointment.id,
          resizeState.previewStartTime,
          resizeState.previewEndTime
        );
      }
    }

    setResizeState({
      isResizing: false,
      edge: null,
      originalStartTime: null,
      originalEndTime: null,
      previewStartTime: null,
      previewEndTime: null,
      initialMouseY: null,
    });
  }, [resizeState, appointment.id, onResizeComplete]);

  useEffect(() => {
    if (resizeState.isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [resizeState.isResizing, handleMouseMove, handleMouseUp]);

  return {
    startResize,
    isResizing: resizeState.isResizing,
    previewStartTime: resizeState.previewStartTime || appointment.startTime,
    previewEndTime: resizeState.previewEndTime || appointment.endTime,
  };
}
