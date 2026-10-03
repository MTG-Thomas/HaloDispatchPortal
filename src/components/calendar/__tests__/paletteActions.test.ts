import { describe, expect, it, vi } from "vitest";
import { buildPaletteActions, type PaletteContext } from "@/components/calendar/paletteActions";

function context(): PaletteContext {
    return {
        currentView: "week5",
        goToday: vi.fn(),
        goPrevious: vi.fn(),
        goNext: vi.fn(),
        setView: vi.fn(),
        refresh: vi.fn(),
        openHelp: vi.fn(),
    };
}

describe("buildPaletteActions", () => {
    it("marks the current view and routes every action to its handler", () => {
        const ctx = context();
        const groups = buildPaletteActions(ctx);
        const byId = new Map(groups.flatMap((g) => g.actions).map((a) => [a.id, a]));

        expect(byId.get("view-week5")?.label).toBe("Week (5) view (current)");
        expect(byId.get("view-day")?.label).toBe("Day view");

        byId.get("go-today")?.run();
        byId.get("go-previous")?.run();
        byId.get("go-next")?.run();
        byId.get("view-month")?.run();
        byId.get("refresh")?.run();
        byId.get("help")?.run();

        expect(ctx.goToday).toHaveBeenCalledTimes(1);
        expect(ctx.goPrevious).toHaveBeenCalledTimes(1);
        expect(ctx.goNext).toHaveBeenCalledTimes(1);
        expect(ctx.setView).toHaveBeenCalledWith("month");
        expect(ctx.refresh).toHaveBeenCalledTimes(1);
        expect(ctx.openHelp).toHaveBeenCalledTimes(1);
    });

    it("covers navigation, views, and actions exactly once", () => {
        const groups = buildPaletteActions(context());
        expect(groups.map((g) => g.heading)).toEqual(["Navigate", "View", "Actions"]);
        const ids = groups.flatMap((g) => g.actions.map((a) => a.id));
        expect(ids).toHaveLength(new Set(ids).size);
        expect(ids).toHaveLength(3 + 4 + 2);
    });
});
