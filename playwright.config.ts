import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke suite against the built bundle (`vite preview`). All Halo traffic is
 * intercepted and served from synthetic fixtures — no live tenant is touched.
 * Run: npm run build && npm run test:e2e
 */
export default defineConfig({
    testDir: "./e2e",
    fullyParallel: true,
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI ? "github" : "list",
    use: {
        baseURL: "http://localhost:4173",
        trace: "on-first-retry",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
    webServer: {
        command: "npm run preview -- --port 4173 --strictPort",
        port: 4173,
        reuseExistingServer: !process.env.CI,
    },
});
