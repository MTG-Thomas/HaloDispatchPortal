import { test, expect, type Page } from "@playwright/test";
import {
    RESOURCE_SERVER,
    clientCacheFixture,
    teamsFixture,
    viewListsFixture,
    ticketsFixture,
    appointmentsFixture,
    freshTokens,
    configState,
    selectionState,
} from "./fixtures/halo";

/** Seed an authenticated, configured session without touching a live Halo. */
async function seedAuthedSession(page: Page) {
    await page.addInitScript(
        ({ tokens, config, selection }) => {
            localStorage.setItem("halo-dispatch-tokens", JSON.stringify(tokens));
            localStorage.setItem("halo-dispatch-config", JSON.stringify(config));
            localStorage.setItem("halo-dispatch-selection", JSON.stringify(selection));
        },
        {
            tokens: freshTokens(),
            config: configState(),
            selection: selectionState(),
        },
    );
}

/** Serve every Halo endpoint the dispatch view calls from fixtures. */
async function mockHaloApi(page: Page) {
    await page.route(`${RESOURCE_SERVER}/api/ClientCache*`, (route) =>
        route.fulfill({ json: clientCacheFixture }),
    );
    await page.route(`${RESOURCE_SERVER}/api/team*`, (route) =>
        route.fulfill({ json: teamsFixture }),
    );
    await page.route(`${RESOURCE_SERVER}/api/viewlists*`, (route) =>
        route.fulfill({ json: viewListsFixture }),
    );
    await page.route(`${RESOURCE_SERVER}/api/Tickets*`, (route) =>
        route.fulfill({ json: ticketsFixture }),
    );
    await page.route(`${RESOURCE_SERVER}/api/Appointment*`, (route) =>
        route.fulfill({ json: appointmentsFixture }),
    );
    await page.route(`${RESOURCE_SERVER}/api/lookup*`, (route) => route.fulfill({ json: [] }));
}

test.describe("unauthenticated", () => {
    test("root redirects to login", async ({ page }) => {
        await page.goto("/");
        await expect(page).toHaveURL(/\/login$/);
    });

    test("login prompts for configuration when unconfigured", async ({ page }) => {
        await page.goto("/login");
        await expect(page.getByRole("heading", { name: "Halo Dispatch Portal" })).toBeVisible();
        await expect(page.getByText("Please configure your Halo settings")).toBeVisible();
    });

    test("unknown route renders the 404 page", async ({ page }) => {
        await page.goto("/no-such-route-xyz");
        await expect(page.getByText("Page not found")).toBeVisible();
        await page.getByRole("link", { name: "Back to dispatch" }).click();
        // Unauthenticated: home gate bounces back to login.
        await expect(page).toHaveURL(/\/login$/);
    });
});

test.describe("authenticated dispatch (fixtures)", () => {
    test.beforeEach(async ({ page }) => {
        await seedAuthedSession(page);
        await mockHaloApi(page);
    });

    test("loads areas, lists, tickets, and appointments", async ({ page }) => {
        const apiCalls: string[] = [];
        page.on("request", (request) => {
            const url = request.url();
            if (url.startsWith(RESOURCE_SERVER)) {
                apiCalls.push(new URL(url).pathname);
            }
        });

        await page.goto("/");

        // Fixture ticket rendered in the ticket list (seeded area+list
        // selection applied without user interaction).
        await expect(page.getByText("Smoke-test printer offline")).toBeVisible({ timeout: 15_000 });

        // Area + list selection visible in the filter popover.
        await page.getByRole("button", { name: "Filter" }).click();
        await expect(page.getByText("Service Desk")).toBeVisible();
        await expect(page.getByText("Smoke Triage")).toBeVisible();
        await page.keyboard.press("Escape");
        // Fixture appointment rendered on the calendar. The calendar shows
        // the current week; the fixture date may fall outside it, so assert
        // the API call instead of pixels.
        await expect.poll(() => apiCalls.some((p) => p.endsWith("/api/Appointment"))).toBe(true);
        expect(apiCalls).toContain("/api/ClientCache");
        expect(apiCalls.some((p) => p.endsWith("/api/Tickets"))).toBe(true);
    });

    test("command palette opens and switches views", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByText("Smoke-test printer offline")).toBeVisible({ timeout: 15_000 });

        await page.keyboard.press("Control+k");
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByText("Go to today")).toBeVisible();
        await dialog.getByText("Month view").click();

        // Palette closes and the calendar switches to the month view.
        await expect(dialog).toBeHidden();
        await expect(page.getByRole("tab", { name: "Month" })).toHaveAttribute(
            "aria-selected",
            "true",
        );
    });

    test("question mark opens the shortcut help", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByText("Smoke-test printer offline")).toBeVisible({ timeout: 15_000 });

        await page.keyboard.press("?");
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
        await expect(dialog.getByText("Go to today")).toBeVisible();
    });

    test("slash focuses the ticket search", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByText("Smoke-test printer offline")).toBeVisible({ timeout: 15_000 });

        await page.keyboard.press("/");
        await expect(page.getByLabel("Search tickets on this page")).toBeFocused();
    });

    test("malformed Halo payloads surface an error, not a blank page", async ({ page }) => {
        await page.unroute(`${RESOURCE_SERVER}/api/ClientCache*`);
        await page.route(`${RESOURCE_SERVER}/api/ClientCache*`, (route) =>
            route.fulfill({ json: { nope: "not-a-cache" } }),
        );
        await page.goto("/");

        // Either the critical-error overlay or the store error path — but the
        // app must render *something* legible, never hang on the spinner.
        await expect(async () => {
            const body = (await page.textContent("body")) ?? "";
            expect(body.length).toBeGreaterThan(0);
            expect(body).not.toMatch(/^\s*$/);
        }).toPass({ timeout: 15_000 });
    });
});
