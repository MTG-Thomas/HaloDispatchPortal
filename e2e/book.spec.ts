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

/**
 * Public booking-link suite (`/book/:token`). The Worker BFF is mocked at the
 * network boundary — no live Halo or Worker is touched. Run after a build:
 * `npm run build && npx playwright test e2e/book.spec.ts`.
 */

const RID = "rid-e2e-1";

/** Well-shaped (unverified — the mock accepts anything) booking token. */
function fakeToken(rid: string): string {
    const payload = Buffer.from(
        JSON.stringify({
            rid,
            ticketId: 4242,
            agentIds: [1],
            appointmentTypeId: 1,
            exp: 9_999_999_999,
        }),
    ).toString("base64url");
    return `${payload}.fakesignature`;
}

const TOKEN = fakeToken(RID);

function slotsBody() {
    return {
        rid: RID,
        ticketId: 4242,
        appointmentTypeId: 1,
        expiresAt: "2026-12-31T00:00:00.000Z",
        firstView: true,
        agents: [{ id: 1, name: "Smoke Agent" }],
        days: [
            {
                date: "2026-10-06",
                slots: [
                    {
                        agentId: 1,
                        start: "2026-10-06T09:00:00.000Z",
                        end: "2026-10-06T09:30:00.000Z",
                    },
                    {
                        agentId: 1,
                        start: "2026-10-06T10:00:00.000Z",
                        end: "2026-10-06T10:30:00.000Z",
                    },
                ],
            },
            {
                date: "2026-10-07",
                slots: [
                    {
                        agentId: 1,
                        start: "2026-10-07T09:00:00.000Z",
                        end: "2026-10-07T09:30:00.000Z",
                    },
                ],
            },
        ],
        durationMin: 30,
        utcOffset: 0,
    };
}

/** Mock the Worker BFF; bookFulfill decides the POST /book outcome per test. */
async function mockBookApi(
    page: Page,
    options: {
        slotsStatus?: number;
        slotsBody?: unknown;
        bookStatus?: number;
        bookBody?: unknown;
    } = {},
) {
    await page.route("**/api/book/**", (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith("/slots")) {
            return route.fulfill({
                status: options.slotsStatus ?? 200,
                json: options.slotsBody ?? slotsBody(),
            });
        }
        if (url.pathname.endsWith("/book")) {
            return route.fulfill({
                status: options.bookStatus ?? 201,
                json:
                    options.bookBody ??
                    ({
                        rid: RID,
                        appointmentId: 555,
                        agentId: 1,
                        start: "2026-10-06T09:00:00.000Z",
                        end: "2026-10-06T09:30:00.000Z",
                    } as unknown),
            });
        }
        return route.fulfill({ status: 404, json: { error: "Not found" } });
    });
}

