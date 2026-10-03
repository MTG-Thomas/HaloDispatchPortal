// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createHaloClient, HaloApiError, isAgentOverbooked, type FetchImpl } from "../halo";
import type { Agent, Appointment, WorkingHours } from "../../src/types";

function workingHours(startTime = "09:00", endTime = "17:00"): WorkingHours {
    const working = { isWorking: true, startTime, endTime };
    const off = { isWorking: false, startTime: "09:00", endTime: "17:00" };
    return {
        monday: working,
        tuesday: working,
        wednesday: working,
        thursday: working,
        friday: working,
        saturday: off,
        sunday: off,
    };
}

function agent(partial: Partial<Agent> = {}): Agent {
    return {
        id: 7,
        name: "Dana Dispatcher",
        email: "dana@example.com",
        initials: "DD",
        role: "Engineer",
        teamIds: [],
        skills: [],
        workingHours: workingHours(),
        isActive: true,
        color: "#123456",
        ...partial,
    };
}

function appointment(partial: Partial<Appointment> = {}): Appointment {
    const startTime = new Date("2026-10-05T09:00:00.000Z"); // a Monday
    return {
        id: "apt-1",
        ticketId: "42",
        agentId: 7,
        startTime,
        endTime: new Date("2026-10-05T10:00:00.000Z"),
        status: "scheduled",
        isAllDay: false,
        isTentative: false,
        createdAt: startTime,
        updatedAt: startTime,
        ...partial,
    };
}

