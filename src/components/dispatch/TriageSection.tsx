import { useState, useEffect, useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UserCombobox } from './UserCombobox';
import { CategoryCombobox } from './CategoryCombobox';
import { AgentCombobox } from './AgentCombobox';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { getTeams } from '@/services/halo-api';
import type { TriageFormData, HaloTeam, HaloUser } from '@/types/halo';

interface TriageSectionProps {
  formData: TriageFormData;
  onUpdate: (updates: Partial<TriageFormData>) => void;
  onUserSelect: (user: HaloUser | null) => void;
  getError: (section: 'triage' | 'dispatch', field: string) => string | undefined;
}

/**
 * TriageSection Component
 *
 * Left column of the triage/dispatch modal
 * Contains all fields needed to triage a ticket
 */
export function TriageSection({
  formData,
  onUpdate,
  onUserSelect,
  getError,
}: TriageSectionProps) {
  const { clientCache } = useDispatchStore();
  const [teams, setTeams] = useState<HaloTeam[]>([]);

  // Get impact and urgency options from clientCache lookups
  const impactOptions = useMemo(
    () => clientCache?.lookups?.filter((l) => l.lookupid === 12) || [],
    [clientCache]
  );

  const urgencyOptions = useMemo(
    () => clientCache?.lookups?.filter((l) => l.lookupid === 27) || [],
    [clientCache]
  );

  // Load teams
  useEffect(() => {
    const loadData = async () => {
      try {
        const teamsData = await getTeams({
          tickettype_id: formData.tickettype_id || undefined,
        });
        setTeams(teamsData);
      } catch (error) {
        console.error('Failed to load teams:', error);
      }
    };

    loadData();
  }, [formData.tickettype_id]);

  const ticketTypes = clientCache?.tickettypes.filter(
    (type) => type.cancreate && type.visible
  ) || [];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Triage</h3>
        <p className="text-sm text-muted-foreground">
          Fill out ticket details
        </p>
      </div>

      {/* User */}
      <div className="space-y-2">
        <Label htmlFor="user">
          User <span className="text-red-500">*</span>
        </Label>
        <UserCombobox
          value={formData.user}
          onValueChange={onUserSelect}
          error={getError('triage', 'user_id')}
        />
      </div>

      {/* Ticket Type */}
      <div className="space-y-2">
        <Label htmlFor="tickettype">
          Ticket Type <span className="text-red-500">*</span>
        </Label>
        <Select
          value={formData.tickettype_id?.toString() || ''}
          onValueChange={(value) =>
            onUpdate({ tickettype_id: parseInt(value) })
          }
        >
          <SelectTrigger
            className={getError('triage', 'tickettype_id') ? 'border-red-500' : ''}
          >
            <SelectValue placeholder="Select ticket type..." />
          </SelectTrigger>
          <SelectContent>
            {ticketTypes.map((type) => (
              <SelectItem key={type.id} value={type.id.toString()}>
                {type.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {getError('triage', 'tickettype_id') && (
          <p className="text-xs text-red-500">
            {getError('triage', 'tickettype_id')}
          </p>
        )}
      </div>

      {/* Summary */}
      <div className="space-y-2">
        <Label htmlFor="summary">
          Summary <span className="text-red-500">*</span>
        </Label>
        <Input
          id="summary"
          value={formData.summary}
          onChange={(e) => onUpdate({ summary: e.target.value })}
          placeholder="Enter ticket summary..."
          className={getError('triage', 'summary') ? 'border-red-500' : ''}
        />
        {getError('triage', 'summary') && (
          <p className="text-xs text-red-500">{getError('triage', 'summary')}</p>
        )}
      </div>

      {/* Impact and Urgency - Side by Side */}
      <div className="grid grid-cols-2 gap-4">
        {/* Impact */}
        <div className="space-y-2">
          <Label htmlFor="impact">Impact</Label>
          <Select
            value={formData.impact.toString()}
            onValueChange={(value) => onUpdate({ impact: parseInt(value) })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select impact..." />
            </SelectTrigger>
            <SelectContent>
              {impactOptions.map((option) => (
                <SelectItem key={option.id} value={option.id.toString()}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Urgency */}
        <div className="space-y-2">
          <Label htmlFor="urgency">Urgency</Label>
          <Select
            value={formData.urgency.toString()}
            onValueChange={(value) => onUpdate({ urgency: parseInt(value) })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select urgency..." />
            </SelectTrigger>
            <SelectContent>
              {urgencyOptions.map((option) => (
                <SelectItem key={option.id} value={option.id.toString()}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Service Category */}
      <div className="space-y-2">
        <Label htmlFor="category">Service Category</Label>
        <CategoryCombobox
          value={formData.category_1}
          onValueChange={(value) => onUpdate({ category_1: value })}
          ticketTypeId={formData.tickettype_id}
          clientId={formData.user?.client_id || null}
        />
      </div>

      {/* Team */}
      <div className="space-y-2">
        <Label htmlFor="team">Team</Label>
        <Select
          value={formData.team}
          onValueChange={(value) => onUpdate({ team: value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select team..." />
          </SelectTrigger>
          <SelectContent>
            {teams.map((team) => (
              <SelectItem key={team.id} value={team.name}>
                {team.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Agent */}
      <div className="space-y-2">
        <Label htmlFor="agent">Agent</Label>
        <AgentCombobox
          value={formData.agent_id}
          onValueChange={(value) => onUpdate({ agent_id: value || 1 })}
          teamFilter={formData.team || undefined}
          clientId={formData.user?.client_id}
          ticketTypeId={formData.tickettype_id || undefined}
        />
      </div>
    </div>
  );
}
