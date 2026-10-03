import type { StateCreator } from "zustand";
import { toast } from "sonner";
import { isAbortError } from "@/lib/api-client";
import {
    getAppointments,
    getAppointmentTypes,
    createOrUpdateAppointment as apiCreateOrUpdateAppointment,
} from "@/services/halo-api";
import {
    APPOINTMENT_AUTO_REFRESH_INTERVAL_MS,
    APPOINTMENT_COMPLETE_STATUS,
    APPOINTMENT_IN_PROGRESS_STATUS,
    COMPLETED_APPOINTMENT_COLOUR,
} from "@/lib/constants";
import { parseHaloUtcDate, getViewDateRange } from "@/lib/dates";
import { logger } from "@/lib/logger";
import type { Appointment, AppointmentStatus } from "@/types";
import type { HaloAppointment, HaloAppointmentType } from "@/types/halo";
import type { DispatchState } from "../useDispatchStore";

export interface AppointmentsSlice {
    appointments: Appointment[];
    appointmentTypes: HaloAppointmentType[];
    haloAppointments: HaloAppointment[];
    appointmentsLoading: boolean;
    appointmentsError: string | null;
    appointmentTypesLoading: boolean;
    appointmentRefreshInterval: ReturnType<typeof setTimeout> | null;
    moveAppointment: (id: string, newStartTime: Date, newAgentId: number) => Promise<void>;
    resizeAppointment: (id: string, newStartTime: Date, newEndTime: Date) => Promise<void>;
    previewAppointmentResize: (id: string, newStartTime: Date, newEndTime: Date) => void;
    createOrUpdateAppointment: (
        appointment: Partial<HaloAppointment> & { id?: number },
    ) => Promise<void>;
    loadAppointmentTypes: () => Promise<void>;
    loadAppointments: (startDate: Date, endDate: Date) => Promise<void>;
    startAppointmentAutoRefresh: () => void;
    stopAppointmentAutoRefresh: () => void;
    getAppointmentsForDateRange: (start: Date, end: Date) => Appointment[];
}

/**
 * In-flight appointment load. Superseded by navigation, agent changes, and
 * auto-refresh ticks; only the latest request resolves.
 */
let appointmentsLoadController: AbortController | null = null;

export function cancelAppointmentsLoad(): void {
    appointmentsLoadController?.abort();
    appointmentsLoadController = null;
}

