/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useMemo, type ReactNode } from 'react';
import type { Appointment } from '@/types';

interface DragState {
  draggedAppointment: Appointment | null;
  hoveredSlot: { agentId: number; startTime: Date } | null;
}

interface DragContextType extends DragState {
  setDraggedAppointment: (appointment: Appointment | null) => void;
  setHoveredSlot: (slot: { agentId: number; startTime: Date } | null) => void;
}

const DragContext = createContext<DragContextType | undefined>(undefined);

export function DragProvider({ children }: { children: ReactNode }) {
  const [draggedAppointment, setDraggedAppointment] = useState<Appointment | null>(null);
  const [hoveredSlot, setHoveredSlot] = useState<{ agentId: number; startTime: Date } | null>(null);

  // Wrapper to only update if the slot actually changed
  const setHoveredSlotOptimized = useMemo(
    () => (newSlot: { agentId: number; startTime: Date } | null) => {
      setHoveredSlot((currentSlot) => {
        // If both are null, don't update
        if (!newSlot && !currentSlot) return currentSlot;

        // If one is null and the other isn't, update
        if (!newSlot || !currentSlot) return newSlot;

        // If both exist, only update if they're different
        if (
          currentSlot.agentId === newSlot.agentId &&
          currentSlot.startTime.getTime() === newSlot.startTime.getTime()
        ) {
          return currentSlot; // Don't update - same slot
        }

        return newSlot; // Different slot - update
      });
    },
    []
  );

  // Memoize the context value to prevent unnecessary re-renders
  const contextValue = useMemo(
    () => ({
      draggedAppointment,
      hoveredSlot,
      setDraggedAppointment,
      setHoveredSlot: setHoveredSlotOptimized,
    }),
    [draggedAppointment, hoveredSlot, setHoveredSlotOptimized]
  );

  return (
    <DragContext.Provider value={contextValue}>
      {children}
    </DragContext.Provider>
  );
}

export function useDrag() {
  const context = useContext(DragContext);
  if (!context) {
    throw new Error('useDrag must be used within a DragProvider');
  }
  return context;
}
