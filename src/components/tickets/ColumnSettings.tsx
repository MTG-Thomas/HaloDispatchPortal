import { useState } from 'react';
import { Settings, ChevronUp, ChevronDown, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { cn } from '@/lib/utils';

/**
 * ColumnSettings Component
 *
 * Allows users to reorder and show/hide table columns
 */
export function ColumnSettings() {
  const { ticketListColumns, reorderColumn, toggleColumnVisibility, resetColumns } = usePreferencesStore();
  const [open, setOpen] = useState(false);

  const handleMoveUp = (index: number) => {
    if (index > 1) { // Can't move above index 1 (first column is fixed)
      reorderColumn(index, index - 1);
    }
  };

  const handleMoveDown = (index: number) => {
    if (index < ticketListColumns.length - 1 && index > 0) { // First column is fixed
      reorderColumn(index, index + 1);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings className="h-4 w-4 mr-2" />
          Columns
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Column Settings</DialogTitle>
          <DialogDescription>
            Customize which columns to show and their order. The "List" column always stays first.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {ticketListColumns.map((column, index) => (
            <div
              key={column.id}
              className={cn(
                'flex items-center gap-2 p-2 rounded-md border bg-card',
                column.isFixed && 'opacity-60'
              )}
            >
              {/* Visibility Toggle */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleColumnVisibility(column.id)}
                disabled={column.isFixed}
                className="px-2"
              >
                {column.isVisible ? (
                  <Eye className="h-4 w-4" />
                ) : (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>

              {/* Column Label */}
              <div className="flex-1 text-sm font-medium">
                {column.label}
                {column.isFixed && (
                  <span className="text-xs text-muted-foreground ml-2">(fixed)</span>
                )}
              </div>

              {/* Reorder Buttons */}
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleMoveUp(index)}
                  disabled={column.isFixed || index === 1} // Can't move above first non-fixed position
                  className="px-2"
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleMoveDown(index)}
                  disabled={column.isFixed || index === ticketListColumns.length - 1}
                  className="px-2"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-between pt-4 border-t">
          <Button variant="outline" onClick={resetColumns}>
            Reset to Default
          </Button>
          <Button onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
