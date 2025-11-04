import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { cn } from '@/lib/utils';

/**
 * RefreshButton Component
 *
 * Manual refresh button with auto-refresh toggle and countdown timer
 * Shows last refresh time and seconds until next auto-refresh
 */
export function RefreshButton() {
  const {
    refreshTickets,
    ticketsLoading,
    lastRefreshTime,
    autoRefreshEnabled,
    autoRefreshInterval,
    toggleAutoRefresh,
    selectedListIds,
  } = useDispatchStore();

  const [countdown, setCountdown] = useState<number>(0);

  // Calculate countdown and trigger auto-refresh
  useEffect(() => {
    if (!autoRefreshEnabled || selectedListIds.length === 0) {
      setCountdown(0);
      return;
    }

    // Calculate time until next refresh
    const updateCountdown = () => {
      if (!lastRefreshTime) {
        setCountdown(Math.floor(autoRefreshInterval / 1000));
        return;
      }

      const elapsed = Date.now() - lastRefreshTime.getTime();
      const remaining = autoRefreshInterval - elapsed;

      if (remaining <= 0) {
        // Time to refresh
        refreshTickets();
        setCountdown(Math.floor(autoRefreshInterval / 1000));
      } else {
        setCountdown(Math.floor(remaining / 1000));
      }
    };

    // Initial countdown calculation
    updateCountdown();

    // Update countdown every second
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [autoRefreshEnabled, lastRefreshTime, autoRefreshInterval, refreshTickets, selectedListIds.length]);

  const handleManualRefresh = async () => {
    if (ticketsLoading) return;
    await refreshTickets();
  };

  // Don't show if no lists are selected
  if (selectedListIds.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-3">
      {/* Last Refresh Time */}
      {lastRefreshTime && (
        <span className="text-xs text-muted-foreground">
          Last refreshed {formatDistanceToNow(lastRefreshTime, { addSuffix: true })}
        </span>
      )}

      {/* Auto-refresh Toggle */}
      <div className="flex items-center gap-2">
        <Switch
          id="auto-refresh"
          checked={autoRefreshEnabled}
          onCheckedChange={toggleAutoRefresh}
          disabled={ticketsLoading}
        />
        <Label
          htmlFor="auto-refresh"
          className="text-xs font-normal cursor-pointer flex items-center gap-1"
        >
          Auto-refresh
          {autoRefreshEnabled && countdown > 0 && (
            <span className="text-muted-foreground">
              ({countdown}s)
            </span>
          )}
        </Label>
      </div>

      {/* Manual Refresh Button */}
      <Button
        variant="outline"
        size="sm"
        onClick={handleManualRefresh}
        disabled={ticketsLoading}
        className="h-8"
      >
        <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', ticketsLoading && 'animate-spin')} />
        Refresh
      </Button>
    </div>
  );
}
