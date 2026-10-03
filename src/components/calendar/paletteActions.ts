import type { CalendarView } from "@/types";

export interface PaletteActionDef {
    id: string;
    label: string;
    /** Right-aligned hint, e.g. the keyboard shortcut. */
    hint?: string;
    run: () => void;
}

export interface PaletteActionGroup {
    heading: string;
    actions: PaletteActionDef[];
}

export interface PaletteContext {
    currentView: CalendarView;
    goToday: () => void;
    goPrevious: () => void;
    goNext: () => void;
    setView: (view: CalendarView) => void;
    refresh: () => void;
    openHelp: () => void;
}

const VIEWS: { view: CalendarView; label: string; hint: string }[] = [
    { view: "day", label: "Day view", hint: "1" },
    { view: "week5", label: "Week (5) view", hint: "2" },
    { view: "week7", label: "Week (7) view", hint: "3" },
    { view: "month", label: "Month view", hint: "4" },
];

/** Pure builder so the palette's behavior is unit-testable without a DOM. */
export function buildPaletteActions(ctx: PaletteContext): PaletteActionGroup[] {
    return [
        {
            heading: "Navigate",
            actions: [
                { id: "go-today", label: "Go to today", hint: "T", run: ctx.goToday },
                { id: "go-previous", label: "Previous period", hint: "←", run: ctx.goPrevious },
                { id: "go-next", label: "Next period", hint: "→", run: ctx.goNext },
            ],
        },
        {
            heading: "View",
            actions: VIEWS.map(({ view, label, hint }) => ({
                id: `view-${view}`,
                label: view === ctx.currentView ? `${label} (current)` : label,
                hint,
                run: () => ctx.setView(view),
            })),
        },
        {
            heading: "Actions",
            actions: [
                { id: "refresh", label: "Refresh appointments", hint: "R", run: ctx.refresh },
                { id: "help", label: "Keyboard shortcuts", hint: "?", run: ctx.openHelp },
            ],
        },
    ];
}
