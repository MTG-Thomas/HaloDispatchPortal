import type { StateCreator } from "zustand";
import { refreshToken, logout } from "@/services/auth/authService";
import { getClientCache, getTeams } from "@/services/halo-api";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useConfigStore } from "@/stores/configStore";
import {
    DEFAULT_AGENT_COLOUR,
    DEFAULT_WORKDAY_END,
    DEFAULT_WORKDAY_START,
    teamColourForSequence,
} from "@/lib/constants";
import { logger } from "@/lib/logger";
import type { Agent, Team, DaySchedule } from "@/types";
import type { ClientCache } from "@/types/halo";
import type { DispatchState } from "../useDispatchStore";

export interface ReferenceSlice {
    agents: Agent[];
    teams: Team[];
    clientCache: ClientCache | null;
    clientCacheLoading: boolean;
    clientCacheError: string | null;
    loadClientCacheInternal: (cache: ClientCache) => Promise<void>;
    loadClientCache: () => Promise<void>;
    getVisibleAgents: () => Agent[];
}

export const createReferenceSlice: StateCreator<
    DispatchState,
    [],
    [],
    ReferenceSlice
> = (set, get) => ({
    agents: [],
    teams: [],
    clientCache: null,
    clientCacheLoading: false,
    clientCacheError: null,

    loadClientCacheInternal: async (cache: ClientCache) => {
        // Map Halo agents to Agent type
        const agents = cache.agents
            .filter((a) => !a.isdisabled && !a.isapiagent)
            .map((haloAgent): Agent => {
                // Generate default working hours (9-5, Monday-Friday)
                const standardSchedule: DaySchedule = {
                    isWorking: true,
                    startTime: DEFAULT_WORKDAY_START,
                    endTime: DEFAULT_WORKDAY_END,
                };
                const weekendSchedule: DaySchedule = {
                    isWorking: false,
                    startTime: DEFAULT_WORKDAY_START,
                    endTime: DEFAULT_WORKDAY_END,
                };

                return {
                    id: haloAgent.id,
                    name: haloAgent.name,
                    email: haloAgent.email,
                    avatar: haloAgent.agentphotopath,
                    initials: haloAgent.initials || "",
                    role: haloAgent.jobtitle || "Agent",
                    teamIds: [], // Will be filled after teams are created
                    skills: [],
                    workingHours: {
                        monday: standardSchedule,
                        tuesday: standardSchedule,
                        wednesday: standardSchedule,
                        thursday: standardSchedule,
                        friday: standardSchedule,
                        saturday: weekendSchedule,
                        sunday: weekendSchedule,
                    },
                    isActive: !haloAgent.isdisabled,
                    color: haloAgent.colour || DEFAULT_AGENT_COLOUR,
                };
            });

        // Fetch teams from API
        const haloTeams = await getTeams();

        // Create map of team name to member IDs from agents
        const teamMemberMap = new Map<string, Set<number>>();
        cache.agents
            .filter((a) => !a.isdisabled && !a.isapiagent && a.team)
            .forEach((agent) => {
                const teamName = agent.team;
                if (!teamMemberMap.has(teamName)) {
                    teamMemberMap.set(teamName, new Set());
                }
                teamMemberMap.get(teamName)!.add(agent.id);
            });

        // Map Halo teams to our Team interface
        const teams: Team[] = haloTeams
            .map((haloTeam) => {
                // Generate stable team ID from team name (slugify)
                const teamId = `team-${haloTeam.name
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-|-$/g, "")}`;

                return {
                    id: teamId,
                    name: haloTeam.name,
                    memberIds: Array.from(
                        teamMemberMap.get(haloTeam.name) || []
                    ),
                    color: teamColourForSequence(haloTeam.sequence),
                    isActive: !haloTeam.inactive,
                    sequence: haloTeam.sequence,
                };
            })
            .sort((a, b) => a.sequence - b.sequence); // Sort by sequence

        // Update agents with their team IDs
        const teamByName = new Map(teams.map((t) => [t.name, t.id]));
        agents.forEach((agent) => {
            const haloAgent = cache.agents.find((a) => a.id === agent.id);
            if (haloAgent?.team && teamByName.has(haloAgent.team)) {
                agent.teamIds = [teamByName.get(haloAgent.team)!];
            }
        });

        // Auto-select all agents if no agents are currently selected
        const { selectedResources, setSelectedResources } =
            usePreferencesStore.getState();
        if (selectedResources.length === 0 && agents.length > 0) {
            const allAgentSelections = agents.map((agent) => ({
                type: "agent" as const,
                id: agent.id.toString(), // Convert to string for ResourceSelection
            }));
            setSelectedResources(allAgentSelections);
        }

        set({
            clientCache: cache,
            clientCacheLoading: false,
            agents,
            teams,
        });
    },

    loadClientCache: async () => {
        set({ clientCacheLoading: true, clientCacheError: null });
        try {
            const cache = await getClientCache();

            // Validate cache has required data (agents array means we're authorized)
            if (!cache || !cache.agents || !Array.isArray(cache.agents)) {
                logger.error(
                    "Invalid ClientCache response (no agents - token likely expired):",
                    cache
                );

                // Token is likely expired/invalid. Try to refresh it.
                const { config } = useConfigStore.getState();

                const refreshSuccess = await refreshToken({
                    authServer: config.authServer,
                    clientId: config.clientId,
                    redirectUri: config.redirectUri,
                });

                if (refreshSuccess) {
                    // Retry loading ClientCache with new token
                    const retryCache = await getClientCache();

                    if (
                        !retryCache ||
                        !retryCache.agents ||
                        !Array.isArray(retryCache.agents)
                    ) {
                        // Still no agents after refresh - clear tokens and force re-login
                        logger.error(
                            "ClientCache still invalid after token refresh, forcing re-login"
                        );
                        logout();
                        return;
                    }

                    // Success! Continue with the retry cache
                    return await get().loadClientCacheInternal(retryCache);
                } else {
                    // Token refresh failed - clear tokens and force re-login
                    logger.error("Token refresh failed, forcing re-login");
                    logout();
                    return;
                }
            }

            // Process the valid cache
            await get().loadClientCacheInternal(cache);
        } catch (error) {
            logger.error("Failed to load client cache:", error);
            set({
                clientCacheError:
                    error instanceof Error
                        ? error.message
                        : "Failed to load client cache",
                clientCacheLoading: false,
            });
        }
    },

    getVisibleAgents: () => {
        const state = get();
        // Read selectedResources from preferences store
        const { selectedResources } = usePreferencesStore.getState();
        const selectedAgentIds = new Set<number>();

        selectedResources.forEach((resource) => {
            if (resource.type === "agent") {
                // resource.id is string but should be parseable to number
                const agentId =
                    typeof resource.id === "string"
                        ? parseInt(resource.id.replace("agent-", ""))
                        : resource.id;
                selectedAgentIds.add(agentId);
            } else if (resource.type === "team") {
                const team = state.teams.find((t) => t.id === resource.id);
                if (team) {
                    team.memberIds.forEach((agentId) =>
                        selectedAgentIds.add(agentId)
                    );
                }
            }
        });

        return state.agents.filter((agent) => selectedAgentIds.has(agent.id));
    },
});
