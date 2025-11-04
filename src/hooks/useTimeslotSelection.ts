import { create } from 'zustand';

/**
 * Selection state for calendar timeslots
 * Only allows selection within a single agent's column
 */
interface TimeslotSelectionState {
  // The agent ID for the selected timeslots (null if no selection)
  agentId: number | null;

  // Array of selected timeslot start times
  slots: Date[];

  // Drag-to-select state
  isDragging: boolean;
  dragStartSlot: Date | null;

  // Drag-over state (for ticket/appointment drops)
  isDraggedOver: boolean;

  // Actions
  selectSlot: (agentId: number, startTime: Date) => void;
  selectRange: (agentId: number, startTime: Date, endTime: Date, slotDuration: number) => void;
  toggleSlot: (agentId: number, startTime: Date) => void;
  clearSelection: () => void;
  isSlotSelected: (agentId: number, startTime: Date) => boolean;
  isFirstSelectedSlot: (agentId: number, startTime: Date) => boolean;
  isLastSelectedSlot: (agentId: number, startTime: Date) => boolean;
  hasSelection: () => boolean;
  getSelectionInfo: () => {
    agentId: number | null;
    startTime: Date | null;
    endTime: Date | null;
    durationMinutes: number | null;
  };

  // Drag-to-select actions
  startDragSelect: (agentId: number, startTime: Date) => void;
  updateDragSelect: (agentId: number, currentTime: Date) => void;
  endDragSelect: () => void;

  // Drag-over actions (for ticket/appointment drops)
  setDraggedOver: (isDraggedOver: boolean) => void;
}

/**
 * Hook for managing timeslot selection in the calendar
 *
 * Supports:
 * - Single slot selection (click)
 * - Range selection (drag)
 * - Toggle selection (Ctrl+click)
 * - Selection constrained to single agent
 */