test.describe("public booking link", () => {
    test("happy path: pick a slot and confirm without logging in", async ({ page }) => {
        await mockBookApi(page);
        // No session seeded: /book must not bounce to /login.
        await page.goto(`/book/${TOKEN}`);

        await expect(page.getByRole("heading", { name: "Book your appointment" })).toBeVisible();
        await expect(page).not.toHaveURL(/\/login$/);

        // Day two has one slot; pick it, then confirm.
        await page.getByRole("button", { name: /Oct 7/ }).click();
        const slotButtons = page.locator('section[aria-label="Choose a time"] button');
        await expect(slotButtons).toHaveCount(1);
        await slotButtons.first().click();

        const confirm = page.getByRole("button", { name: "Confirm booking" });
        await expect(confirm).toBeEnabled();
        await confirm.click();

        await expect(page.getByRole("heading", { name: "Booking confirmed" })).toBeVisible();
        await expect(page.getByText("with Smoke Agent")).toBeVisible();
        await expect(page.getByText(/Appointment #555/)).toBeVisible();
    });

    test("expired token shows the expired state", async ({ page }) => {
        await mockBookApi(page, { slotsStatus: 410, slotsBody: { error: "expired", rid: RID } });
        await page.goto(`/book/${TOKEN}`);
        await expect(page.getByRole("heading", { name: "Booking link expired" })).toBeVisible();
    });

    test("already-booked replay shows the already-booked state", async ({ page }) => {
        await mockBookApi(page, {
            bookStatus: 409,
            bookBody: { error: "already-booked", rid: RID, appointmentId: 555 },
        });
        await page.goto(`/book/${TOKEN}`);
        await expect(page.getByRole("heading", { name: "Book your appointment" })).toBeVisible();

        const slotButtons = page.locator('section[aria-label="Choose a time"] button');
        await slotButtons.first().click();
        await page.getByRole("button", { name: "Confirm booking" }).click();

        await expect(page.getByRole("heading", { name: "Already booked" })).toBeVisible();
        await expect(page.getByText(/appointment #555/)).toBeVisible();
    });

    test("malformed token shows the invalid state without calling the API", async ({ page }) => {
        let apiCalls = 0;
        await page.route("**/api/book/**", (route) => {
            apiCalls += 1;
            return route.fulfill({ status: 500, json: {} });
        });
        await page.goto("/book/not-a-token");
        await expect(page.getByRole("heading", { name: "Booking link invalid" })).toBeVisible();
        expect(apiCalls).toBe(0);
    });
});

/**
 * Dispatcher tracking (slice 3): per-ticket status chips plus the
 * outstanding-requests queue. The dispatch view is seeded like the smoke
 * suite (authed session, fixture Halo) and the Worker BFF is mocked at the
 * network boundary — no live Halo or Worker is touched.
 */
const TRACK_RID = "rid-track-1";
const TRACK_TICKET = 4242;

function trackSummary(overrides: Record<string, unknown> = {}) {
    return {
        rid: TRACK_RID,
        status: "pending",
        ticketId: TRACK_TICKET,
        agentIds: [1],
        appointmentTypeId: 1,
        createdAt: new Date(Date.now() - 3600_000).toISOString(),
        updatedAt: new Date(Date.now() - 3600_000).toISOString(),
        exp: Math.floor(Date.now() / 1000) + 3600,
        clickedAt: null,
        bookedAppointmentId: null,
        ...overrides,
    };
}

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

/** Mock the Worker tracking endpoints (list + cancel for the tracked rid). */
async function mockBookingApi(
    page: Page,
    options: { requests?: unknown[]; cancelTo?: unknown } = {},
) {
    await page.route("**/api/book/requests", (route) => {
        if (route.request().method() === "GET") {
            return route.fulfill({ json: { requests: options.requests ?? [trackSummary()] } });
        }
        return route.fulfill({ status: 404, json: { error: "Not found" } });
    });
    await page.route(`**/api/book/requests/${TRACK_RID}/cancel`, (route) =>
        route.fulfill({ json: options.cancelTo ?? trackSummary({ status: "cancelled" }) }),
    );
}

test.describe("dispatcher booking tracking", () => {
    test.beforeEach(async ({ page }) => {
        await seedAuthedSession(page);
        await mockHaloApi(page);
    });

    test("status chip renders for a mocked pending request", async ({ page }) => {
        await mockBookingApi(page);
        await page.goto("/");
        await expect(page.getByText("Smoke-test printer offline")).toBeVisible({
            timeout: 15_000,
        });

        await expect(page.getByTestId(`booking-status-${TRACK_TICKET}`)).toHaveText("sent", {
            timeout: 15_000,
        });
        await expect(
            page.getByRole("button", { name: `Resend booking link for ticket ${TRACK_TICKET}` }),
        ).toBeVisible();
        await expect(
            page.getByRole("button", { name: `Cancel booking request for ticket ${TRACK_TICKET}` }),
        ).toBeVisible();
        // Queue button carries the open count.
        await expect(
            page.getByRole("button", { name: "Open booking requests queue" }),
        ).toContainText("1");
    });

    test("cancel flips chip state", async ({ page }) => {
        await mockBookingApi(page);
        await page.goto("/");
        await expect(page.getByTestId(`booking-status-${TRACK_TICKET}`)).toHaveText("sent", {
            timeout: 15_000,
        });

        await page
            .getByRole("button", { name: `Cancel booking request for ticket ${TRACK_TICKET}` })
            .click();

        await expect(page.getByTestId(`booking-status-${TRACK_TICKET}`)).toHaveText("canceled");
        // Terminal: no resend/cancel offered on a cancelled request.
        await expect(
            page.getByRole("button", { name: `Resend booking link for ticket ${TRACK_TICKET}` }),
        ).toBeHidden();
        await expect(
            page.getByRole("button", { name: `Cancel booking request for ticket ${TRACK_TICKET}` }),
        ).toBeHidden();
    });

    test("expired requests offer resend-as-new only", async ({ page }) => {
        await mockBookingApi(page, { requests: [trackSummary({ status: "expired" })] });
        await page.goto("/");
        await expect(page.getByTestId(`booking-status-${TRACK_TICKET}`)).toHaveText("expired", {
            timeout: 15_000,
        });

        await expect(
            page.getByRole("button", { name: `Resend booking link for ticket ${TRACK_TICKET}` }),
        ).toBeVisible();
        await expect(
            page.getByRole("button", { name: `Cancel booking request for ticket ${TRACK_TICKET}` }),
        ).toBeHidden();
    });

    test("queue dialog lists the open request", async ({ page }) => {
        await mockBookingApi(page);
        await page.goto("/");
        await expect(page.getByTestId(`booking-status-${TRACK_TICKET}`)).toHaveText("sent", {
            timeout: 15_000,
        });

        await page.getByRole("button", { name: "Open booking requests queue" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByText(`#${TRACK_TICKET}`)).toBeVisible();
        await expect(dialog.getByTestId(`booking-queue-status-${TRACK_TICKET}`)).toHaveText("sent");

        // Queue cancel flips both the queue row and the ticket chip (shared tracker).
        await dialog
            .getByRole("button", { name: `Cancel booking request for ticket ${TRACK_TICKET}` })
            .click();
        await expect(dialog.getByTestId(`booking-queue-status-${TRACK_TICKET}`)).toHaveText(
            "canceled",
        );
        await expect(page.getByTestId(`booking-status-${TRACK_TICKET}`)).toHaveText("canceled");
    });
});
