import { useState } from 'react';
import { Check, ChevronsUpDown, Users as UsersIcon } from 'lucide-react';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useConfigStore } from '@/stores/configStore';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { AgentAvatar } from '@/components/AgentAvatar';
import { cn } from '@/lib/utils';
import type { ResourceSelection } from '@/types';

/**
 * AgentTeamCombobox Component
 *
 * Combobox for selecting agents and teams
 * Selecting a team will select all agents in that team
 */
export function AgentTeamCombobox() {
  const { agents, teams } = useDispatchStore();
  const { config } = useConfigStore();
  const {
    selectedResources,
    addResourceSelection,
    removeResourceSelection,
    setSelectedResources,
  } = usePreferencesStore();

  const [open, setOpen] = useState(false);

  // Get selected agent IDs
  const selectedAgentIds = selectedResources
    .filter((r) => r.type === 'agent')
    .map((r) => r.id);

  // Get selected team IDs
  const selectedTeamIds = selectedResources
    .filter((r) => r.type === 'team')
    .map((r) => r.id);

  const handleAgentToggle = (agentId: number) => {
    const resource: ResourceSelection = { type: 'agent', id: agentId };
    if (selectedAgentIds.includes(agentId)) {
      removeResourceSelection(resource);
    } else {
      addResourceSelection(resource);
    }
  };

  const handleTeamToggle = (teamId: string) => {
    const team = teams.find((t) => t.id === teamId);
    if (!team) return;

    // If team is selected, deselect all its agents
    if (selectedTeamIds.includes(teamId)) {
      // Remove team
      removeResourceSelection({ type: 'team', id: teamId });
      // Remove all agents in this team
      team.memberIds.forEach((agentId) => {
        if (selectedAgentIds.includes(agentId)) {
          removeResourceSelection({ type: 'agent', id: agentId });
        }
      });
    } else {
      // Select team and all its agents
      addResourceSelection({ type: 'team', id: teamId });
      team.memberIds.forEach((agentId) => {
        if (!selectedAgentIds.includes(agentId)) {
          addResourceSelection({ type: 'agent', id: agentId });
        }
      });
    }
  };

  const handleSelectAll = () => {
    const allResources: ResourceSelection[] = [
      ...agents.filter((a) => a.isActive).map((a) => ({ type: 'agent' as const, id: a.id })),
      ...teams.filter((t) => t.isActive).map((t) => ({ type: 'team' as const, id: t.id })),
    ];
    setSelectedResources(allResources);
  };

  const handleClear = () => {
    setSelectedResources([]);
  };

  const getButtonText = () => {
    const agentCount = selectedAgentIds.length;
    const teamCount = selectedTeamIds.length;

    if (agentCount === 0 && teamCount === 0) {
      return 'Select agents/teams...';
    }

    const parts: string[] = [];
    if (agentCount > 0) {
      parts.push(`${agentCount} agent${agentCount !== 1 ? 's' : ''}`);
    }
    if (teamCount > 0) {
      parts.push(`${teamCount} team${teamCount !== 1 ? 's' : ''}`);
    }

    return parts.join(', ');
  };

  // Get active agents and teams, sorted appropriately
  const activeAgents = agents.filter((a) => a.isActive);
  const activeTeams = teams
    .filter((t) => t.isActive)
    .sort((a, b) => a.sequence - b.sequence); // Sort by sequence

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[280px] justify-between"
        >
          <div className="flex items-center gap-2">
            <UsersIcon className="h-4 w-4" />
            <span className="truncate">{getButtonText()}</span>
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search agents/teams..." />
          <CommandList>
            <CommandEmpty>No agents or teams found.</CommandEmpty>

            {/* Quick Actions */}
            <CommandGroup heading="Quick Actions">
              <CommandItem onSelect={handleSelectAll}>
                <Check className="mr-2 h-4 w-4 opacity-0" />
                Select All
              </CommandItem>
              <CommandItem onSelect={handleClear}>
                <Check className="mr-2 h-4 w-4 opacity-0" />
                Clear Selection
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            {/* Teams */}
            {activeTeams.length > 0 && (
              <>
                <CommandGroup heading="Teams">
                  {activeTeams.map((team) => (
                    <CommandItem
                      key={team.id}
                      value={`team-${team.name}`}
                      onSelect={() => handleTeamToggle(team.id)}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          selectedTeamIds.includes(team.id) ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: team.color }}
                        />
                        <span>{team.name}</span>
                        <span className="text-xs text-muted-foreground ml-auto">
                          ({team.memberIds.length})
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}

            {/* Agents */}
            <CommandGroup heading="Agents">
              {activeAgents.map((agent) => (
                <CommandItem
                  key={agent.id}
                  value={`agent-${agent.name}`}
                  onSelect={() => handleAgentToggle(agent.id)}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      selectedAgentIds.includes(agent.id) ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <AgentAvatar
                    agent={agent}
                    size="xs"
                    showName
                    resourceServer={config.resourceServer}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
