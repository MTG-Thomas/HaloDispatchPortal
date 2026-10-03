import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
    DISPATCHER_TOOL_NAMES,
    PUBLIC_TOOL_NAMES,
    dispatcherTools,
    getModelContext,
    isWebMcpSupported,
    publicBookingTools,
    registerWebMcpTools,
    type WebMcpModelContext,
    type WebMcpToolDefinition,
} from "@/lib/webmcp";
import {
    BookApiError,
    cancelBookingRequest,
    confirmBooking,
    confirmBookingSeries,
    extendBookingRequest,
    fetchBookSlots,
    fetchBookingAudit,
    fetchBookingRequests,
    fetchBookingStatus,
} from "@/lib/book-api";
import { loadDispatcherSession } from "@/services/auth/authService";
import { useDispatchStore } from "@/stores/useDispatchStore";
import { useWebMcpTools } from "@/hooks/useWebMcpTools";
import type { EnrichedTicket } from "@/types/halo";

vi.mock("@/lib/book-api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/book-api")>();
    return {
        ...actual,
        fetchBookSlots: vi.fn(),
        confirmBooking: vi.fn(),
        confirmBookingSeries: vi.fn(),
        fetchBookingRequests: vi.fn(),
        fetchBookingStatus: vi.fn(),
        fetchBookingAudit: vi.fn(),
        cancelBookingRequest: vi.fn(),
        extendBookingRequest: vi.fn(),
    };
});

vi.mock("@/services/auth/authService", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/services/auth/authService")>();
    return { ...actual, loadDispatcherSession: vi.fn() };
});

const TOKEN = "webmcp-test-token";
const SESSION_ID = "session-1";

function ticket(partial: Partial<EnrichedTicket> & { id: number }): EnrichedTicket {
    return {
        dateoccurred: "2026-10-03T11:00:00.000Z",
        lastactiondate: "2026-10-03T11:30:00.000Z",
        fixbydate: "2026-10-10T12:00:00.000Z",
        excludefromsla: false,
        onhold: false,
        priority_id: 3,
        summary: `Summary ${partial.id}`,
        slaState: "ok",
        ...partial,
    } as EnrichedTicket;
}

/** Spec-shaped stand-in for `document.modelContext` (WebMCP is a draft). */
function installStandIn(): { context: WebMcpModelContext; registered: WebMcpToolDefinition[] } {
    const registered: WebMcpToolDefinition[] = [];
    const context: WebMcpModelContext = {
        registerTool: vi.fn(async (tool: WebMcpToolDefinition) => {
            registered.push(tool);
            return undefined;
        }),
        getTools: vi.fn(async () => registered.map((tool) => ({ name: tool.name }))),
        executeTool: vi.fn(async (tool: string | { name: string }, input?: unknown) => {
            const name = typeof tool === "string" ? tool : tool.name;
            const match = registered.find((t) => t.name === name);
            if (!match) throw new Error(`unknown tool: ${name}`);
            return match.execute(input);
        }),
    };
    (document as unknown as { modelContext: WebMcpModelContext }).modelContext = context;
    return { context, registered };
}

function toolByName(tools: WebMcpToolDefinition[], name: string): WebMcpToolDefinition {
    const match = tools.find((tool) => tool.name === name);
    if (!match) throw new Error(`missing tool: ${name}`);
    return match;
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadDispatcherSession).mockReturnValue({
        sessionId: SESSION_ID,
    } as ReturnType<typeof loadDispatcherSession>);
});

afterEach(() => {
    delete (document as unknown as { modelContext?: WebMcpModelContext }).modelContext;
    delete (navigator as unknown as { modelContext?: WebMcpModelContext }).modelContext;
    useDispatchStore.setState({ haloTickets: [] });
    vi.restoreAllMocks();
});

describe("feature detection", () => {
    it("reports unsupported with no model context", () => {
        expect(isWebMcpSupported()).toBe(false);
        expect(getModelContext()).toBeNull();
    });

    it("finds document.modelContext first", () => {
        const { context } = installStandIn();
        expect(isWebMcpSupported()).toBe(true);
        expect(getModelContext()).toBe(context);
    });

    it("falls back to the deprecated navigator alias", () => {
        const { context } = installStandIn();
        delete (document as unknown as { modelContext?: WebMcpModelContext }).modelContext;
        (navigator as unknown as { modelContext: WebMcpModelContext }).modelContext = context;
        expect(getModelContext()).toBe(context);
    });
});

