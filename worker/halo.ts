/**
 * Halo REST client for Worker-side booking calls. `fetch` is injected so the
 * client stays testable under plain node/vitest with a stub transport.
 *
 * Capacity rules are reused from `src/lib/capacity.ts` (verified: it imports
 * only `date-fns` and `@/types`, no DOM), so slot/overbooking decisions match
 * the SPA exactly.
 */

import { dayUtilization, weekUtilization } from "../src/lib/capacity";
import type { Agent, Appointment } from "../src/types";
import type { HaloTokenPair } from "./kv";

export type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface HaloClientOptions {
    fetchImpl: FetchImpl;
    /** Halo resource server origin, e.g. `https://tenant.halopsa.com`. */
    resourceServer: string;
    /** Halo auth server origin (token endpoint host). */
    authServer: string;
    clientId: string;
}

export class HaloApiError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = "HaloApiError";
        this.status = status;
    }
}

export interface HaloClient {
    /** Fetch one ticket by id. Returns the decoded JSON body. */
    getTicket(accessToken: string, ticketId: number): Promise<unknown>;
    /** Refresh a dispatcher token pair via the `refresh_token` grant. */
    refreshTokenPair(pair: HaloTokenPair): Promise<HaloTokenPair>;
    /**
     * List appointments over a window. Mirrors the SPA `getAppointments`
     * params (`src/services/halo-api.ts`) so Worker-side availability matches
     * the calendar exactly.
     */
    getAppointments(
        accessToken: string,
        args: { startDate: string; endDate: string; agentIds: number[]; utcOffset?: number },
    ): Promise<WorkerAppointment[]>;
    /** Minimal agent directory (id + name) for booking-picker labels. */
    getAgents(accessToken: string): Promise<WorkerAgent[]>;
    /**
     * Create one appointment (POSTed as a single-element array, as Halo
     * requires). Returns the created appointment id.
     */
    createAppointment(accessToken: string, payload: Record<string, unknown>): Promise<number>;
}

/**
 * Minimal appointment projection the Worker needs for availability and
 * booking. Parsed defensively: Halo shape drift must not crash booking.
 */
export interface WorkerAppointment {
    id: number;
    agent_id: number;
    start_date: string;
    end_date: string;
    allday: boolean;
}

export interface WorkerAgent {
    id: number;
    name: string;
}

function stripTrailingSlash(origin: string): string {
    return origin.replace(/\/$/, "");
}

function toWorkerAppointments(body: unknown): WorkerAppointment[] {
    if (!Array.isArray(body)) {
        return [];
    }
    const out: WorkerAppointment[] = [];
    for (const item of body) {
        if (typeof item !== "object" || item === null) {
            continue;
        }
        const row = item as Record<string, unknown>;
        if (
            typeof row.agent_id !== "number" ||
            typeof row.start_date !== "string" ||
            typeof row.end_date !== "string"
        ) {
            continue;
        }
        out.push({
            id: typeof row.id === "number" ? row.id : 0,
            agent_id: row.agent_id,
            start_date: row.start_date,
            end_date: row.end_date,
            allday: row.allday === true,
        });
    }
    return out;
}

function toWorkerAgents(body: unknown): WorkerAgent[] {
    if (!Array.isArray(body)) {
        return [];
    }
    const out: WorkerAgent[] = [];
    for (const item of body) {
        if (typeof item !== "object" || item === null) {
            continue;
        }
        const row = item as Record<string, unknown>;
        if (typeof row.id !== "number" || typeof row.name !== "string") {
            continue;
        }
        out.push({ id: row.id, name: row.name });
    }
    return out;
}

