import { useEffect, useState } from "react";
import { startOfWeek, addDays, format, isSameDay } from "date-fns";
import { useDispatchStore } from "@/stores/useDispatchStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useConfigStore } from "@/stores/configStore";
import { UtilizationBar } from "../UtilizationBar";
import { CalendarColumn } from "../CalendarColumn";
import { TimeLabelsColumn } from "../TimeLabelsColumn";
import { AgentAvatar } from "@/components/AgentAvatar";
import { cn } from "@/lib/utils";
import { WEEK_STARTS_ON } from "@/lib/constants";
import { DEFAULT_CALENDAR_CONFIG } from "@/lib/calendarConfig";
import { weekUtilization } from "@/lib/capacity";
import type { Agent, Appointment } from "@/types";

function WeekTotal({
    agent,
    appointments,
    weekStart,
    daysToShow,
}: {
    agent: Agent;
    appointments: Appointment[];
    weekStart: Date;
    daysToShow: number;
}) {
    const { scheduledHours, availableHours, percentage } = weekUtilization(
        agent,
        appointments,
        weekStart,
        daysToShow,
    );
    if (availableHours <= 0) return null;
    return (
        <div
            className="text-[10px] text-muted-foreground"
            title={`Week total: ${scheduledHours.toFixed(1)} of ${availableHours.toFixed(1)} hours scheduled`}
        >
            Wk {scheduledHours.toFixed(1)}/{availableHours.toFixed(1)}h · {percentage.toFixed(0)}%
        </div>
    );
}

