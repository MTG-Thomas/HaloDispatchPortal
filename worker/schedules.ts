/**
 * Per-agent working-hours directory for the slot engine.
 *
 * Halo source (verified, no invented fields): full `/api/agent` rows carry
 * `workhour_start` / `workhour_end` as fractional hours (see `HaloAgent` in
 * `src/types/halo.ts` and the singular `agent` in
 * `api_responses/1_ClientCache.json`). The ClientCache `agents[]` directory
 * carries no schedule (its fixture entries have no workhour fields), and the
 * repo uses no dedicated working-hours endpoint, so the Worker fetches the
 * full agent directory instead. `workday_id` is left unresolved (no workday
 * lookup shape is verified anywhere in the repo), so Mon-Fri still applies.
 *
 * The directory is cached tenant-wide in KV for one hour; every consumer
 * treats a missing cache/fetch as "no schedules" and the slot engine falls
 * back to the 09:00-17:00 defaults per agent.
 */

import type { KeyValueClient } from "./kv";
import type { WorkerAgent } from "./halo";
import type { AgentSchedule } from "./slots";

export const AGENT_DIRECTORY_CACHE_KEY = "book:agent-directory:v1";
export const AGENT_DIRECTORY_CACHE_TTL_SECONDS = 60 * 60;

interface CachedDirectory {
    fetchedAt: number;
    agents: WorkerAgent[];
}

const DAY_MINUTES = 24 * 60;

/**
 * Convert one agent row to a slot-engine schedule. Returns null when Halo
 * omitted the bounds or they are unusable — the caller omits the agent and
 * the slot engine falls back to the defaults.
 */
export function toAgentSchedule(agent: WorkerAgent): AgentSchedule | null {
    const { workhourStart, workhourEnd } = agent;
    if (typeof workhourStart !== "number" || typeof workhourEnd !== "number") {
        return null;
    }
    if (!Number.isFinite(workhourStart) || !Number.isFinite(workhourEnd)) {
        return null;
    }
    const startMin = Math.round(workhourStart * 60);
    const endMin = Math.round(workhourEnd * 60);
    if (!(startMin >= 0 && endMin <= DAY_MINUTES && endMin > startMin)) {
        return null;
    }
    return { agentId: agent.id, startMin, endMin };
}

/** Convert a directory, silently dropping agents without usable bounds. */
export function toAgentSchedules(agents: WorkerAgent[]): AgentSchedule[] {
    const out: AgentSchedule[] = [];
    for (const agent of agents) {
        const schedule = toAgentSchedule(agent);
        if (schedule) {
            out.push(schedule);
        }
    }
    return out;
}

function parseCachedDirectory(raw: string | null): CachedDirectory | null {
    if (raw === null) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw) as CachedDirectory;
        if (typeof parsed?.fetchedAt !== "number" || !Array.isArray(parsed.agents)) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export interface AgentDirectoryOptions {
    nowMs: number;
    fetchAgents: () => Promise<WorkerAgent[]>;
}

/**
 * Tenant-wide cached agent directory. Fresh cache wins; otherwise fetch and
 * re-cache (best-effort write). Never throws: a failed fetch returns the
 * stale cache when present, else null — callers fall back to defaults.
 */
export async function getAgentDirectory(
    kv: KeyValueClient,
    options: AgentDirectoryOptions,
): Promise<WorkerAgent[] | null> {
    let cached: CachedDirectory | null = null;
    try {
        cached = parseCachedDirectory(await kv.get(AGENT_DIRECTORY_CACHE_KEY));
    } catch {
        cached = null;
    }
    if (
        cached &&
        Number.isFinite(cached.fetchedAt) &&
        options.nowMs - cached.fetchedAt < AGENT_DIRECTORY_CACHE_TTL_SECONDS * 1000
    ) {
        return cached.agents;
    }
    let fresh: WorkerAgent[];
    try {
        fresh = await options.fetchAgents();
    } catch {
        return cached ? cached.agents : null;
    }
    try {
        const record: CachedDirectory = { fetchedAt: options.nowMs, agents: fresh };
        await kv.put(AGENT_DIRECTORY_CACHE_KEY, JSON.stringify(record), {
            expirationTtl: AGENT_DIRECTORY_CACHE_TTL_SECONDS,
        });
    } catch {
        // Best-effort: a failed write just means the next call refetches.
    }
    return fresh;
}
