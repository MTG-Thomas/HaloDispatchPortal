import { useState, useEffect, useMemo } from 'react';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { getAgents } from '@/services/halo-api';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { useConfigStore } from '@/stores/configStore';
import { AgentAvatar } from '@/components/AgentAvatar';
import type { HaloAgent } from '@/types/halo';
import type { Agent } from '@/types';

interface AgentComboboxProps {
  value: number | null;
  onValueChange: (agentId: number | null) => void;
  teamFilter?: string; // Optional team filter for triage section
  clientId?: number;
  ticketTypeId?: number;
  placeholder?: string;
  error?: string;
}

/**
 * AgentCombobox Component
 *
 * Searchable combobox for selecting an agent
 * Supports optional filtering by team (for triage)
 * Color-coded by agent.colour
 * Shows agent name and initials
 *
 * Handles edge case where ticket has an agent that doesn't match current filters
 * (e.g., agent from different team) - displays it as selected but won't show in dropdown
 */
export function AgentCombobox({
  value,
  onValueChange,
  teamFilter,
  clientId,
  ticketTypeId,
  placeholder = 'Select agent...',
  error,
}: AgentComboboxProps) {
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<HaloAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const { clientCache } = useDispatchStore();
  const { config } = useConfigStore();

  // Helper function to convert HaloAgent to Agent for AgentAvatar
  const convertToAgent = (haloAgent: HaloAgent): Agent => ({
    id: haloAgent.id,
    name: haloAgent.name,
    email: haloAgent.email,
    initials: haloAgent.initials,
    color: haloAgent.colour,
    avatar: haloAgent.agentphotopath,
    role: haloAgent.jobtitle || '',
    teamIds: [], // Not needed for avatar display
    skills: [],
    workingHours: {
      monday: { isWorking: false, startTime: '00:00', endTime: '00:00' },
      tuesday: { isWorking: false, startTime: '00:00', endTime: '00:00' },
      wednesday: { isWorking: false, startTime: '00:00', endTime: '00:00' },
      thursday: { isWorking: false, startTime: '00:00', endTime: '00:00' },
      friday: { isWorking: false, startTime: '00:00', endTime: '00:00' },
      saturday: { isWorking: false, startTime: '00:00', endTime: '00:00' },
      sunday: { isWorking: false, startTime: '00:00', endTime: '00:00' },
    },
    isActive: !haloAgent.isdisabled,
  });

  // Load agents when component mounts or filters change
  useEffect(() => {
    const loadAgents = async () => {
      setLoading(true);
      try {
        const result = await getAgents({
          team: teamFilter,
          client_id: clientId,
          tickettype_id: ticketTypeId,
        });
        // Filter out disabled and API agents
        setAgents(result.filter((agent) => !agent.isdisabled && !agent.isapiagent));
      } catch (error) {
        console.error('Failed to load agents:', error);
        setAgents([]);
      } finally {
        setLoading(false);
      }
    };

    loadAgents();
  }, [teamFilter, clientId, ticketTypeId]);

  const handleSelect = (agentId: number) => {
    onValueChange(agentId);
    setOpen(false);
  };

  // Filter agents based on search
  const filteredAgents = agents.filter((agent) =>
    agent.name.toLowerCase().includes(searchValue.toLowerCase())
  );

  // Find selected agent - first check filtered list, then fall back to clientCache
  // This handles the edge case where a ticket has an agent that doesn't match current filters
  const selectedAgent =
    agents.find((agent) => agent.id === value) ||
    clientCache?.agents.find((agent) => agent.id === value);

  // Convert selected agent to Agent type for AgentAvatar
  const selectedAgentForAvatar = useMemo(() => {
    return selectedAgent ? convertToAgent(selectedAgent) : null;
  }, [selectedAgent]);

  return (
    <div className="space-y-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              'w-full justify-between',
              !value && 'text-muted-foreground',
              error && 'border-red-500'
            )}
          >
            {selectedAgentForAvatar ? (
              <AgentAvatar
                agent={selectedAgentForAvatar}
                size="sm"
                showName
                resourceServer={config.resourceServer}
              />
            ) : (
              <span>{placeholder}</span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[350px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search agents..."
              value={searchValue}
              onValueChange={setSearchValue}
            />
            <CommandList>
              {loading && (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="ml-2 text-sm text-muted-foreground">
                    Loading agents...
                  </span>
                </div>
              )}
              {!loading && agents.length === 0 && (
                <CommandEmpty>No agents found</CommandEmpty>
              )}
              {!loading && filteredAgents.length === 0 && agents.length > 0 && (
                <CommandEmpty>No agents match your search</CommandEmpty>
              )}
              {!loading && filteredAgents.length > 0 && (
                <CommandGroup>
                  {filteredAgents.map((agent) => {
                    const agentForAvatar = convertToAgent(agent);
                    return (
                      <CommandItem
                        key={agent.id}
                        value={agent.id.toString()}
                        onSelect={() => handleSelect(agent.id)}
                      >
                        <Check
                          className={cn(
                            'mr-2 h-4 w-4',
                            value === agent.id ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        <div className="flex items-center gap-2">
                          <AgentAvatar
                            agent={agentForAvatar}
                            size="sm"
                            resourceServer={config.resourceServer}
                          />
                          <div className="flex flex-col">
                            <span className="font-medium">{agent.name}</span>
                            {agent.jobtitle && (
                              <span className="text-xs text-muted-foreground">
                                {agent.jobtitle}
                              </span>
                            )}
                          </div>
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
