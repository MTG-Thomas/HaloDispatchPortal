import type { CalendarView } from "@/types";

export type CalendarShortcutAction =
    | { kind: "today" }
    | { kind: "previous" }
    | { kind: "next" }
    | { kind: "view"; view: CalendarView }
    | { kind: "focus-search" }
    | { kind: "refresh" }
    | { kind: "help" }
    | { kind: "palette" }
    | { kind: "clear-selection" };

export interface ShortcutEvent {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    /** True when focus is in an editable element (input, textarea, select, contentEditable). */
    inEditable: boolean;
}

const VIEW_KEYS: Record<string, CalendarView> = {
    "1": "day",
    "2": "week5",
    "3": "week7",
    "4": "month",
};

/**
 * Pure key-to-action mapping for the dispatch calendar. Returns null when the
 * keystroke should be left alone (typing, unmapped key).
 */
export function resolveCalendarShortcut(event: ShortcutEvent): CalendarShortcutAction | null {
    if (event.key === "Escape") {
        return { kind: "clear-selection" };
    }
    // Cmd/Ctrl+K opens the command palette from anywhere except editable text.
    if ((event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey)) {
        return event.inEditable ? null : { kind: "palette" };
    }
    if (event.metaKey || event.ctrlKey || event.inEditable) {
        return null;
    }
    switch (event.key) {
        case "t":
        case "T":
            return { kind: "today" };
        case "ArrowLeft":
        case "[":
            return { kind: "previous" };
        case "ArrowRight":
        case "]":
            return { kind: "next" };
        case "/":
            return { kind: "focus-search" };
        case "r":
        case "R":
            return { kind: "refresh" };
        case "?":
            return { kind: "help" };
        default:
            break;
    }
    const view = VIEW_KEYS[event.key];
    if (view) {
        return { kind: "view", view };
    }
    return null;
}

export interface ShortcutHelpEntry {
    keys: string;
    description: string;
}

export const SHORTCUT_HELP: ShortcutHelpEntry[] = [
    { keys: "1 / 2 / 3 / 4", description: "Day / Week (5) / Week (7) / Month view" },
    { keys: "T", description: "Go to today" },
    { keys: "← / →", description: "Previous / next period" },
    { keys: "/", description: "Focus ticket search" },
    { keys: "R", description: "Refresh appointments" },
    { keys: "Ctrl/⌘ K", description: "Command palette" },
    { keys: "?", description: "This shortcut list" },
    { keys: "Esc", description: "Clear time-slot selection" },
];
