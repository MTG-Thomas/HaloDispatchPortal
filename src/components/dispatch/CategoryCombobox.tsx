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
import { getCategories } from '@/services/halo-api';
import type { HaloCategory } from '@/types/halo';

interface CategoryComboboxProps {
  value: string;
  onValueChange: (categoryName: string) => void;
  ticketTypeId: number | null;
  clientId: number | null;
  placeholder?: string;
  error?: string;
}

/**
 * CategoryCombobox Component
 *
 * Searchable combobox for selecting a service category
 * Requires ticket type and client to be selected first
 * Shows helper text from category.note field
 */
export function CategoryCombobox({
  value,
  onValueChange,
  ticketTypeId,
  clientId,
  placeholder = 'Select category...',
  error,
}: CategoryComboboxProps) {
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<HaloCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchValue, setSearchValue] = useState('');

  // Load categories when ticket type and client are selected
  useEffect(() => {
    if (!ticketTypeId || !clientId) {
      setCategories([]);
      return;
    }

    const loadCategories = async () => {
      setLoading(true);
      try {
        const result = await getCategories({
          tickettype_id: ticketTypeId,
          client_id: clientId,
          type_id: 1, // Only fetch Service Categories
        });
        setCategories(result);
      } catch (error) {
        console.error('Failed to load categories:', error);
        setCategories([]);
      } finally {
        setLoading(false);
      }
    };

    loadCategories();
  }, [ticketTypeId, clientId]);

  const handleSelect = (categoryName: string) => {
    onValueChange(categoryName);
    setOpen(false);
  };

  // Filter categories based on search
  const filteredCategories = categories.filter((cat) =>
    cat.category_name.toLowerCase().includes(searchValue.toLowerCase())
  );

  const selectedCategory = categories.find((cat) => cat.category_name === value);
  const displayValue = value || placeholder;

  const isDisabled = !ticketTypeId || !clientId;

  return (
    <div className="space-y-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={isDisabled}
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
              placeholder="Search categories..."
              value={searchValue}
              onValueChange={setSearchValue}
            />
            <CommandList>
              {loading && (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="ml-2 text-sm text-muted-foreground">
                    Loading categories...
                  </span>
                </div>
              )}
              {!loading && categories.length === 0 && (
                <CommandEmpty>
                  {isDisabled
                    ? 'Select user and ticket type first'
                    : 'No categories found'}
                </CommandEmpty>
              )}
              {!loading && filteredCategories.length === 0 && categories.length > 0 && (
                <CommandEmpty>No categories match your search</CommandEmpty>
              )}
              {!loading && filteredCategories.length > 0 && (
                <CommandGroup>
                  {filteredCategories.map((category) => (
                    <CommandItem
                      key={category.id}
                      value={category.category_name}
                      onSelect={() => handleSelect(category.category_name)}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          value === category.category_name
                            ? 'opacity-100'
                            : 'opacity-0'
                        )}
                      />
                      <div className="flex flex-col">
                        <span className="font-medium">{category.category_name}</span>
                        {category.note && (
                          <span className="text-xs text-muted-foreground">
                            {category.note}
                          </span>
                        )}
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
      {selectedCategory?.note && !error && (
        <p className="text-xs text-muted-foreground">{selectedCategory.note}</p>
      )}
    </div>
  );
}
