import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useNow } from "@/hooks/useNow";

describe("useNow", () => {
    beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-03T12:00:00") }));
    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    it("returns the current time and advances on the interval", () => {
        const { result } = renderHook(() => useNow(60_000));
        expect(result.current).toEqual(new Date("2026-10-03T12:00:00"));

        act(() => {
            vi.advanceTimersByTime(60_000);
        });
        expect(result.current).toEqual(new Date("2026-10-03T12:01:00"));
    });

    it("stops ticking after unmount", () => {
        const clearSpy = vi.spyOn(globalThis, "clearInterval");
        const { unmount } = renderHook(() => useNow(60_000));
        unmount();
        expect(clearSpy).toHaveBeenCalled();
        clearSpy.mockRestore();
    });
});
