import { toast } from "sonner";
import { logger } from "@/lib/logger";

export const UNDO_TOAST_DURATION_MS = 10_000;

export interface UndoableAction {
    /** Short label, e.g. "Appointment moved". */
    label: string;
    /** The mutation. On failure the caller is expected to surface the error. */
    run: () => Promise<unknown>;
    /** Inverse mutation applied when the user clicks Undo. */
    undo: () => Promise<unknown>;
}

/**
 * Runs a calendar mutation and, on success, offers Undo via a toast action.
 * Failures are rethrown untouched so the caller's existing error handling
 * (rollback + error toast) keeps working.
 */
export async function performUndoable({ label, run, undo }: UndoableAction): Promise<void> {
    await run();
    toast.success(label, {
        duration: UNDO_TOAST_DURATION_MS,
        action: {
            label: "Undo",
            onClick: () => {
                undo().catch((error: unknown) => {
                    logger.error(`Undo failed for "${label}":`, error);
                    toast.error("Undo failed", {
                        description:
                            error instanceof Error ? error.message : "An unknown error occurred",
                    });
                });
            },
        },
    });
}