export function createHaloClient(options: HaloClientOptions): HaloClient {
    const resourceServer = stripTrailingSlash(options.resourceServer);
    const authServer = stripTrailingSlash(options.authServer);
    const { fetchImpl, clientId } = options;

    return {
        async getTicket(accessToken: string, ticketId: number): Promise<unknown> {
            const response = await fetchImpl(`${resourceServer}/api/Tickets/${ticketId}`, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (!response.ok) {
                throw new HaloApiError(
                    response.status,
                    `Halo getTicket failed: ${response.status}`,
                );
            }
            return (await response.json()) as unknown;
        },

        async refreshTokenPair(pair: HaloTokenPair): Promise<HaloTokenPair> {
            const response = await fetchImpl(`${authServer}/token`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    grant_type: "refresh_token",
                    client_id: clientId,
                    refresh_token: pair.refresh_token,
                    scope: "all:standard offline_access",
                }),
            });
            if (!response.ok) {
                throw new HaloApiError(
                    response.status,
                    `Halo token refresh failed: ${response.status}`,
                );
            }
            const refreshed = (await response.json()) as HaloTokenPair;
            // Some providers omit refresh_token on refresh; keep the old one.
            return {
                ...refreshed,
                refresh_token: refreshed.refresh_token || pair.refresh_token,
                obtained_at: Date.now(),
            };
        },

        async getAppointments(accessToken, args): Promise<WorkerAppointment[]> {
            // Same params the SPA calendar sends (see getAppointments in
            // src/services/halo-api.ts); keep the two in sync.
            const agentIds = args.agentIds.join(",");
            const params = new URLSearchParams({
                selectedAgents: agentIds,
                selectedStatuses: "0,1",
                alllocations: "true",
                showholidays: "true",
                showappointments: "true",
                showchanges: "true",
                workhoursonly: "true",
                showprojects: "true",
                isrecurringmaster: "false",
                showtasks: "false",
                showscheduledtickets: "true",
                utcoffset: String(args.utcOffset ?? 0),
                start_date: args.startDate,
                end_date: args.endDate,
                agents: agentIds,
                appointmentsonly: "true",
                excluderecurringmaster: "true",
                showshifts: "false",
            });
            const response = await fetchImpl(`${resourceServer}/api/Appointment?${params}`, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (!response.ok) {
                throw new HaloApiError(
                    response.status,
                    `Halo getAppointments failed: ${response.status}`,
                );
            }
            return toWorkerAppointments((await response.json()) as unknown);
        },

        async getAgents(accessToken): Promise<WorkerAgent[]> {
            // Same flags as the SPA getAgents defaults.
            const params = new URLSearchParams({
                reassign: "true",
                basic_fields_only: "true",
            });
            const response = await fetchImpl(`${resourceServer}/api/agent?${params}`, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (!response.ok) {
                throw new HaloApiError(
                    response.status,
                    `Halo getAgents failed: ${response.status}`,
                );
            }
            return toWorkerAgents((await response.json()) as unknown);
        },

        async createAppointment(accessToken, payload): Promise<number> {
            const response = await fetchImpl(`${resourceServer}/api/appointment`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify([payload]),
            });
            if (!response.ok) {
                throw new HaloApiError(
                    response.status,
                    `Halo createAppointment failed: ${response.status}`,
                );
            }
            const body = (await response.json()) as unknown;
            const id =
                Array.isArray(body) &&
                typeof body[0] === "object" &&
                body[0] !== null &&
                typeof (body[0] as Record<string, unknown>).id === "number"
                    ? ((body[0] as Record<string, unknown>).id as number)
                    : NaN;
            if (!Number.isInteger(id)) {
                throw new HaloApiError(502, "Halo createAppointment returned no appointment id");
            }
            return id;
        },
    };
}

/**
 * Booking guard built on the shared capacity rules: true when the agent has
 * no bookable time left on `date` (fully scheduled working day).
 */
export function isAgentOverbooked(agent: Agent, appointments: Appointment[], date: Date): boolean {
    const day = dayUtilization(agent, appointments, date);
    return day.isWorkingDay && day.percentage >= 100;
}

export { dayUtilization, weekUtilization };
export type { Agent, Appointment };
