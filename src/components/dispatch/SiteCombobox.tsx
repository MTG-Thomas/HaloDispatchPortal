import { useState, useEffect } from 'react';
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
import { getSites } from '@/services/halo-api';
import type { HaloSite } from '@/types/halo';

interface SiteComboboxProps {
  value: number | null;
  onValueChange: (siteId: number | null) => void;
  placeholder?: string;
  error?: string;
}

/**
 * SiteCombobox Component
 *
 * Searchable combobox for selecting a site (appointment location)
 * Displays: site_name with client_name/site_name on second line
 * Searches as user types with debounce
 */
export function SiteCombobox({
  value,
  onValueChange,
  placeholder = 'Select site...',
  error,
}: SiteComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sites, setSites] = useState<HaloSite[]>([]);
  const [loading, setLoading] = useState(false);

  // Debounced search
  useEffect(() => {
    if (!open) {
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await getSites({
          search: search || undefined,
          page_size: 100,
        });
        setSites(response.sites.filter((site) => !site.inactive));
      } catch (error) {
        console.error('Failed to search sites:', error);
        setSites([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [search, open]);

  const handleSelect = (siteId: number) => {
    onValueChange(siteId);
    setOpen(false);
  };

  const selectedSite = sites.find((site) => site.id === value);

  return (
    <div className="space-y-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              'w-full justify-between h-auto',
              !value && 'text-muted-foreground',
              error && 'border-red-500'
            )}
          >
            <div className="flex flex-col items-start text-left">
              {selectedSite ? (
                <>
                  <span className="font-medium">{selectedSite.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {selectedSite.clientsite_name}
                  </span>
                </>
              ) : (
                <span>{placeholder}</span>
              )}
            </div>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search sites..."
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
              {!loading && sites.length === 0 && (
                <CommandEmpty>No sites found</CommandEmpty>
              )}
              {!loading && sites.length > 0 && (
                <CommandGroup>
                  {sites.map((site) => (
                    <CommandItem
                      key={site.id}
                      value={site.id.toString()}
                      onSelect={() => handleSelect(site.id)}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          value === site.id ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <div className="flex flex-col">
                        <span className="font-medium">{site.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {site.clientsite_name}
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
