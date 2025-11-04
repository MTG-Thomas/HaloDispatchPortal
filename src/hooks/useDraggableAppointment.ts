import { useEffect, useRef } from 'react';
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import type { Appointment } from '@/types';

interface DragInput {
  event?: { target?: EventTarget | null };
}

export function useDraggableAppointment(appointment: Appointment) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    return draggable({
      element,
      canDrag: ({ input }) => {
        // Don't start drag if clicking on resize handles
        const dragInput = input as DragInput;
        const target = dragInput.event?.target as HTMLElement | undefined;
        if (!target) return true;
        const isResizeHandle = target.closest('[data-resize-handle]');
        return !isResizeHandle;
      },
      getInitialData: () => ({
        type: 'appointment',
        appointment,
      }),
      onDragStart: () => {
        element.style.opacity = '0.5';
      },
      onDrop: () => {
        element.style.opacity = '1';
      },
    });
  }, [appointment]);

  return ref;
}