describe("Halo client", () => {
    it("fetches a ticket with the dispatcher bearer token", async () => {
        const fetchImpl: FetchImpl = vi.fn(async () =>
            Response.json({ id: 42, summary: "Printer down" }),
        );
        const client = createHaloClient({
            fetchImpl,
            resourceServer: "https://tenant.halopsa.com/",
            authServer: "https://auth.halopsa.com",
            clientId: "client-1",
        });
        await expect(client.getTicket("access-abc", 42)).resolves.toEqual({
            id: 42,
            summary: "Printer down",
        });
        expect(fetchImpl).toHaveBeenCalledWith("https://tenant.halopsa.com/api/Tickets/42", {
            headers: { Authorization: "Bearer access-abc" },
        });
    });

    it("throws HaloApiError on ticket failures", async () => {
        const client = createHaloClient({
            fetchImpl: async () => new Response("nope", { status: 404 }),
            resourceServer: "https://tenant.halopsa.com",
            authServer: "https://auth.halopsa.com",
            clientId: "client-1",
        });
        const error = await client.getTicket("access-abc", 1).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(HaloApiError);
        expect((error as HaloApiError).status).toBe(404);
    });

    it("refreshes a token pair via the injected transport", async () => {
        const fetchImpl: FetchImpl = vi.fn(async () =>
            Response.json({ access_token: "new-access", expires_in: 3600 }),
        );
        const client = createHaloClient({
            fetchImpl,
            resourceServer: "https://tenant.halopsa.com",
            authServer: "https://auth.halopsa.com",
            clientId: "client-1",
        });
        const refreshed = await client.refreshTokenPair({
            access_token: "old-access",
            refresh_token: "refresh-xyz",
        });
        expect(refreshed.access_token).toBe("new-access");
        // Providers that omit refresh_token keep the previous one.
        expect(refreshed.refresh_token).toBe("refresh-xyz");
        expect(typeof refreshed.obtained_at).toBe("number");
        const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [
            string,
            RequestInit,
        ];
        expect(url).toBe("https://auth.halopsa.com/token");
        expect(init.method).toBe("POST");
        const body = new URLSearchParams(init.body as string);
        expect(body.get("grant_type")).toBe("refresh_token");
        expect(body.get("refresh_token")).toBe("refresh-xyz");
    });

    it("throws HaloApiError on refresh failures", async () => {
        const client = createHaloClient({
            fetchImpl: async () => new Response("bad", { status: 400 }),
            resourceServer: "https://tenant.halopsa.com",
            authServer: "https://auth.halopsa.com",
            clientId: "client-1",
        });
        const error = await client
            .refreshTokenPair({ access_token: "a", refresh_token: "r" })
            .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(HaloApiError);
        expect((error as HaloApiError).status).toBe(400);
    });

    it("lists appointments with the SPA calendar params", async () => {
        const fetchImpl: FetchImpl = vi.fn(async () =>
            Response.json([
                {
                    id: 1,
                    agent_id: 7,
                    start_date: "2026-10-05T09:00:00",
                    end_date: "2026-10-05T10:00:00",
                    allday: false,
                    extra: "ignored",
                },
                { nope: "skipped" },
            ]),
        );
        const client = createHaloClient({
            fetchImpl,
            resourceServer: "https://tenant.halopsa.com",
            authServer: "https://auth.halopsa.com",
            clientId: "client-1",
        });
        const appointments = await client.getAppointments("access-abc", {
            startDate: "2026-10-05T00:00:00.000Z",
            endDate: "2026-10-06T00:00:00.000Z",
            agentIds: [7, 9],
            utcOffset: -300,
        });
        expect(appointments).toEqual([
            {
                id: 1,
                agent_id: 7,
                start_date: "2026-10-05T09:00:00",
                end_date: "2026-10-05T10:00:00",
                allday: false,
            },
        ]);
        const [url] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
        const query = new URL(url);
        expect(query.pathname).toBe("/api/Appointment");
        expect(query.searchParams.get("agents")).toBe("7,9");
        expect(query.searchParams.get("selectedStatuses")).toBe("0,1");
        expect(query.searchParams.get("appointmentsonly")).toBe("true");
        expect(query.searchParams.get("utcoffset")).toBe("-300");
    });

    it("throws HaloApiError on appointment failures", async () => {
        const client = createHaloClient({
            fetchImpl: async () => new Response("bad", { status: 500 }),
            resourceServer: "https://tenant.halopsa.com",
            authServer: "https://auth.halopsa.com",
            clientId: "client-1",
        });
        const error = await client
            .getAppointments("a", { startDate: "s", endDate: "e", agentIds: [7] })
            .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(HaloApiError);
        expect((error as HaloApiError).status).toBe(500);
    });

    it("lists agents with working hours from full rows", async () => {
        const fetchImpl: FetchImpl = vi.fn(async () =>
            Response.json([
                { id: 7, name: "Dana", workhour_start: 9.5, workhour_end: 17 },
                { id: 9, name: "Nina" },
                { id: "x", name: "skipped" },
            ]),
        );
        const client = createHaloClient({
            fetchImpl,
            resourceServer: "https://tenant.halopsa.com",
            authServer: "https://auth.halopsa.com",
            clientId: "client-1",
        });
        await expect(client.getAgents("access-abc")).resolves.toEqual([
            { id: 7, name: "Dana", workhourStart: 9.5, workhourEnd: 17 },
            { id: 9, name: "Nina" },
        ]);
        const [url] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
        expect(url).toContain("/api/agent?");
        // Full rows: basic_fields_only would strip the workhour fields.
        expect(url).not.toContain("basic_fields_only");
    });

    it("creates one appointment as a single-element array and returns its id", async () => {
        const fetchImpl: FetchImpl = vi.fn(async () => Response.json([{ id: 555 }]));
        const client = createHaloClient({
            fetchImpl,
            resourceServer: "https://tenant.halopsa.com",
            authServer: "https://auth.halopsa.com",
            clientId: "client-1",
        });
        const payload = { agent_id: 7, ticket_id: 42 };
        await expect(client.createAppointment("access-abc", payload)).resolves.toBe(555);
        const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [
            string,
            RequestInit,
        ];
        expect(url).toBe("https://tenant.halopsa.com/api/appointment");
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body as string)).toEqual([payload]);
    });

    it("throws when the create response carries no id", async () => {
        const client = createHaloClient({
            fetchImpl: async () => Response.json([{ nope: true }]),
            resourceServer: "https://tenant.halopsa.com",
            authServer: "https://auth.halopsa.com",
            clientId: "client-1",
        });
        const error = await client.createAppointment("a", {}).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(HaloApiError);
    });
});

describe("capacity reuse (src/lib/capacity.ts under node)", () => {
    const monday = new Date("2026-10-05T12:00:00.000Z");

    it("flags a fully scheduled working day as overbooked", () => {
        const fullDay = appointment({
            startTime: new Date("2026-10-05T09:00:00.000Z"),
            endTime: new Date("2026-10-05T17:00:00.000Z"),
        });
        expect(isAgentOverbooked(agent(), [fullDay], monday)).toBe(true);
    });

    it("leaves partially scheduled days bookable", () => {
        expect(isAgentOverbooked(agent(), [appointment()], monday)).toBe(false);
    });

    it("ignores non-working days", () => {
        const saturday = new Date("2026-10-10T12:00:00.000Z");
        expect(isAgentOverbooked(agent(), [appointment()], saturday)).toBe(false);
    });
});
