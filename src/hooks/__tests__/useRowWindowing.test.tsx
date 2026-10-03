import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ROW_WINDOW_CHUNK, useRowWindowing } from "@/hooks/useRowWindowing";

type ObserverCallback = (entries: { isIntersecting: boolean }[]) => void;

function Harness({ total, chunk }: { total: number; chunk: number }) {
    const { visibleCount, sentinelRef } = useRowWindowing(total, chunk);
    return (
        <table>
            <tbody>
                {Array.from({ length: visibleCount }, (_, i) => (
                    <tr key={i} data-testid="row" />
                ))}
                {visibleCount < total && <tr ref={sentinelRef} data-testid="sentinel" />}
            </tbody>
        </table>
    );
}

describe("useRowWindowing", () => {
    const RealObserver = globalThis.IntersectionObserver;
    let callback: ObserverCallback = () => {};

    afterEach(() => {
        vi.unstubAllGlobals();
        globalThis.IntersectionObserver = RealObserver;
        callback = () => {};
    });

    function stubObserver() {
        class FakeObserver {
            constructor(cb: ObserverCallback) {
                callback = cb;
            }
            observe() {}
            disconnect() {}
            unobserve() {}
        }
        vi.stubGlobal("IntersectionObserver", FakeObserver);
    }

    it(`renders one chunk of ${ROW_WINDOW_CHUNK}, then grows on sentinel intersect`, () => {
        stubObserver();
        render(<Harness total={100} chunk={40} />);
        expect(screen.getAllByTestId("row")).toHaveLength(40);
        expect(screen.getByTestId("sentinel")).toBeDefined();

        act(() => {
            callback([{ isIntersecting: true }]);
        });
        expect(screen.getAllByTestId("row")).toHaveLength(80);

        act(() => {
            callback([{ isIntersecting: true }]);
        });
        expect(screen.getAllByTestId("row")).toHaveLength(100);
        expect(screen.queryByTestId("sentinel")).toBeNull();
    });

    it("re-observes the new sentinel when the table remounts with identical counts", () => {
        const observed: unknown[] = [];
        class RemountObserver {
            constructor(cb: ObserverCallback) {
                callback = cb;
            }
            observe(el: unknown) {
                observed.push(el);
            }
            disconnect() {}
            unobserve() {}
        }
        vi.stubGlobal("IntersectionObserver", RemountObserver);

        const { rerender } = render(<Harness key="a" total={100} chunk={40} />);
        expect(screen.getAllByTestId("row")).toHaveLength(40);
        const firstSentinel = observed[0];
        expect(firstSentinel).toBeDefined();

        // Remount with the same row count (e.g. page 1 -> 2, both full).
        rerender(<Harness key="b" total={100} chunk={40} />);
        expect(observed.length).toBeGreaterThan(1);
        expect(observed[observed.length - 1]).not.toBe(firstSentinel);

        // The new sentinel drives growth.
        act(() => {
            callback([{ isIntersecting: true }]);
        });
        expect(screen.getAllByTestId("row")).toHaveLength(80);
    });

    it("ignores non-intersecting callbacks", () => {
        stubObserver();
        render(<Harness total={100} chunk={40} />);
        act(() => {
            callback([{ isIntersecting: false }]);
        });
        expect(screen.getAllByTestId("row")).toHaveLength(40);
    });

    it("renders everything when the list fits in one chunk", () => {
        stubObserver();
        render(<Harness total={12} chunk={40} />);
        expect(screen.getAllByTestId("row")).toHaveLength(12);
        expect(screen.queryByTestId("sentinel")).toBeNull();
    });

    it("renders everything when IntersectionObserver is unavailable", () => {
        vi.stubGlobal("IntersectionObserver", undefined);
        render(<Harness total={100} chunk={40} />);
        expect(screen.getAllByTestId("row")).toHaveLength(100);
    });
});