describe("registerWebMcpTools", () => {
    it("resolves [] when unsupported", async () => {
        await expect(registerWebMcpTools(publicBookingTools(TOKEN))).resolves.toEqual([]);
    });

    it("registers every tool and returns the manifest names", async () => {
        installStandIn();
        const tools = publicBookingTools(TOKEN);
        await expect(registerWebMcpTools(tools)).resolves.toEqual(PUBLIC_TOOL_NAMES);
    });

    it("skips a rejected tool and keeps the rest", async () => {
        const { context } = installStandIn();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.mocked(context.registerTool).mockRejectedValueOnce(new Error("duplicate name"));
        const names = await registerWebMcpTools(publicBookingTools(TOKEN));
        expect(names).toEqual(PUBLIC_TOOL_NAMES.slice(1));
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining("booking_list_slots"),
            expect.anything(),
        );
    });

    it("passes the abort signal through for route-scoped lifetime", async () => {
        const { context } = installStandIn();
        const controller = new AbortController();
        await registerWebMcpTools(publicBookingTools(TOKEN), { signal: controller.signal });
        expect(vi.mocked(context.registerTool)).toHaveBeenCalledWith(
            expect.objectContaining({ name: "booking_list_slots" }),
            { signal: controller.signal },
        );
    });
});

describe("tool manifests", () => {
    it("public factory names match PUBLIC_TOOL_NAMES", () => {
        expect(publicBookingTools(TOKEN).map((tool) => tool.name)).toEqual(PUBLIC_TOOL_NAMES);
    });

    it("dispatcher factory names match DISPATCHER_TOOL_NAMES", () => {
        expect(dispatcherTools().map((tool) => tool.name)).toEqual(DISPATCHER_TOOL_NAMES);
    });

    it("every tool has a description and only writes carry consequentialHint", () => {
        const writes = new Set([
            "booking_confirm",
            "booking_confirm_series",
            "dispatch_cancel_booking",
            "dispatch_extend_booking",
        ]);
        for (const tool of [...publicBookingTools(TOKEN), ...dispatcherTools()]) {
            expect(tool.description.length).toBeGreaterThan(0);
            expect(tool.annotations?.consequentialHint ?? false).toBe(writes.has(tool.name));
        }
    });
});

describe("public booking tools", () => {
    it("booking_list_slots forwards args and returns JSON", async () => {
        const slots = { rid: "r1", agents: [], days: [] };
        vi.mocked(fetchBookSlots).mockResolvedValue(slots as never);
        const tools = publicBookingTools(TOKEN);
        const result = await toolByName(tools, "booking_list_slots").execute({
            days: 7,
            utcOffset: -300,
        });
        expect(fetchBookSlots).toHaveBeenCalledWith({
            token: TOKEN,
            days: 7,
            durationMin: undefined,
            utcOffset: -300,
        });
        expect(JSON.parse(result)).toEqual(slots);
    });

    it("booking_confirm books the chosen slot", async () => {
        const confirmation = { rid: "r1", appointmentId: 555 };
        vi.mocked(confirmBooking).mockResolvedValue(confirmation as never);
        const tools = publicBookingTools(TOKEN);
        const result = await toolByName(tools, "booking_confirm").execute({
            agentId: 1,
            start: "2026-10-06T09:00:00.000Z",
            end: "2026-10-06T09:30:00.000Z",
        });
        expect(confirmBooking).toHaveBeenCalledWith({
            token: TOKEN,
            agentId: 1,
            start: "2026-10-06T09:00:00.000Z",
            end: "2026-10-06T09:30:00.000Z",
            utcOffset: undefined,
        });
        expect(JSON.parse(result)).toEqual(confirmation);
    });

    it("booking_confirm rejects malformed agent input without calling the BFF", async () => {
        const tools = publicBookingTools(TOKEN);
        await expect(
            toolByName(tools, "booking_confirm").execute({ agentId: "one" }),
        ).rejects.toThrow('"agentId" must be a number.');
        await expect(
            toolByName(tools, "booking_confirm").execute({
                agentId: 1,
                start: "not-a-date",
                end: "2026-10-06T09:30:00.000Z",
            }),
        ).rejects.toThrow('"start" must be an ISO-8601 date-time string.');
        expect(confirmBooking).not.toHaveBeenCalled();
    });

    it("booking_confirm_series forwards occurrence selections", async () => {
        const series = { rid: "r1", results: [] };
        vi.mocked(confirmBookingSeries).mockResolvedValue(series as never);
        const tools = publicBookingTools(TOKEN);
        await toolByName(tools, "booking_confirm_series").execute({
            bookings: [
                {
                    agentId: 1,
                    start: "2026-10-06T09:00:00.000Z",
                    end: "2026-10-06T09:30:00.000Z",
                    occurrence: "2026-10-06",
                },
            ],
        });
        expect(confirmBookingSeries).toHaveBeenCalledWith({
            token: TOKEN,
            bookings: [
                {
                    agentId: 1,
                    start: "2026-10-06T09:00:00.000Z",
                    end: "2026-10-06T09:30:00.000Z",
                    occurrence: "2026-10-06",
                },
            ],
            utcOffset: undefined,
        });
    });

    it("booking_confirm_series rejects a malformed occurrence", async () => {
        const tools = publicBookingTools(TOKEN);
        await expect(
            toolByName(tools, "booking_confirm_series").execute({ bookings: "nope" }),
        ).rejects.toThrow('"bookings" must be a non-empty array.');
        await expect(
            toolByName(tools, "booking_confirm_series").execute({
                bookings: [
                    {
                        agentId: 1,
                        start: "2026-10-06T09:00:00.000Z",
                        end: "2026-10-06T09:30:00.000Z",
                        occurrence: 6,
                    },
                ],
            }),
        ).rejects.toThrow('"bookings[0].occurrence" must be a YYYY-MM-DD date.');
        expect(confirmBookingSeries).not.toHaveBeenCalled();
    });

    it("surfaces BFF failures as user-safe messages", async () => {
        vi.mocked(fetchBookSlots).mockRejectedValue(
            new BookApiError("expired", "This booking link has expired."),
        );
        const tools = publicBookingTools(TOKEN);
        await expect(toolByName(tools, "booking_list_slots").execute({})).rejects.toThrow(
            "This booking link has expired.",
        );
    });
});

