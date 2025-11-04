import { Users, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { cn } from '@/lib/utils';

export function ResourceSelector() {
  const { agents, teams, getVisibleAgents } = useDispatchStore();
  const { selectedResources, toggleResourceSelection } = usePreferencesStore();

  const visibleAgents = getVisibleAgents();

  const isAgentSelected = (agentId: string) =>
    selectedResources.some((r) => r.type === 'agent' && r.id === agentId);

  const isTeamSelected = (teamId: string) =>
    selectedResources.some((r) => r.type === 'team' && r.id === teamId);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm font-medium text-muted-foreground">Resources:</span>

      {/* Agent Selector Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <User className="h-4 w-4 mr-2" />
            Agents ({visibleAgents.length})
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Select Agents</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {agents.map((agent) => (
            <DropdownMenuCheckboxItem
              key={agent.id}
              checked={isAgentSelected(agent.id)}
              onCheckedChange={() =>
                toggleResourceSelection({ type: 'agent', id: agent.id })
              }
            >
              <div className="flex items-center gap-2">
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: agent.color }}
                />
                <span>{agent.name}</span>
              </div>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Team Selector Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Users className="h-4 w-4 mr-2" />
            Teams
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Select Teams</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {teams.map((team) => (
            <DropdownMenuCheckboxItem
              key={team.id}
              checked={isTeamSelected(team.id)}
              onCheckedChange={() =>
                toggleResourceSelection({ type: 'team', id: team.id })
              }
            >
              <div className="flex items-center gap-2">
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: team.color }}
                />
                <span>{team.name}</span>
                <span className="text-xs text-muted-foreground">
                  ({team.memberIds.length} members)
                </span>
              </div>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Selected Agents Display */}
      {visibleAgents.map((agent) => (
        <Badge
          key={agent.id}
          variant="secondary"
          className={cn('gap-1.5 px-2 py-1')}
        >
          <div
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: agent.color }}
          />
          {agent.name}
        </Badge>
      ))}
    </div>
  );
}
