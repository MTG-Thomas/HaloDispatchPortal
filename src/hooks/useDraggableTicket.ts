import { useEffect, useRef, createElement } from 'react';
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview';
import { createRoot } from 'react-dom/client';
import type { Ticket } from '@/types';
import { TicketDragPreview } from '@/components/tickets/TicketDragPreview';

export function useDraggableTicket(ticket: Ticket) {
  const ref = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    return draggable({
      element,
      getInitialData: () => ({
        type: 'ticket',
        ticket,
      }),
      onGenerateDragPreview: ({ nativeSetDragImage }) => {
        setCustomNativeDragPreview({
          nativeSetDragImage,
          render: ({ container }) => {
            const root = createRoot(container);
            root.render(createElement(TicketDragPreview, { ticket }));
            return () => root.unmount();
          },
        });
      },
      onDragStart: () => {
        element.style.opacity = '0.5';
      },
      onDrop: () => {
        element.style.opacity = '1';
      },
    });
  }, [ticket]);

  return ref;
}
