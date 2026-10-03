import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useDispatchStore } from '@/stores/useDispatchStore';
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
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * ListCombobox Component
 *
 * Combobox for selecting ticket lists organized by groups
 * Supports multi-selection of lists
 */
export function ListCombobox() {
  const {
    viewLists,
    selectedListIds,
    viewListsLoading,
    viewListsError,
    toggleListSelection,
    selectLists,
  } = useDispatchStore();

  const [open, setOpen] = useState(false);

  // Group lists by group_name
  const groupedLists = viewLists.reduce((acc, list) => {
    const groupName = list.group_name || 'Other';
    if (!acc[groupName]) {
      acc[groupName] = {
        id: list.group,
        name: groupName,
        sequence: list.group_seq,
        lists: [],
      };
    }
    acc[groupName].lists.push(list);
    return acc;
  }, {} as Record<string, { id: number; name: string; sequence: number; lists: typeof viewLists }>);

  // Sort groups by sequence and convert to array
  const groups = Object.values(groupedLists).sort((a, b) => a.sequence - b.sequence);

  // Selection is persisted by the dispatch store; DispatchView validates the
  // persisted ids against loaded view lists. This combobox only mutates.

  const handleListToggle = (listId: number) => {
    toggleListSelection(listId);
  };

  const handleSelectAll = () => {
    const allListIds = viewLists.map((list) => list.id);
    selectLists(allListIds);
  };

  const handleClear = () => {
    selectLists([]);
  };

  const getButtonText = () => {
    if (selectedListIds.length === 0) {
      return 'Select lists...';
    }
    if (selectedListIds.length === 1) {
      const list = viewLists.find((l) => l.id === selectedListIds[0]);
      return list?.name || 'Select lists...';
    }
    return `${selectedListIds.length} lists selected`;
  };

  if (viewListsLoading) {
    return (
      <div className="flex items-center gap-2">
        <div className="text-sm text-muted-foreground">Loading lists...</div>
      </div>
    );
  }

  if (viewListsError) {
    return (
      <div className="text-sm text-destructive">
        Failed to load lists
      </div>
    );
  }

  if (groups.length === 0) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[300px] justify-between"
        >
          {getButtonText()}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search lists..." />
          <CommandList>
            <CommandEmpty>No lists found.</CommandEmpty>

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

            {/* List Groups */}
            {groups.map((group) => (
              <CommandGroup key={group.name} heading={group.name}>
                {group.lists.map((list) => (
                  <CommandItem
                    key={list.id}
                    value={`${list.name}-${list.id}`}
                    onSelect={() => handleListToggle(list.id)}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        selectedListIds.includes(list.id) ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <div className="flex items-center justify-between flex-1 gap-2">
                      <span>{list.name}</span>
                      <Badge variant="secondary" className="text-xs">
                        {list.ticket_count}
                      </Badge>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
