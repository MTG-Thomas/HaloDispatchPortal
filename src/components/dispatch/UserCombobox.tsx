import { useState, useEffect, useCallback } from 'react';
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
import { searchUsers } from '@/services/halo-api';
import type { HaloUser } from '@/types/halo';

interface UserComboboxProps {
  value: HaloUser | null;
  onValueChange: (user: HaloUser | null) => void;
  placeholder?: string;
  error?: string;
}

/**
 * UserCombobox Component
 *
 * Searchable combobox for selecting a user
 * Displays: name (client_name/site_name)
 * Searches as user types with debounce
 */
export function UserCombobox({
  value,
  onValueChange,
  placeholder = 'Select user...',
  error,
}: UserComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<HaloUser[]>([]);
  const [loading, setLoading] = useState(false);

  // Debounced search
  useEffect(() => {
    if (!open || search.length < 2) {
      setUsers([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await searchUsers({ search });
        setUsers(response.users);
      } catch (error) {
        console.error('Failed to search users:', error);
        setUsers([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [search, open]);

  const handleSelect = useCallback(
    (user: HaloUser) => {
      onValueChange(user);
      setOpen(false);
    },
    [onValueChange]
  );

  const displayValue = value
    ? `${value.name} (${value.client_name}/${value.site_name})`
    : placeholder;

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
            <span className="truncate">{displayValue}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search users..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {loading && (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="ml-2 text-sm text-muted-foreground">
                    Searching...
                  </span>
                </div>
              )}
              {!loading && search.length < 2 && (
                <CommandEmpty>Type at least 2 characters to search</CommandEmpty>
              )}
              {!loading && search.length >= 2 && users.length === 0 && (
                <CommandEmpty>No users found</CommandEmpty>
              )}
              {!loading && users.length > 0 && (
                <CommandGroup>
                  {users.map((user) => (
                    <CommandItem
                      key={user.id}
                      value={user.id.toString()}
                      onSelect={() => handleSelect(user)}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          value?.id === user.id ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <div className="flex flex-col">
                        <span className="font-medium">{user.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {user.client_name} / {user.site_name}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
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