export const useTimeslotSelection = create<TimeslotSelectionState>((set, get) => ({
  agentId: null,
  slots: [],
  isDragging: false,
  dragStartSlot: null,
  isDraggedOver: false,

  /**
   * Select a single timeslot
   * If clicking on a different agent, clears previous selection
   */
  selectSlot: (agentId, startTime) => {
    const state = get();

    // If selecting a different agent, clear previous selection
    if (state.agentId !== null && state.agentId !== agentId) {
      set({ agentId, slots: [startTime] });
      return;
    }

    // Select this single slot
    set({ agentId, slots: [startTime] });
  },

  /**
   * Select a range of timeslots
   * Generates all slots between startTime and endTime
   */
  selectRange: (agentId, startTime, endTime, slotDuration = 15) => {
    const state = get();

    // If selecting a different agent, clear previous selection
    if (state.agentId !== null && state.agentId !== agentId) {
      set({ agentId, slots: [] });
    }

    // Generate all slots in the range
    const slots: Date[] = [];
    const start = new Date(startTime);
    const end = new Date(endTime);

    // Ensure start is before end
    if (start >= end) {
      set({ agentId, slots: [startTime] });
      return;
    }

    let current = new Date(start);
    while (current <= end) {
      slots.push(new Date(current));
      current = new Date(current.getTime() + slotDuration * 60 * 1000);
    }

    set({ agentId, slots });
  },

  /**
   * Toggle a timeslot (add if not selected, remove if selected)
   * Useful for Ctrl+click behavior
   */
  toggleSlot: (agentId, startTime) => {
    const state = get();

    // If different agent, start fresh
    if (state.agentId !== null && state.agentId !== agentId) {
      set({ agentId, slots: [startTime] });
      return;
    }

    // Check if slot is already selected
    const timeMs = startTime.getTime();
    const existingIndex = state.slots.findIndex((slot) => slot.getTime() === timeMs);

    if (existingIndex >= 0) {
      // Remove it
      const newSlots = state.slots.filter((_, i) => i !== existingIndex);
      set({
        agentId: newSlots.length > 0 ? agentId : null,
        slots: newSlots
      });
    } else {
      // Add it
      set({ agentId, slots: [...state.slots, startTime] });
    }
  },

  /**
   * Clear all selections
   */
  clearSelection: () => {
    set({ agentId: null, slots: [] });
  },

  /**
   * Check if a specific slot is selected
   */
  isSlotSelected: (agentId, startTime) => {
    const state = get();

    if (state.agentId !== agentId) return false;

    const timeMs = startTime.getTime();
    return state.slots.some((slot) => slot.getTime() === timeMs);
  },

  /**
   * Check if this is the first (earliest) selected slot
   */
  isFirstSelectedSlot: (agentId, startTime) => {
    const state = get();

    if (state.agentId !== agentId || state.slots.length === 0) return false;

    const sortedSlots = [...state.slots].sort((a, b) => a.getTime() - b.getTime());
    return sortedSlots[0].getTime() === startTime.getTime();
  },

  /**
   * Check if this is the last (latest) selected slot
   */
  isLastSelectedSlot: (agentId, startTime) => {
    const state = get();

    if (state.agentId !== agentId || state.slots.length === 0) return false;

    const sortedSlots = [...state.slots].sort((a, b) => a.getTime() - b.getTime());
    return sortedSlots[sortedSlots.length - 1].getTime() === startTime.getTime();
  },

  /**
   * Check if any slots are selected
   */
  hasSelection: () => {
    return get().slots.length > 0;
  },

  /**
   * Get selection info (agent, start, end, duration)
   */
  getSelectionInfo: () => {
    const state = get();

    if (state.slots.length === 0) {
      return {
        agentId: null,
        startTime: null,
        endTime: null,
        durationMinutes: null,
      };
    }

    // Sort slots by time
    const sortedSlots = [...state.slots].sort((a, b) => a.getTime() - b.getTime());
    const startTime = sortedSlots[0];
    const lastSlot = sortedSlots[sortedSlots.length - 1];

    // Calculate end time (last slot start + assumed 15 min slot duration)
    // This should match the calendar config slot duration
    const endTime = new Date(lastSlot.getTime() + 15 * 60 * 1000);

    const durationMinutes = Math.round(
      (endTime.getTime() - startTime.getTime()) / (1000 * 60)
    );

    return {
      agentId: state.agentId,
      startTime,
      endTime,
      durationMinutes,
    };
  },

  /**
   * Start drag-to-select operation
   */
  startDragSelect: (agentId, startTime) => {
    set({
      agentId,
      slots: [startTime],
      isDragging: true,
      dragStartSlot: startTime,
    });
  },

  /**
   * Update drag-to-select as mouse moves over timeslots
   */
  updateDragSelect: (agentId, currentTime) => {
    const state = get();

    // Only update if we're dragging and on the same agent
    if (!state.isDragging || !state.dragStartSlot || state.agentId !== agentId) {
      return;
    }

    // Build range from drag start to current time
    const start = state.dragStartSlot;
    const end = currentTime;

    // Determine which is earlier
    const earlierTime = start.getTime() < end.getTime() ? start : end;
    const laterTime = start.getTime() < end.getTime() ? end : start;

    // Generate all slots in the range (15-minute intervals)
    const slots: Date[] = [];
    let current = new Date(earlierTime);
    const endTime = new Date(laterTime);

    while (current <= endTime) {
      slots.push(new Date(current));
      current = new Date(current.getTime() + 15 * 60 * 1000);
    }

    set({ slots });
  },

  /**
   * End drag-to-select operation
   */
  endDragSelect: () => {
    set({
      isDragging: false,
      dragStartSlot: null,
    });
  },

  /**
   * Set drag-over state for selection
   * Used when dragging tickets/appointments over selected slots
   */
  setDraggedOver: (isDraggedOver: boolean) => {
    set({ isDraggedOver });
  },
}));
