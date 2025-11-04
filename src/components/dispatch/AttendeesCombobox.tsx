import { useState, useEffect, type KeyboardEvent } from 'react';
import { X, Loader2 } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { searchUsers } from '@/services/halo-api';
import type { HaloUser } from '@/types/halo';

interface AttendeesComboboxProps {
  value: string; // Comma-separated email addresses
  onValueChange: (emails: string) => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
}

/**
 * AttendeesCombobox Component
 *
 * Multi-select combobox for selecting user emails as attendees
 * Supports adhoc email addresses not in the user list
 * Displays emails as badges with remove buttons
 * Returns comma-separated list of email addresses
 */
export function AttendeesCombobox({
  value,
  onValueChange,
  placeholder = 'Add attendees...',
  error,
  disabled = false,
}: AttendeesComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<HaloUser[]>([]);
  const [loading, setLoading] = useState(false);

  // Parse comma-separated emails into array
  const selectedEmails = value
    ? value.split(',').map((email) => email.trim()).filter(Boolean)
    : [];

  // Debounced user search
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

  const addEmail = (email: string) => {
    if (!email || selectedEmails.includes(email)) {
      return;
    }
    const newEmails = [...selectedEmails, email];
    onValueChange(newEmails.join(','));
    setSearch('');
  };

  const removeEmail = (email: string) => {
    const newEmails = selectedEmails.filter((e) => e !== email);
    onValueChange(newEmails.join(','));
  };

  const handleUserSelect = (user: HaloUser) => {
    if (user.emailaddress) {
      addEmail(user.emailaddress);
    }
  };

  // Handle Enter key to add adhoc email
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && search.trim()) {
      e.preventDefault();
      // Simple email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (emailRegex.test(search.trim())) {
        addEmail(search.trim());
      }
    }
  };

  return (
    <div className="space-y-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              'w-full justify-start min-h-10 h-auto',
              selectedEmails.length === 0 && 'text-muted-foreground',
              error && 'border-red-500'
            )}
          >
            <div className="flex flex-wrap gap-1 w-full">
              {selectedEmails.length === 0 && <span>{placeholder}</span>}
              {selectedEmails.map((email) => (
                <Badge
                  key={email}
                  variant="secondary"
                  className="gap-1"
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  {email}
                  <button
                    type="button"
                    className="ml-1 rounded-full hover:bg-muted-foreground/20"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeEmail(email);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search users or type email..."
              value={search}
              onValueChange={setSearch}
              onKeyDown={handleKeyDown}
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
                <CommandEmpty>
                  Type at least 2 characters to search or enter an email
                </CommandEmpty>
              )}
              {!loading && search.length >= 2 && users.length === 0 && (
                <CommandEmpty>
                  No users found. Press Enter to add as adhoc email if valid.
                </CommandEmpty>
              )}
              {!loading && users.length > 0 && (
                <CommandGroup>
                  {users.map((user) => (
                    <CommandItem
                      key={user.id}
                      value={user.id.toString()}
                      onSelect={() => handleUserSelect(user)}
                      disabled={selectedEmails.includes(user.emailaddress)}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{user.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {user.emailaddress}
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
      {!error && (
        <p className="text-xs text-muted-foreground">
          Search users or type email address and press Enter
        </p>
      )}
    </div>
  );
}
