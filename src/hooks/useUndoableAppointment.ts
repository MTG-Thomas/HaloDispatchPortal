import { useCallback } from "react";
import { useDispatchStore } from "@/stores/useDispatchStore";
import { performUndoable } from "@/lib/appointment-undo";

/**
 * Move/resize wrappers that offer Undo on success. Originals are captured
 * from the store before the optimistic update, so the inverse patch restores
 * exactly what the user saw. Failures propagate to the store's existing
 * rollback + error-toast handling.
 */
export function useUndoableAppointment() {
    const moveAppointment = useDispatchStore((s) => s.moveAppointment);
    const resizeAppointment = useDispatchStore((s) => s.resizeAppointment);

    const moveAppointmentUndoable = useCallback(
        async (id: string, newStartTime: Date, newAgentId: number) => {
            const appointment = useDispatchStore
                .getState()
                .appointments.find((apt) => apt.id === id);
            if (!appointment) {
                return moveAppointment(id, newStartTime, newAgentId);
            }
            const { startTime: originalStart, agentId: originalAgent } = appointment;
            await performUndoable({
                label: "Appointment moved",
                run: () => moveAppointment(id, newStartTime, newAgentId),
                undo: () => moveAppointment(id, originalStart, originalAgent),
            });
        },
        [moveAppointment],
    );

    const resizeAppointmentUndoable = useCallback(
        async (id: string, newStartTime: Date, newEndTime: Date) => {
            const appointment = useDispatchStore
                .getState()
                .appointments.find((apt) => apt.id === id);
            if (!appointment) {
                return resizeAppointment(id, newStartTime, newEndTime);
            }
            const { startTime: originalStart, endTime: originalEnd } = appointment;
            await performUndoable({
                label: "Appointment resized",
                run: () => resizeAppointment(id, newStartTime, newEndTime),
                undo: () => resizeAppointment(id, originalStart, originalEnd),
            });
        },
        [resizeAppointment],
    );

    return { moveAppointmentUndoable, resizeAppointmentUndoable };
}
