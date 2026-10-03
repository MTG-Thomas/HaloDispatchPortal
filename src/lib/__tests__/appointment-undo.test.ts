import { beforeEach, describe, expect, it, vi } from "vitest";

const { toastSuccess, toastError } = vi.hoisted(() => ({
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
    toast: { success: toastSuccess, error: toastError },
}));

vi.mock("@/lib/logger", () => ({
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { performUndoable, UNDO_TOAST_DURATION_MS } from "@/lib/appointment-undo";

describe("performUndoable", () => {
    beforeEach(() => vi.clearAllMocks());

    it("runs the mutation then offers Undo, which applies the inverse", async () => {
        const run = vi.fn().mockResolvedValue(undefined);
        const undo = vi.fn().mockResolvedValue(undefined);

        await performUndoable({ label: "Appointment moved", run, undo });

        expect(run).toHaveBeenCalledTimes(1);
        expect(toastSuccess).toHaveBeenCalledTimes(1);
        const [message, options] = toastSuccess.mock.calls[0] as [
            string,
            { duration: number; action: { label: string; onClick: () => void } },
        ];
        expect(message).toBe("Appointment moved");
        expect(options.duration).toBe(UNDO_TOAST_DURATION_MS);
        expect(options.action.label).toBe("Undo");

        // User clicks Undo: the inverse mutation runs exactly once.
        options.action.onClick();
        await vi.waitFor(() => expect(undo).toHaveBeenCalledTimes(1));
        expect(toastError).not.toHaveBeenCalled();
    });

    it("shows no success toast when the mutation fails", async () => {
        const run = vi.fn().mockRejectedValue(new Error("API down"));
        const undo = vi.fn();

        await expect(performUndoable({ label: "Appointment moved", run, undo })).rejects.toThrow(
            "API down",
        );
        expect(toastSuccess).not.toHaveBeenCalled();
        expect(undo).not.toHaveBeenCalled();
    });

    it("surfaces a failed undo instead of rejecting unhandled", async () => {
        const run = vi.fn().mockResolvedValue(undefined);
        const undo = vi.fn().mockRejectedValue(new Error("gone"));

        await performUndoable({ label: "Appointment moved", run, undo });
        const [, options] = toastSuccess.mock.calls[0] as [
            string,
            { action: { label: string; onClick: () => void } },
        ];
        options.action.onClick();

        await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
        expect(toastError).toHaveBeenCalledWith(
            "Undo failed",
            expect.objectContaining({ description: "gone" }),
        );
    });
});
