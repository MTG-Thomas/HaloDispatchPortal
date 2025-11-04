import { useEffect } from 'react';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { LoadingScreen } from '@/components/LoadingScreen';
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
 * Persists selection to localStorage and automatically loads view lists on change
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

  // Restore saved ticket area from localStorage on mount
  useEffect(() => {
    if (clientCache && !selectedTicketAreaId) {
      const saved = localStorage.getItem('halo-selected-ticket-area');
      if (saved) {
        const areaId = parseInt(saved, 10);
        const area = clientCache.ticketareas.find((a) => a.id === areaId);
        if (area) {
          setSelectedTicketArea(areaId);
        }
      } else if (clientCache.ticketareas.length > 0) {
        // Auto-select first area if none saved
        setSelectedTicketArea(clientCache.ticketareas[0].id);
      }
    }
  }, [clientCache, selectedTicketAreaId, setSelectedTicketArea]);

  const handleAreaChange = (value: string) => {
    const areaId = parseInt(value, 10);
    setSelectedTicketArea(areaId);
    localStorage.setItem('halo-selected-ticket-area', value);
  };

  if (clientCacheLoading) {
    return <LoadingScreen message="Loading configuration..." />;
  }

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
