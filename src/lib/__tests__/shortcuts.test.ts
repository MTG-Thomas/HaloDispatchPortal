import { describe, expect, it } from "vitest";
import { resolveCalendarShortcut, type ShortcutEvent } from "@/lib/shortcuts";

function event(partial: Partial<ShortcutEvent>): ShortcutEvent {
    return { key: "", metaKey: false, ctrlKey: false, inEditable: false, ...partial };
}

describe("resolveCalendarShortcut", () => {
    it("maps view, navigation, and utility keys", () => {
        expect(resolveCalendarShortcut(event({ key: "1" }))).toEqual({ kind: "view", view: "day" });
        expect(resolveCalendarShortcut(event({ key: "2" }))).toEqual({
            kind: "view",
            view: "week5",
        });
        expect(resolveCalendarShortcut(event({ key: "3" }))).toEqual({
            kind: "view",
            view: "week7",
        });
        expect(resolveCalendarShortcut(event({ key: "4" }))).toEqual({
            kind: "view",
            view: "month",
        });
        expect(resolveCalendarShortcut(event({ key: "t" }))).toEqual({ kind: "today" });
        expect(resolveCalendarShortcut(event({ key: "ArrowLeft" }))).toEqual({ kind: "previous" });
        expect(resolveCalendarShortcut(event({ key: "ArrowRight" }))).toEqual({ kind: "next" });
        expect(resolveCalendarShortcut(event({ key: "/" }))).toEqual({ kind: "focus-search" });
        expect(resolveCalendarShortcut(event({ key: "r" }))).toEqual({ kind: "refresh" });
        expect(resolveCalendarShortcut(event({ key: "?" }))).toEqual({ kind: "help" });
    });

    it("opens the palette on Cmd/Ctrl+K outside editable elements", () => {
        expect(resolveCalendarShortcut(event({ key: "k", metaKey: true }))).toEqual({
            kind: "palette",
        });
        expect(resolveCalendarShortcut(event({ key: "K", ctrlKey: true }))).toEqual({
            kind: "palette",
        });
        expect(
            resolveCalendarShortcut(event({ key: "k", metaKey: true, inEditable: true })),
        ).toBeNull();
    });

    it("keeps Escape working everywhere", () => {
        expect(resolveCalendarShortcut(event({ key: "Escape", inEditable: true }))).toEqual({
            kind: "clear-selection",
        });
    });

    it("ignores keystrokes while typing or with modifiers", () => {
        expect(resolveCalendarShortcut(event({ key: "t", inEditable: true }))).toBeNull();
        expect(resolveCalendarShortcut(event({ key: "1", inEditable: true }))).toBeNull();
        expect(resolveCalendarShortcut(event({ key: "r", ctrlKey: true }))).toBeNull();
        expect(resolveCalendarShortcut(event({ key: "t", metaKey: true }))).toBeNull();
    });

    it("returns null for unmapped keys", () => {
        expect(resolveCalendarShortcut(event({ key: "q" }))).toBeNull();
        expect(resolveCalendarShortcut(event({ key: "Enter" }))).toBeNull();
    });
});
