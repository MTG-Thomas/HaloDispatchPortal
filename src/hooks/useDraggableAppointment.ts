import { useEffect, useRef, createElement } from 'react';
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview';
import { createRoot } from 'react-dom/client';
import type { Appointment } from '@/types';
import { AppointmentDragPreview } from '@/components/calendar/AppointmentDragPreview';
import { useDrag } from '@/contexts/DragContext';

interface DragInput {
  event?: { target?: EventTarget | null };
}

export function useDraggableAppointment(appointment: Appointment) {
  const ref = useRef<HTMLDivElement>(null);
  const { setDraggedAppointment, setHoveredSlot } = useDrag();

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
      onGenerateDragPreview: ({ nativeSetDragImage }) => {
        setCustomNativeDragPreview({
          nativeSetDragImage,
          render: ({ container }) => {
            const root = createRoot(container);
            root.render(createElement(AppointmentDragPreview, { appointment }));
            return () => root.unmount();
          },
        });
      },
      onDragStart: () => {
        element.style.opacity = '0.5';
        setDraggedAppointment(appointment);
      },
      onDrop: () => {
        element.style.opacity = '1';
        // Use requestAnimationFrame to ensure state clears after React processes the drop
        // Note: This is a backup - the primary cleanup happens in TimeSlot's drop handler
        requestAnimationFrame(() => {
          setDraggedAppointment(null);
          setHoveredSlot(null);
        });
      },
    });
  }, [appointment, setDraggedAppointment, setHoveredSlot]);

  return ref;
}
