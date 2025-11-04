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
    });
  }, [appointment]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!resizeState.isResizing || !resizeState.edge) return;

    // Get the calendar grid element to calculate position
    const calendarElement = (event.target as HTMLElement).closest('[data-calendar-day]');
    if (!calendarElement) return;

    const rect = calendarElement.getBoundingClientRect();
    const y = event.clientY - rect.top;

    // Each hour is 60px (from the views)
    const hourHeight = 60;
    const hourOffset = Math.round(y / hourHeight);

    // Get the base date from the appointment
    const baseDate = new Date(appointment.startTime);
    baseDate.setHours(8 + hourOffset, 0, 0, 0); // Calendar starts at 8 AM

    if (resizeState.edge === 'top') {
      // Resizing from top - adjust start time
      const newStartTime = baseDate;

      if (newStartTime < resizeState.originalEndTime!) {
        setResizeState(prev => ({
          ...prev,
          previewStartTime: newStartTime,
          previewEndTime: prev.originalEndTime,
        }));
      }
    } else {
      // Resizing from bottom - adjust end time
      const newEndTime = baseDate;

      if (newEndTime > resizeState.originalStartTime!) {
        setResizeState(prev => ({
          ...prev,
          previewStartTime: prev.originalStartTime,
          previewEndTime: newEndTime,
        }));
      }
    }
  }, [resizeState, appointment]);

  const handleMouseUp = useCallback(() => {
    if (resizeState.isResizing && resizeState.previewStartTime && resizeState.previewEndTime) {
      onResizeComplete(
        appointment.id,
        resizeState.previewStartTime,
        resizeState.previewEndTime
      );
    }

    setResizeState({
      isResizing: false,
      edge: null,
      originalStartTime: null,
      originalEndTime: null,
      previewStartTime: null,
      previewEndTime: null,
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
