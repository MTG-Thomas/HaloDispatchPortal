import { useEffect } from 'react';
import { useDispatchStore } from '@/stores/useDispatchStore';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * TicketAreaSelector Component
 *
 * Allows users to select a ticket area (Service Desk, Projects, Changes, etc.)
 * Selection is persisted by the dispatch store; changing it automatically
 * loads view lists via the store action.
 */
export function TicketAreaSelector() {
  const {
    clientCache,
    selectedTicketAreaId,
    setSelectedTicketArea,
    loadClientCache,
    clientCacheLoading,
    clientCacheError,
    criticalApiError,
  } = useDispatchStore();

  // Load client cache on mount if not already loaded
  // Don't retry if there's an error - user must manually retry via ApiErrorPage
  useEffect(() => {
    if (!clientCache && !clientCacheLoading && !clientCacheError && !criticalApiError) {
      loadClientCache();
    }
  }, [clientCache, clientCacheLoading, clientCacheError, criticalApiError, loadClientCache]);

  const handleAreaChange = (value: string) => {
    const areaId = parseInt(value, 10);
    setSelectedTicketArea(areaId);
  };

  if (!clientCache || clientCache.ticketareas.length === 0) {
    return null;
  }

  return (
    <Select
      value={selectedTicketAreaId?.toString()}
      onValueChange={handleAreaChange}
    >
      <SelectTrigger id="ticket-area" className="w-[200px]">
        <SelectValue placeholder="Select ticket area..." />
      </SelectTrigger>
      <SelectContent>
        {clientCache.ticketareas.map((area) => (
          <SelectItem key={area.id} value={area.id.toString()}>
            {area.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