export function WeekView() {
    // Shared heights for all columns
    const [allDayHeight, setAllDayHeight] = useState(40);
    const [beforeHoursHeight, setBeforeHoursHeight] = useState(64);
    const [afterHoursHeight, setAfterHoursHeight] = useState(64);
    const {
        calendarView,
        selectedDate,
        getVisibleAgents,
        getAppointmentsForDateRange,
        loadAppointments,
    } = useDispatchStore();
    const { config } = useConfigStore();

    const selectedResources = usePreferencesStore((state) => state.selectedResources);
    const calendarZoomLevel = usePreferencesStore((state) => state.calendarZoomLevel);

    const visibleAgents = getVisibleAgents();
    const daysToShow = calendarView === "week5" ? 5 : 7;
    const calendarConfig = DEFAULT_CALENDAR_CONFIG;

    // Get week start (Monday)
    const weekStart = startOfWeek(selectedDate, { weekStartsOn: WEEK_STARTS_ON });
    const days = Array.from({ length: daysToShow }, (_, i) => addDays(weekStart, i));

    // Get appointments for this week
    const weekEnd = addDays(weekStart, daysToShow);
    const appointments = getAppointmentsForDateRange(weekStart, weekEnd);

    // Millisecond keys so the effect below has statically checkable deps.
    const weekStartMs = weekStart.getTime();
    const weekEndMs = weekEnd.getTime();

    // Load appointments when date range or visible agents change. The
    // selectedResources dep is intentional: agent swaps keep the same count.
    useEffect(() => {
        if (visibleAgents.length === 0) {
            return;
        }
        loadAppointments(weekStart, weekEnd);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [weekStartMs, weekEndMs, selectedResources, visibleAgents.length, calendarView]);

    // Helper to get appointments for a specific agent and day
    const getAppointmentsForAgentAndDay = (agentId: number, day: Date) => {
        return appointments.filter((apt) => {
            if (apt.agentId !== agentId) return false;

            // Check if appointment falls on this day (handles multi-day appointments)
            const dayStart = new Date(day);
            dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(day);
            dayEnd.setHours(23, 59, 59, 999);

            // Appointment overlaps with this day if it starts before day ends and ends after day starts
            return apt.startTime <= dayEnd && apt.endTime >= dayStart;
        });
    };

    // Helper to check if appointment should be treated as all-day (matches CalendarColumn logic)
    const isAllDayAppointment = (apt: Appointment) => {
        if (apt.isAllDay) return true;
        const numericId = parseInt(apt.id);
        return numericId < 0; // Negative IDs are treated as all-day
    };

    // Check if any appointments exist in before/after hours for any day
    const hasBeforeHours = (agentId: number) => {
        return days.some((day) => {
            const dayAppointments = getAppointmentsForAgentAndDay(agentId, day);
            return dayAppointments.some(
                (apt) =>
                    !isAllDayAppointment(apt) &&
                    apt.startTime.getHours() < calendarConfig.dayStartHour,
            );
        });
    };

    const hasAfterHours = (agentId: number) => {
        return days.some((day) => {
            const dayAppointments = getAppointmentsForAgentAndDay(agentId, day);
            return dayAppointments.some((apt) => {
                if (isAllDayAppointment(apt)) return false;
                const endHour = apt.endTime.getHours();
                const endMinute = apt.endTime.getMinutes();
                // Only show after hours if appointment ends after dayEndHour (5 PM = 17:00)
                return (
                    endHour > calendarConfig.dayEndHour ||
                    (endHour === calendarConfig.dayEndHour && endMinute > 0)
                );
            });
        });
    };

    if (visibleAgents.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground">
                No agents selected. Please select agents or teams to view their schedules.
            </div>
        );
    }

    return (
        <div className="h-full overflow-auto">
            <div className="min-w-[1000px]">
                {/* Header Row - Days */}
                <div className="sticky top-0 z-20 bg-card border-b flex">
                    {/* Resource Column Header */}
                    <div className="w-48 flex-shrink-0 border-r p-2 bg-muted font-medium text-sm flex items-center">
                        Resource
                    </div>
                    {/* Day Headers */}
                    {days.map((day) => (
                        <div
                            key={day.toISOString()}
                            className={cn(
                                "flex-1 border-r p-2 text-center",
                                isSameDay(day, new Date()) && "bg-primary/5",
                            )}
                        >
                            <div className="font-medium text-sm">
                                {format(day, "EEE")}{" "}
                                <span className="text-muted-foreground">{format(day, "M/d")}</span>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Agent Rows */}
                {visibleAgents.map((agent) => (
                    <div key={agent.id} className="border-b">
                        {/* Agent Name and Utilization Row */}
                        <div className="flex border-b bg-muted/30">
                            {/* Agent Info Column */}
                            <div className="w-48 flex-shrink-0 border-r p-2 flex flex-col justify-center gap-0.5">
                                <AgentAvatar
                                    agent={agent}
                                    size="sm"
                                    showName
                                    resourceServer={config.resourceServer}
                                />
                                <WeekTotal
                                    agent={agent}
                                    appointments={appointments}
                                    weekStart={weekStart}
                                    daysToShow={daysToShow}
                                />
                            </div>
                            {/* Utilization Columns */}
                            {days.map((day) => (
                                <div
                                    key={day.toISOString()}
                                    className="flex-1 border-r p-1 flex items-center justify-center"
                                >
                                    <div className="w-full">
                                        <UtilizationBar agentId={agent.id} date={day} />
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Agent Schedule Row */}
                        <div className="flex">
                            {/* Time labels column */}
                            <TimeLabelsColumn
                                config={calendarConfig}
                                hasBeforeHours={hasBeforeHours(agent.id)}
                                hasAfterHours={hasAfterHours(agent.id)}
                                className="w-48 flex-shrink-0"
                                allDayHeight={allDayHeight}
                                beforeHoursHeight={beforeHoursHeight}
                                afterHoursHeight={afterHoursHeight}
                                zoomLevel={calendarZoomLevel}
                            />

                            {/* Day Columns */}
                            {days.map((day) => {
                                const dayAppointments = getAppointmentsForAgentAndDay(
                                    agent.id,
                                    day,
                                );
                                return (
                                    <CalendarColumn
                                        key={day.toISOString()}
                                        agentId={agent.id}
                                        date={day}
                                        appointments={dayAppointments}
                                        config={calendarConfig}
                                        isToday={isSameDay(day, new Date())}
                                        allDayHeight={allDayHeight}
                                        beforeHoursHeight={beforeHoursHeight}
                                        afterHoursHeight={afterHoursHeight}
                                        onAllDayHeightChange={setAllDayHeight}
                                        onBeforeHoursHeightChange={setBeforeHoursHeight}
                                        onAfterHoursHeightChange={setAfterHoursHeight}
                                        showBeforeHours={hasBeforeHours(agent.id)}
                                        showAfterHours={hasAfterHours(agent.id)}
                                        zoomLevel={calendarZoomLevel}
                                    />
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
