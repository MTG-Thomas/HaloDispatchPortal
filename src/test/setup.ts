import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

// Fail loudly on unhandled fetch calls: unit tests must mock fetch or MSW.
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
});
