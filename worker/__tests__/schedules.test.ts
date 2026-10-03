// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
    AGENT_DIRECTORY_CACHE_KEY,
    AGENT_DIRECTORY_CACHE_TTL_SECONDS,
    getAgentDirectory,
    toAgentSchedule,
    toAgentSchedules,
} from "../schedules";
import type { WorkerAgent } from "../halo";
import { fakeKv } from "./fake-kv";

const NOW = Date.parse("2026-10-05T08:00:00.000Z");

function agent(partial: Partial<WorkerAgent> = {}): WorkerAgent {
    return { id: 7, name: "Dana Dispatcher", ...partial };
}

describe("toAgentSchedule", () => {
    it("converts fractional Halo hours to minute bounds", () => {
        expect(toAgentSchedule(agent({ workhourStart: 9, workhourEnd: 17 }))).toEqual({
            agentId: 7,
            startMin: 540,
            endMin: 1020,
        });
        expect(toAgentSchedule(agent({ workhourStart: 9.5, workhourEnd: 16.25 }))).toEqual({
            agentId: 7,
            startMin: 570,
            endMin: 975,
        });
    });

    it("returns null when bounds are absent", () => {
        expect(toAgentSchedule(agent())).toBeNull();
        expect(toAgentSchedule(agent({ workhourStart: 9 }))).toBeNull();
        expect(toAgentSchedule(agent({ workhourEnd: 17 }))).toBeNull();
    });

    it("returns null for unusable bounds", () => {
        expect(toAgentSchedule(agent({ workhourStart: NaN, workhourEnd: 17 }))).toBeNull();
        expect(toAgentSchedule(agent({ workhourStart: 17, workhourEnd: 9 }))).toBeNull();
        expect(toAgentSchedule(agent({ workhourStart: 9, workhourEnd: 9 }))).toBeNull();
        expect(toAgentSchedule(agent({ workhourStart: -1, workhourEnd: 17 }))).toBeNull();
        expect(toAgentSchedule(agent({ workhourStart: 9, workhourEnd: 25 }))).toBeNull();
    });
});

describe("toAgentSchedules", () => {
    it("keeps usable agents and drops the rest", () => {
        expect(
            toAgentSchedules([
                agent({ id: 7, workhourStart: 10, workhourEnd: 12 }),
                agent({ id: 9 }),
            ]),
        ).toEqual([{ agentId: 7, startMin: 600, endMin: 720 }]);
    });
});

describe("getAgentDirectory", () => {
    it("fetches on a miss and caches the directory", async () => {
        const kv = fakeKv();
        const fetchAgents = vi.fn(async () => [agent()]);
        const directory = await getAgentDirectory(kv, { nowMs: NOW, fetchAgents });
        expect(directory).toEqual([agent()]);
        expect(fetchAgents).toHaveBeenCalledTimes(1);
        const raw = await kv.get(AGENT_DIRECTORY_CACHE_KEY);
        expect(raw).toBeTruthy();
        expect(JSON.parse(raw as string)).toEqual({ fetchedAt: NOW, agents: [agent()] });
    });

    it("serves a fresh cache without refetching", async () => {
        const kv = fakeKv({
            [AGENT_DIRECTORY_CACHE_KEY]: JSON.stringify({ fetchedAt: NOW, agents: [agent()] }),
        });
        const fetchAgents = vi.fn(async () => [agent({ id: 99, name: "New" })]);
        await expect(getAgentDirectory(kv, { nowMs: NOW + 1000, fetchAgents })).resolves.toEqual([
            agent(),
        ]);
        expect(fetchAgents).not.toHaveBeenCalled();
    });

    it("refetches once the cache goes stale", async () => {
        const kv = fakeKv({
            [AGENT_DIRECTORY_CACHE_KEY]: JSON.stringify({ fetchedAt: NOW, agents: [agent()] }),
        });
        const fresh = [agent({ id: 99, name: "New" })];
        const fetchAgents = vi.fn(async () => fresh);
        const staleAt = NOW + AGENT_DIRECTORY_CACHE_TTL_SECONDS * 1000;
        await expect(getAgentDirectory(kv, { nowMs: staleAt, fetchAgents })).resolves.toEqual(
            fresh,
        );
        expect(fetchAgents).toHaveBeenCalledTimes(1);
    });

    it("treats corrupt cache as a miss", async () => {
        const kv = fakeKv({ [AGENT_DIRECTORY_CACHE_KEY]: "{nope" });
        const fetchAgents = vi.fn(async () => [agent()]);
        await expect(getAgentDirectory(kv, { nowMs: NOW, fetchAgents })).resolves.toEqual([
            agent(),
        ]);
        expect(fetchAgents).toHaveBeenCalledTimes(1);
    });

    it("falls back to stale cache when the fetch fails", async () => {
        const kv = fakeKv({
            [AGENT_DIRECTORY_CACHE_KEY]: JSON.stringify({ fetchedAt: NOW, agents: [agent()] }),
        });
        const fetchAgents = vi.fn(async (): Promise<WorkerAgent[]> => {
            throw new Error("halo down");
        });
        const staleAt = NOW + AGENT_DIRECTORY_CACHE_TTL_SECONDS * 1000;
        await expect(getAgentDirectory(kv, { nowMs: staleAt, fetchAgents })).resolves.toEqual([
            agent(),
        ]);
    });

    it("returns null when the fetch fails with no cache", async () => {
        const kv = fakeKv();
        const fetchAgents = vi.fn(async (): Promise<WorkerAgent[]> => {
            throw new Error("halo down");
        });
        await expect(getAgentDirectory(kv, { nowMs: NOW, fetchAgents })).resolves.toBeNull();
    });
});