export const createAppointmentsSlice: StateCreator<DispatchState, [], [], AppointmentsSlice> = (
    set,
    get,
) => ({
    appointments: [],
    appointmentTypes: [],
    haloAppointments: [],
    appointmentsLoading: false,
    appointmentsError: null,
    appointmentTypesLoading: false,
    appointmentRefreshInterval: null,

    moveAppointment: async (id, newStartTime, newAgentId) => {
        const currentState = get();
        const appointment = currentState.appointments.find((apt) => apt.id === id);
        if (!appointment) {
            throw new Error("Appointment not found");
        }

        // Store original values for rollback
        const originalStartTime = appointment.startTime;
        const originalEndTime = appointment.endTime;
        const originalAgentId = appointment.agentId;

        // Calculate new end time (preserve duration)
        const duration = appointment.endTime.getTime() - appointment.startTime.getTime();
        const newEndTime = new Date(newStartTime.getTime() + duration);

        // Optimistically update the store immediately
        set({
            appointments: currentState.appointments.map((apt) =>
                apt.id === id
                    ? {
                          ...apt,
                          startTime: newStartTime,
                          endTime: newEndTime,
                          agentId: newAgentId,
                          updatedAt: new Date(),
                      }
                    : apt,
            ),
        });

        try {
            // Parse the appointment ID
            const haloAppointmentId = parseInt(id);

            // Build update with both start and end times, and agent
            const update: Partial<HaloAppointment> & { id: number } = {
                id: haloAppointmentId,
                start_date: newStartTime.toISOString(),
                end_date: newEndTime.toISOString(),
                agent_id: newAgentId,
            };

            // Call the API
            await apiCreateOrUpdateAppointment(update);

            // Success - optimistic update is already applied
        } catch (error) {
            // Rollback optimistic update on failure
            const state = get();
            set({
                appointments: state.appointments.map((apt) =>
                    apt.id === id
                        ? {
                              ...apt,
                              startTime: originalStartTime,
                              endTime: originalEndTime,
                              agentId: originalAgentId,
                          }
                        : apt,
                ),
            });

            logger.error("Failed to move appointment:", error);
            toast.error("Failed to move appointment", {
                description: error instanceof Error ? error.message : "An unknown error occurred",
            });
            throw error;
        }
    },

    resizeAppointment: async (id, newStartTime, newEndTime) => {
        const currentState = get();
        const appointment = currentState.appointments.find((apt) => apt.id === id);
        if (!appointment) {
            throw new Error("Appointment not found");
        }

        // Store original times for rollback
        const originalStartTime = appointment.startTime;
        const originalEndTime = appointment.endTime;

        // Optimistically update the store immediately
        set({
            appointments: currentState.appointments.map((apt) =>
                apt.id === id ? { ...apt, startTime: newStartTime, endTime: newEndTime } : apt,
            ),
        });

        try {
            // Parse the appointment ID
            const haloAppointmentId = parseInt(id);

            // Determine which field changed and build partial update
            const update: Partial<HaloAppointment> & { id: number } = {
                id: haloAppointmentId,
            };

            // Check if start time changed
            if (originalStartTime.getTime() !== newStartTime.getTime()) {
                update.start_date = newStartTime.toISOString();
            }

            // Check if end time changed
            if (originalEndTime.getTime() !== newEndTime.getTime()) {
                update.end_date = newEndTime.toISOString();
            }

            // Call the API
            await apiCreateOrUpdateAppointment(update);

            // Success - optimistic update is already applied, no need to refresh
        } catch (error) {
            // Rollback optimistic update on failure
            const state = get();
            set({
                appointments: state.appointments.map((apt) =>
                    apt.id === id
                        ? {
                              ...apt,
                              startTime: originalStartTime,
                              endTime: originalEndTime,
                          }
                        : apt,
                ),
            });

            logger.error("Failed to resize appointment:", error);
            toast.error("Failed to resize appointment", {
                description: error instanceof Error ? error.message : "An unknown error occurred",
            });
            throw error;
        }
    },

    previewAppointmentResize: (id, newStartTime, newEndTime) => {
        // Live drag preview only — no API call. Replaces the direct
        // useDispatchStore.setState call previously in AppointmentCard.
        set((state) => ({
            appointments: state.appointments.map((apt) =>
                apt.id === id
                    ? {
                          ...apt,
                          startTime: newStartTime,
                          endTime: newEndTime,
                      }
                    : apt,
            ),
        }));
    },

    createOrUpdateAppointment: async (appointment) => {
        try {
            // Call the API
            const result = await apiCreateOrUpdateAppointment(appointment);

            // API returns an array with the created/updated appointment
            if (result && result.length > 0) {
                const updatedAppointment = result[0];

                // Update the local state
                set((state) => {
                    const appointmentId = updatedAppointment.id.toString();
                    const existingIndex = state.appointments.findIndex(
                        (apt) => apt.id === appointmentId,
                    );

                    // Convert HaloAppointment to Appointment format
                    const mappedAppointment: Appointment = {
                        id: appointmentId,
                        ticketId: updatedAppointment.ticket_id?.toString() || "",
                        agentId: updatedAppointment.agent_id,
                        startTime: parseHaloUtcDate(updatedAppointment.start_date),
                        endTime: parseHaloUtcDate(updatedAppointment.end_date),
                        status:
                            updatedAppointment.complete_status === APPOINTMENT_COMPLETE_STATUS
                                ? "completed"
                                : "scheduled",
                        location: updatedAppointment.appointment_location_name,
                        isAllDay: updatedAppointment.allday,
                        isTentative: false,
                        notes: updatedAppointment.note,
                        createdAt:
                            existingIndex >= 0
                                ? state.appointments[existingIndex].createdAt
                                : new Date(),
                        updatedAt: new Date(),
                        subject: updatedAppointment.subject,
                        colour: updatedAppointment.colour,
                        complete_status: updatedAppointment.complete_status,
                        client_name: updatedAppointment.client_name,
                        site_name: updatedAppointment.site_name,
                        user_name: updatedAppointment.user_name,
                        appointment_type_name: updatedAppointment.appointment_type_name,
                        canUpdate: updatedAppointment._canupdate,
                        canDelete: updatedAppointment._candelete,
                        canComplete: updatedAppointment._cancomplete,
                    };

                    if (existingIndex >= 0) {
                        // Update existing appointment
                        const updatedAppointments = [...state.appointments];
                        updatedAppointments[existingIndex] = {
                            ...updatedAppointments[existingIndex],
                            ...mappedAppointment,
                        };
                        return { appointments: updatedAppointments };
                    } else {
                        // Add new appointment
                        return {
                            appointments: [...state.appointments, mappedAppointment],
                        };
                    }
                });
            }
        } catch (error) {
            logger.error("Failed to create/update appointment:", error);
            toast.error("Failed to update appointment", {
                description: error instanceof Error ? error.message : "An unknown error occurred",
            });
            throw error;
        }
    },
    loadAppointmentTypes: async () => {
        set({ appointmentTypesLoading: true });
        try {
            const types = await getAppointmentTypes();
            set({
                appointmentTypes: types,
                appointmentTypesLoading: false,
            });
        } catch (error) {
            logger.error("Failed to load appointment types:", error);
            set({
                appointmentTypesLoading: false,
            });
        }
    },

    loadAppointments: async (startDate: Date, endDate: Date) => {
        const state = get();

        // Get selected agent IDs
        const visibleAgents = state.getVisibleAgents();

        const agentIds = visibleAgents.map((agent) => agent.id);

        if (agentIds.length === 0) {
            logger.warn("No agents selected, skipping appointment load");
            cancelAppointmentsLoad();
            set({ appointments: [], appointmentsLoading: false });
            return;
        }

        // Cancel any in-flight load so only the latest request resolves.
        appointmentsLoadController?.abort();
        const controller = new AbortController();
        appointmentsLoadController = controller;
        const signal = controller.signal;

        set({ appointmentsLoading: true, appointmentsError: null });

        try {
            const haloAppointments = await getAppointments(
                startDate.toISOString(),
                endDate.toISOString(),
                agentIds,
                undefined,
                { signal },
            );

            // Map HaloAppointment to Appointment
            const appointments: Appointment[] = haloAppointments.map((haloApt) => {
                const startTime = parseHaloUtcDate(haloApt.start_date);
                const endTime = parseHaloUtcDate(haloApt.end_date);

                // Determine status based on complete_status
                let status: AppointmentStatus = "scheduled";
                if (haloApt.complete_status === APPOINTMENT_COMPLETE_STATUS) {
                    status = "completed";
                } else if (haloApt.status === APPOINTMENT_IN_PROGRESS_STATUS) {
                    status = "in_progress";
                }

                // Determine color (grey if completed, otherwise use appointment color)
                const colour =
                    status === "completed" ? COMPLETED_APPOINTMENT_COLOUR : haloApt.colour;

                return {
                    id: haloApt.id.toString(),
                    ticketId: haloApt.ticket_id?.toString() || "",
                    agentId: haloApt.agent_id,
                    startTime,
                    endTime,
                    status,
                    isAllDay: haloApt.allday,
                    isTentative: false,
                    notes: haloApt.note || "",
                    createdAt: haloApt.last_modified ? new Date(haloApt.last_modified) : startTime,
                    updatedAt: haloApt.last_modified ? new Date(haloApt.last_modified) : startTime,

                    // Halo-specific fields
                    subject: haloApt.subject,
                    colour,
                    complete_status: haloApt.complete_status,
                    client_name: haloApt.client_name,
                    site_name: haloApt.site_name,
                    user_name: haloApt.user_name,
                    appointment_type_name: haloApt.appointment_type_name,
                    canUpdate: haloApt._canupdate,
                    canDelete: haloApt._candelete,
                    canComplete: haloApt._cancomplete,
                };
            });

            set({
                haloAppointments,
                appointments,
                appointmentsLoading: false,
            });
        } catch (error) {
            if (isAbortError(error) || signal.aborted) {
                // Superseded by a newer load: clear spinner (unless a newer
                // load owns it now), keep old data.
                if (
                    appointmentsLoadController === controller ||
                    appointmentsLoadController === null
                ) {
                    set({ appointmentsLoading: false });
                }
                return;
            }
            set({
                appointmentsError:
                    error instanceof Error ? error.message : "Failed to load appointments",
                appointmentsLoading: false,
            });
        } finally {
            if (appointmentsLoadController === controller) {
                appointmentsLoadController = null;
            }
        }
    },

    startAppointmentAutoRefresh: () => {
        // Clear any existing interval
        const state = get();
        if (state.appointmentRefreshInterval) {
            clearInterval(state.appointmentRefreshInterval);
        }

        // Set up new interval (refresh every 3 minutes)
        const interval = setInterval(() => {
            const currentState = get();
            const { startDate, endDate } = getViewDateRange(
                currentState.calendarView,
                currentState.selectedDate,
            );
            currentState.loadAppointments(startDate, endDate);
        }, APPOINTMENT_AUTO_REFRESH_INTERVAL_MS);

        // Store interval ID on the state object
        set({ appointmentRefreshInterval: interval });
    },

    stopAppointmentAutoRefresh: () => {
        const state = get();
        if (state.appointmentRefreshInterval) {
            clearInterval(state.appointmentRefreshInterval);
            set({ appointmentRefreshInterval: null });
        }
        cancelAppointmentsLoad();
    },

    getAppointmentsForDateRange: (start, end) => {
        const state = get();
        return state.appointments.filter(
            (apt) =>
                (apt.startTime >= start && apt.startTime <= end) ||
                (apt.endTime >= start && apt.endTime <= end) ||
                (apt.startTime <= start && apt.endTime >= end),
        );
    },
});
