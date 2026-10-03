import { useCallback } from "react";
import { format } from "date-fns";
import { Clock, AlertCircle, GripHorizontal, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { useDraggableAppointment } from "@/hooks/useDraggableAppointment";
import { useAppointmentResize } from "@/hooks/useAppointmentResize";
import { useUndoableAppointment } from "@/hooks/useUndoableAppointment";
import { useDispatchStore } from "@/stores/useDispatchStore";
import { AppointmentContextMenu } from "./AppointmentContextMenu";
import type { Appointment } from "@/types";

interface AppointmentCardProps {
    appointment: Appointment;
    isBeingDragged?: boolean;
    slotHeight?: number;
}

export function AppointmentCard({
    appointment,
    isBeingDragged = false,
    slotHeight = 48,
}: AppointmentCardProps) {
    const { previewAppointmentResize } = useDispatchStore();
    const { resizeAppointmentUndoable } = useUndoableAppointment();
    const dragRef = useDraggableAppointment(appointment);

    // Live preview callback — store-owned, no direct setState from the view
    const handleResizePreview = useCallback(
        (id: string, newStartTime: Date, newEndTime: Date) => {
            previewAppointmentResize(id, newStartTime, newEndTime);
        },
        [previewAppointmentResize],
    );

    const { startResize, keyboardResize, isResizing } = useAppointmentResize(
        appointment,
        resizeAppointmentUndoable,
        handleResizePreview,
        slotHeight,
    );

    const handleOpen = useCallback(() => {
        logger.debug("Open appointment", appointment.id);
    }, [appointment.id]);

    const handleCardKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleOpen();
            }
        },
        [handleOpen],
    );

    const handleHandleKeyDown = useCallback(
        (edge: "top" | "bottom") => (e: React.KeyboardEvent) => {
            if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                e.preventDefault();
                e.stopPropagation();
                keyboardResize(edge, -1);
            } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                e.preventDefault();
                e.stopPropagation();
                keyboardResize(edge, 1);
            }
        },
        [keyboardResize],
    );

    const getStatusIcon = () => {
        switch (appointment.status) {
            case "in_progress":
                return <Clock className="h-3 w-3" />;
            case "completed":
                return null;
            case "cancelled":
                return <AlertCircle className="h-3 w-3" />;
            default:
                return null;
        }
    };

    // Determine if appointment is completed (complete_status === 0)
    const isCompleted = appointment.complete_status === 0;

    return (
        <AppointmentContextMenu appointment={appointment}>
            <div
                ref={dragRef}
                role="button"
                tabIndex={0}
                aria-label={`Appointment: ${appointment.subject}, ${format(appointment.startTime, "h:mm a")} to ${format(appointment.endTime, "h:mm a")}`}
                className={cn(
                    "h-full rounded border-l-4 p-2 text-gray-900 shadow-sm hover:shadow-md cursor-grab active:cursor-grabbing relative group overflow-hidden",
                    // Only enable pointer-events when NOT being dragged
                    !isBeingDragged && "pointer-events-auto",
                    isBeingDragged && "pointer-events-none",
                    !isResizing && "transition-all",
                    isResizing && "z-50",
                    isCompleted && "opacity-60",
                )}
                style={{
                    backgroundColor: appointment.colour || undefined,
                    borderLeftColor: appointment.colour
                        ? `color-mix(in srgb, ${appointment.colour} 60%, white)`
                        : undefined,
                }}
                onClick={handleOpen}
                onKeyDown={handleCardKeyDown}
            >
                {/* Completed checkmark icon in top right */}
                {isCompleted && (
                    <div className="absolute top-1 right-1 z-20">
                        <CheckCircle2 className="h-4 w-4 text-gray-900/70" />
                    </div>
                )}

                {/* Top resize handle */}
                <div
                    data-resize-handle="top"
                    role="slider"
                    tabIndex={0}
                    aria-label="Resize appointment start time"
                    aria-valuetext={format(appointment.startTime, "h:mm a")}
                    className="absolute top-0 left-0 right-0 h-3 cursor-n-resize opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity flex items-center justify-center bg-black/20 hover:bg-black/30 z-10"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        startResize("top", e);
                    }}
                    onKeyDown={handleHandleKeyDown("top")}
                >
                    <GripHorizontal className="h-3 w-3 opacity-90" />
                </div>

                {/* Content wrapper with proper overflow handling */}
                <div className="overflow-hidden">
                    <div className="flex items-start gap-1 mb-1 min-w-0">
                        {getStatusIcon()}
                        <div className="text-xs font-semibold truncate flex-1 min-w-0">
                            {appointment.subject}
                        </div>
                    </div>
                    {(appointment.client_name || appointment.user_name) && (
                        <div className="text-xs opacity-90 truncate">
                            {appointment.client_name || appointment.user_name}
                        </div>
                    )}
                </div>

                {/* Bottom resize handle */}
                <div
                    data-resize-handle="bottom"
                    role="slider"
                    tabIndex={0}
                    aria-label="Resize appointment end time"
                    aria-valuetext={format(appointment.endTime, "h:mm a")}
                    className="absolute bottom-0 left-0 right-0 h-3 cursor-s-resize opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity flex items-center justify-center bg-black/20 hover:bg-black/30 z-10"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        startResize("bottom", e);
                    }}
                    onKeyDown={handleHandleKeyDown("bottom")}
                >
                    <GripHorizontal className="h-3 w-3 opacity-90" />
                </div>
            </div>
        </AppointmentContextMenu>
    );
}
