import { useEffect, useState } from 'react';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

/**
 * ListSelector Component
 *
 * Displays ticket lists organized by groups with tabs
 * Allows multi-selection of lists to merge their tickets in the ticket list view
 * Persists selected lists to localStorage
 */
export function ListSelector() {
  const {
    viewLists,
    selectedListIds,
    viewListsLoading,
    viewListsError,
    toggleListSelection,
  } = useDispatchStore();

  const [activeGroup, setActiveGroup] = useState<string>('');

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

  // Set active group to first group on mount
  useEffect(() => {
    if (groups.length > 0 && !activeGroup) {
      setActiveGroup(groups[0].name);
    }
  }, [groups, activeGroup]);

  // Restore selected lists from localStorage on mount
  useEffect(() => {
    if (viewLists.length > 0 && selectedListIds.length === 0) {
      const saved = localStorage.getItem('halo-selected-lists');
      if (saved) {
        try {
          const listIds: number[] = JSON.parse(saved);
          // Validate that saved list IDs still exist
          const validIds = listIds.filter((id) =>
            viewLists.some((list) => list.id === id)
          );
          if (validIds.length > 0) {
            validIds.forEach((id) => toggleListSelection(id));
          }
        } catch (error) {
          console.error('Failed to parse saved list selection:', error);
        }
      }
    }
  }, [viewLists, selectedListIds.length, toggleListSelection]);

  // Save selected lists to localStorage whenever they change
  useEffect(() => {
    if (selectedListIds.length > 0) {
      localStorage.setItem('halo-selected-lists', JSON.stringify(selectedListIds));
    }
  }, [selectedListIds]);

  const handleListToggle = (listId: number) => {
    toggleListSelection(listId);
  };

  if (viewListsLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading lists...</span>
      </div>
    );
  }

  if (viewListsError) {
    return (
      <div className="p-4 text-sm text-destructive">
        Failed to load lists: {viewListsError}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No ticket lists available. Please select a ticket area.
      </div>
    );
  }

  return (
    <div className="border-t bg-card">
      <Tabs value={activeGroup} onValueChange={setActiveGroup} className="w-full">
        <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0 h-auto">
          {groups.map((group) => (
            <TabsTrigger
              key={group.name}
              value={group.name}
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
            >
              {group.name}
              <Badge variant="secondary" className="ml-2">
                {group.lists.length}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>

        {groups.map((group) => (
          <TabsContent
            key={group.name}
            value={group.name}
            className="mt-0 p-4 space-y-2"
          >
            {group.lists.length === 0 ? (
              <p className="text-sm text-muted-foreground">No lists in this group</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {group.lists.map((list) => (
                  <div
                    key={list.id}
                    className="flex items-start space-x-2 p-3 rounded-md border hover:bg-accent/50 transition-colors"
                  >
                    <Checkbox
                      id={`list-${list.id}`}
                      checked={selectedListIds.includes(list.id)}
                      onCheckedChange={() => handleListToggle(list.id)}
                      className="mt-1"
                    />
                    <div className="flex-1 space-y-1">
                      <Label
                        htmlFor={`list-${list.id}`}
                        className="text-sm font-medium leading-none cursor-pointer"
                      >
                        {list.name}
                      </Label>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {list.ticket_count} tickets
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {selectedListIds.length > 0 && (
        <div className="px-4 py-2 border-t bg-muted/30">
          <p className="text-sm text-muted-foreground">
            {selectedListIds.length} list{selectedListIds.length !== 1 ? 's' : ''} selected
          </p>
        </div>
      )}
    </div>
  );
}
