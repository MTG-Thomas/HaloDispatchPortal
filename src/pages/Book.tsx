import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    BookApiError,
    confirmBooking,
    fetchBookSlots,
    type BookSlotOption,
    type BookSlotsResponse,
    type BookConfirmResponse,
} from "@/lib/book-api";
import { Calendar, CheckCircle2, Clock, Loader2, User } from "lucide-react";

type Phase = "loading" | "ready" | "done" | "error";

function utcOffsetMinutes(): number {
    return -new Date().getTimezoneOffset();
}

function formatDay(dateLabel: string): string {
    const [year, month, day] = dateLabel.split("-").map(Number);
    return new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
    }).format(new Date(year, month - 1, day));
}

function formatTime(iso: string): string {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
        new Date(iso),
    );
}

function formatDateTime(iso: string): string {
    return new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(new Date(iso));
}

function agentLabel(agents: BookSlotsResponse["agents"], agentId: number): string {
    const match = agents.find((a) => a.id === agentId);
    return match?.name ?? `Agent ${agentId}`;
}

const Book: React.FC = () => {
    const { token = "" } = useParams();
    const [phase, setPhase] = useState<Phase>("loading");
    const [data, setData] = useState<BookSlotsResponse | null>(null);
    const [error, setError] = useState<BookApiError | null>(null);
    const [selectedDay, setSelectedDay] = useState<string | null>(null);
    const [selectedAgent, setSelectedAgent] = useState<number | null>(null);
    const [selectedSlot, setSelectedSlot] = useState<BookSlotOption | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [slotError, setSlotError] = useState<string | null>(null);
    const [confirmation, setConfirmation] = useState<BookConfirmResponse | null>(null);

    const load = useCallback(async () => {
        setPhase("loading");
        setError(null);
        setSlotError(null);
        setSelectedSlot(null);
        try {
            const response = await fetchBookSlots({ token, utcOffset: utcOffsetMinutes() });
            setData(response);
            setSelectedDay(response.days[0]?.date ?? null);
            setPhase("ready");
        } catch (err) {
            setError(
                err instanceof BookApiError
                    ? err
                    : new BookApiError("network-error", "Could not load available times."),
            );
            setPhase("error");
        }
    }, [token]);

    useEffect(() => {
        void load();
    }, [load]);

    const visibleSlots = useMemo(() => {
        if (!data || !selectedDay) return [];
        const day = data.days.find((d) => d.date === selectedDay);
        if (!day) return [];
        return selectedAgent === null
            ? day.slots
            : day.slots.filter((s) => s.agentId === selectedAgent);
    }, [data, selectedDay, selectedAgent]);

    const handleConfirm = useCallback(async () => {
        if (!selectedSlot) return;
        setConfirming(true);
        setSlotError(null);
        try {
            const result = await confirmBooking({
                token,
                agentId: selectedSlot.agentId,
                start: selectedSlot.start,
                end: selectedSlot.end,
                utcOffset: utcOffsetMinutes(),
            });
            setConfirmation(result);
            setPhase("done");
        } catch (err) {
            if (err instanceof BookApiError && err.code === "slot-taken") {
                setSlotError(err.message);
                setSelectedSlot(null);
                // The grid moved under the customer; reload availability.
                try {
                    const response = await fetchBookSlots({
                        token,
                        utcOffset: utcOffsetMinutes(),
                    });
                    setData(response);
                    if (!response.days.some((d) => d.date === selectedDay)) {
                        setSelectedDay(response.days[0]?.date ?? null);
                    }
                } catch {
                    // Keep the stale grid; the slot error already explains.
                }
            } else {
                setError(
                    err instanceof BookApiError
                        ? err
                        : new BookApiError("network-error", "Could not confirm the booking."),
                );
                setPhase("error");
            }
        } finally {
            setConfirming(false);
        }
    }, [selectedSlot, selectedDay, token]);

    if (phase === "loading") {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background p-4">
                <Card className="w-full max-w-2xl">
                    <CardContent className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Loading available times…
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (phase === "done" && confirmation && data) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background p-4">
                <Card className="w-full max-w-2xl">
                    <CardHeader className="text-center">
                        <div className="mx-auto mb-2 flex items-center justify-center">
                            <CheckCircle2 className="h-12 w-12 text-green-600" />
                        </div>
                        <CardTitle>
                            <h1 className="text-2xl">Booking confirmed</h1>
                        </CardTitle>
                        <CardDescription>Your appointment has been scheduled.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-center">
                        <p className="text-lg font-medium">
                            {formatDateTime(confirmation.start)} – {formatTime(confirmation.end)}
                        </p>
                        <p className="text-muted-foreground">
                            with {agentLabel(data.agents, confirmation.agentId)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Reference {confirmation.rid} · Appointment #{confirmation.appointmentId}
                        </p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (phase === "error" && error) {
        return <BookErrorState error={error} onRetry={load} />;
    }

    if (!data) {
        return null;
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <Card className="w-full max-w-2xl">
                <CardHeader>
                    <CardTitle>
                        <h1 className="text-2xl">Book your appointment</h1>
                    </CardTitle>
                    <CardDescription>
                        Choose an agent, a day, and a time that works for you.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {slotError && (
                        <p
                            role="alert"
                            className="rounded-md bg-amber-50 p-3 text-sm text-amber-900"
                        >
                            {slotError}
                        </p>
                    )}

                    <section aria-label="Choose an agent">
                        <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
                            <User className="h-4 w-4" /> Agent
                        </h2>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant={selectedAgent === null ? "default" : "outline"}
                                size="sm"
                                onClick={() => {
                                    setSelectedAgent(null);
                                    setSelectedSlot(null);
                                }}
                            >
                                Any agent
                            </Button>
                            {data.agents.map((agent) => (
                                <Button
                                    key={agent.id}
                                    variant={selectedAgent === agent.id ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => {
                                        setSelectedAgent(agent.id);
                                        setSelectedSlot(null);
                                    }}
                                >
                                    {agent.name ?? `Agent ${agent.id}`}
                                </Button>
                            ))}
                        </div>
                    </section>

                    <section aria-label="Choose a day">
                        <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
                            <Calendar className="h-4 w-4" /> Day
                        </h2>
                        {data.days.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                No availability in the next two weeks. Please contact us directly.
                            </p>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {data.days.map((day) => (
                                    <Button
                                        key={day.date}
                                        variant={selectedDay === day.date ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => {
                                            setSelectedDay(day.date);
                                            setSelectedSlot(null);
                                        }}
                                    >
                                        {formatDay(day.date)}
                                    </Button>
                                ))}
                            </div>
                        )}
                    </section>

                    <section aria-label="Choose a time">
                        <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
                            <Clock className="h-4 w-4" /> Time
                        </h2>
                        {visibleSlots.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                No times for this selection. Try another day or agent.
                            </p>
                        ) : (
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                {visibleSlots.map((slot) => {
                                    const active =
                                        selectedSlot?.agentId === slot.agentId &&
                                        selectedSlot?.start === slot.start;
                                    return (
                                        <Button
                                            key={`${slot.agentId}-${slot.start}`}
                                            variant={active ? "default" : "outline"}
                                            size="sm"
                                            onClick={() => setSelectedSlot(slot)}
                                        >
                                            {formatTime(slot.start)} – {formatTime(slot.end)}
                                        </Button>
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    <Button
                        className="w-full"
                        disabled={!selectedSlot || confirming}
                        onClick={() => void handleConfirm()}
                    >
                        {confirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {confirming ? "Confirming…" : "Confirm booking"}
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
};

function BookErrorState({ error, onRetry }: { error: BookApiError; onRetry: () => void }) {
    const copy = (() => {
        switch (error.code) {
            case "invalid-token":
                return {
                    title: "Booking link invalid",
                    detail: "This booking link is not valid. Please ask for a new one.",
                    retry: false,
                };
            case "expired":
                return {
                    title: "Booking link expired",
                    detail: "This booking link has expired. Please ask for a new one.",
                    retry: false,
                };
            case "cancelled":
                return {
                    title: "Booking cancelled",
                    detail: "This booking request was cancelled. Please contact us to rebook.",
                    retry: false,
                };
            case "already-booked":
                return {
                    title: "Already booked",
                    detail:
                        error.appointmentId !== null
                            ? `This link already booked appointment #${error.appointmentId}.`
                            : "This link has already been used to book.",
                    retry: false,
                };
            default:
                return { title: "Something went wrong", detail: error.message, retry: true };
        }
    })();

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <Card className="w-full max-w-2xl">
                <CardHeader className="text-center">
                    <CardTitle>
                        <h1 className="text-2xl">{copy.title}</h1>
                    </CardTitle>
                    <CardDescription>{copy.detail}</CardDescription>
                </CardHeader>
                {copy.retry && (
                    <CardContent className="flex justify-center">
                        <Button onClick={onRetry}>Try again</Button>
                    </CardContent>
                )}
            </Card>
        </div>
    );
}

export default Book;
