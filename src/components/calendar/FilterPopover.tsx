import { useState } from 'react';
import { Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { TicketAreaSelector } from '@/components/halo/TicketAreaSelector';
import { ListCombobox } from '@/components/halo/ListCombobox';
import { AgentTeamCombobox } from './AgentTeamCombobox';
import { useDispatchStore } from '@/stores/useDispatchStore';

/**
 * FilterPopover Component
 *
 * Consolidated filter button that contains:
 * - Ticket Area selector
 * - List selector
 * - Agent/Team selector
 */
export function FilterPopover() {
  const [open, setOpen] = useState(false);
  const { selectedTicketAreaId } = useDispatchStore();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Filter">
          <Filter className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px]" align="start">
        <div className="space-y-4">
          {/* Ticket Area Selector */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-muted-foreground">
              Ticket Area
            </label>
            <div className="w-full [&>*]:w-full">
              <TicketAreaSelector />
            </div>
          </div>

          {/* List Selector */}
          {selectedTicketAreaId && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-muted-foreground">
                Lists
              </label>
              <div className="w-full [&>*]:w-full">
                <ListCombobox />
              </div>
            </div>
          )}

          {/* Agent/Team Selector */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-muted-foreground">
              Agents & Teams
            </label>
            <div className="w-full [&>*]:w-full">
              <AgentTeamCombobox />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
