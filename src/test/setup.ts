import { afterEach, vi } from "vitest";

// jest-dom matchers only exist where a DOM exists; worker tests run in node.
if (typeof document !== "undefined") {
    await import("@testing-library/jest-dom/vitest");
}

// Fail loudly on unhandled fetch calls: unit tests must mock fetch or MSW.
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (typeof localStorage !== "undefined") {
        localStorage.clear();
    }
    if (typeof sessionStorage !== "undefined") {
        sessionStorage.clear();
    }
});
