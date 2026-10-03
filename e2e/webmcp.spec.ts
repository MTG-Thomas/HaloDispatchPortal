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
 * WebMCP scope suite. Installs a spec-shaped `document.modelContext`
 * stand-in (WebMCP is a draft; no browser here ships it) and asserts each
 * route registers exactly its tool manifest — and that the tools actually
 * execute through the real client modules. Run after a build:
 * `npm run build && npx playwright test e2e/webmcp.spec.ts`.
 */

// Manifest contract: must match PUBLIC_TOOL_NAMES in src/lib/webmcp.ts.
const PUBLIC_TOOL_NAMES = ["booking_list_slots", "booking_confirm", "booking_confirm_series"];

// Manifest contract: must match DISPATCHER_TOOL_NAMES in src/lib/webmcp.ts.
const DISPATCHER_TOOL_NAMES = [
    "dispatch_list_booking_requests",
    "dispatch_booking_status",
    "dispatch_booking_audit",
    "dispatch_cancel_booking",
    "dispatch_extend_booking",
    "dispatch_list_tickets",
];

const RID = "rid-webmcp-1";

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

/** Install the model-context stand-in before any page script runs. */
async function installStandIn(page: Page) {
    await page.addInitScript(() => {
        const w = window as unknown as {
            __webmcpTools: string[];
            __webmcpRegistry: Record<string, { execute: (input: unknown) => Promise<string> }>;
        };
        w.__webmcpTools = [];
        w.__webmcpRegistry = {};
        (
            document as unknown as {
                modelContext: {
                    registerTool: (
                        tool: { name: string; execute: (input: unknown) => Promise<string> },
                        options?: { signal?: AbortSignal },
                    ) => Promise<undefined>;
                    getTools: () => Promise<Array<{ name: string }>>;
                    executeTool: (name: string, input?: unknown) => Promise<string>;
                };
            }
        ).modelContext = {
            registerTool: async (tool, options) => {
                w.__webmcpTools.push(tool.name);
                w.__webmcpRegistry[tool.name] = tool;
                options?.signal?.addEventListener("abort", () => {
                    delete w.__webmcpRegistry[tool.name];
                });
                return undefined;
            },
            getTools: async () => w.__webmcpTools.map((name) => ({ name })),
            executeTool: async (name, input) => {
                const tool = w.__webmcpRegistry[name];
                if (!tool) throw new Error(`unknown tool: ${name}`);
                return tool.execute(input);
            },
        };
    });
}

async function registeredNames(page: Page): Promise<string[]> {
    return page.evaluate(() => (window as unknown as { __webmcpTools: string[] }).__webmcpTools);
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

test.describe("WebMCP dispatcher scope", () => {
    test.beforeEach(async ({ page }) => {
        await installStandIn(page);
        await seedAuthedSession(page);
        await mockHaloApi(page);
    });

    test("dispatch view registers exactly the dispatcher manifest", async ({ page }) => {
        await page.goto("/");
        await page.waitForFunction(
            (expected) =>
                (window as unknown as { __webmcpTools: string[] }).__webmcpTools.length ===
                expected,
            DISPATCHER_TOOL_NAMES.length,
        );
        expect(await registeredNames(page)).toEqual(DISPATCHER_TOOL_NAMES);
    });

    test("dispatch_list_tickets executes against the loaded view", async ({ page }) => {
        await page.goto("/");
        await page.waitForFunction(
            (expected) =>
                (window as unknown as { __webmcpTools: string[] }).__webmcpTools.length ===
                expected,
            DISPATCHER_TOOL_NAMES.length,
        );
        // Tickets load after mount; wait for the fixture ticket to render
        // (same marker as the smoke suite) so the store is settled.
        await expect(page.getByText("Smoke-test printer offline")).toBeVisible({ timeout: 15_000 });
        const rows = (await page.evaluate(async () => {
            const context = (
                document as unknown as {
                    modelContext: {
                        executeTool: (name: string, input?: unknown) => Promise<string>;
                    };
                }
            ).modelContext;
            return JSON.parse(await context.executeTool("dispatch_list_tickets", { limit: 5 }));
        })) as Array<{ id: number; summary: string; slaState: string; score: number }>;
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.length).toBeLessThanOrEqual(5);
        for (const row of rows) {
            expect(typeof row.id).toBe("number");
            expect(typeof row.summary).toBe("string");
            expect(typeof row.slaState).toBe("string");
            expect(typeof row.score).toBe("number");
        }
    });
});

test.describe("WebMCP public booking scope", () => {
    test.beforeEach(async ({ page }) => {
        await installStandIn(page);
        await page.route("**/api/book/**", (route) => {
            const url = new URL(route.request().url());
            if (url.pathname.endsWith("/slots")) {
                return route.fulfill({
                    json: {
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
                                ],
                            },
                        ],
                        durationMin: 30,
                        utcOffset: 0,
                    },
                });
            }
            return route.fulfill({ status: 404, json: { error: "Not found" } });
        });
    });

    test("booking page registers exactly the public manifest", async ({ page }) => {
        await page.goto(`/book/${TOKEN}`);
        await expect(page.getByRole("heading", { name: "Book your appointment" })).toBeVisible();
        await page.waitForFunction(
            (expected) =>
                (window as unknown as { __webmcpTools: string[] }).__webmcpTools.length ===
                expected,
            PUBLIC_TOOL_NAMES.length,
        );
        expect(await registeredNames(page)).toEqual(PUBLIC_TOOL_NAMES);
    });

    test("booking_list_slots executes through the real client", async ({ page }) => {
        await page.goto(`/book/${TOKEN}`);
        await expect(page.getByRole("heading", { name: "Book your appointment" })).toBeVisible();
        const slots = (await page.evaluate(async () => {
            const context = (
                document as unknown as {
                    modelContext: {
                        executeTool: (name: string, input?: unknown) => Promise<string>;
                    };
                }
            ).modelContext;
            return JSON.parse(await context.executeTool("booking_list_slots", {}));
        })) as { rid: string; agents: unknown[]; days: unknown[] };
        expect(slots.rid).toBe(RID);
        expect(slots.agents).toHaveLength(1);
        expect(slots.days).toHaveLength(1);
    });
});