describe("dispatcher tools", () => {
    it("list/status/audit resolve the vault session per call", async () => {
        vi.mocked(fetchBookingRequests).mockResolvedValue([]);
        vi.mocked(fetchBookingStatus).mockResolvedValue({ rid: "r1" } as never);
        vi.mocked(fetchBookingAudit).mockResolvedValue({ rid: "r1", events: [] } as never);
        const tools = dispatcherTools();
        await toolByName(tools, "dispatch_list_booking_requests").execute({});
        await toolByName(tools, "dispatch_booking_status").execute({ rid: "r1" });
        await toolByName(tools, "dispatch_booking_audit").execute({ rid: "r1" });
        expect(fetchBookingRequests).toHaveBeenCalledWith(SESSION_ID);
        expect(fetchBookingStatus).toHaveBeenCalledWith("r1", SESSION_ID);
        expect(fetchBookingAudit).toHaveBeenCalledWith("r1", SESSION_ID);
    });

    it("cancel/extend forward the rid and session", async () => {
        vi.mocked(cancelBookingRequest).mockResolvedValue({ rid: "r1" } as never);
        vi.mocked(extendBookingRequest).mockResolvedValue({
            rid: "r1",
            token: "new-token",
            expiresAt: "2026-12-31T00:00:00.000Z",
        });
        const tools = dispatcherTools();
        await toolByName(tools, "dispatch_cancel_booking").execute({ rid: "r1" });
        const extended = await toolByName(tools, "dispatch_extend_booking").execute({
            rid: "r1",
            days: 5,
        });
        expect(cancelBookingRequest).toHaveBeenCalledWith("r1", SESSION_ID);
        expect(extendBookingRequest).toHaveBeenCalledWith({
            sessionId: SESSION_ID,
            rid: "r1",
            days: 5,
        });
        expect(JSON.parse(extended).url).toContain("/book/new-token");
    });

    it("throws a not-signed-in error instead of calling the BFF", async () => {
        vi.mocked(loadDispatcherSession).mockReturnValue(null);
        const tools = dispatcherTools();
        await expect(
            toolByName(tools, "dispatch_list_booking_requests").execute({}),
        ).rejects.toThrow("Not signed in as a dispatcher.");
        expect(fetchBookingRequests).not.toHaveBeenCalled();
    });

    it("dispatch_list_tickets projects loaded tickets with SLA state and score", async () => {
        useDispatchStore.setState({
            haloTickets: [
                ticket({ id: 1, summary: "Printer down", slaState: "overdue" }),
                ticket({ id: 2, summary: "VPN slow", slaState: "ok" }),
            ],
        });
        const tools = dispatcherTools();
        const rows = JSON.parse(
            await toolByName(tools, "dispatch_list_tickets").execute({ limit: 1 }),
        ) as Array<{ id: number; summary: string; slaState: string; score: number }>;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: 1, summary: "Printer down", slaState: "overdue" });
        expect(typeof rows[0].score).toBe("number");
    });

    it("dispatch_list_tickets defaults to 25 and sees nothing when unloaded", async () => {
        const tools = dispatcherTools();
        const rows = JSON.parse(
            await toolByName(tools, "dispatch_list_tickets").execute({}),
        ) as unknown[];
        expect(rows).toEqual([]);
    });
});

describe("useWebMcpTools", () => {
    it("registers on mount and aborts on unmount", async () => {
        const { context } = installStandIn();
        const tools = publicBookingTools(TOKEN);
        const { unmount } = renderHook(() => useWebMcpTools(tools));
        await vi.waitFor(() => {
            expect(vi.mocked(context.registerTool)).toHaveBeenCalledTimes(PUBLIC_TOOL_NAMES.length);
        });
        const signal = vi.mocked(context.registerTool).mock.calls[0][1]?.signal;
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal?.aborted).toBe(false);
        unmount();
        expect(signal?.aborted).toBe(true);
    });

    it("is a no-op without a model context", () => {
        const { unmount } = renderHook(() => useWebMcpTools(publicBookingTools(TOKEN)));
        unmount();
    });
});
