import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Ticket } from '@/types';

interface TicketDragPreviewProps {
  ticket: Ticket;
}

export function TicketDragPreview({ ticket }: TicketDragPreviewProps) {
  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-500 text-white';
      case 'high':
        return 'bg-orange-500 text-white';
      case 'medium':
        return 'bg-blue-500 text-white';
      case 'low':
        return 'bg-gray-500 text-white';
      default:
        return 'bg-blue-500 text-white';
    }
  };

  return (
    <div className="bg-card border rounded-lg shadow-lg p-3 min-w-[280px] max-w-[320px]">
      <div className="flex items-start gap-2 mb-2">
        <span className="font-semibold text-sm text-blue-600">
          {ticket.ticketNumber}
        </span>
        <Badge className={cn('text-[10px] px-1.5 py-0 uppercase', getPriorityColor(ticket.priority))}>
          {ticket.priority}
        </Badge>
      </div>
      <div className="text-sm font-medium mb-1 truncate">{ticket.title}</div>
      <div className="text-xs text-muted-foreground">{ticket.customerName}</div>
      <div className="text-xs text-muted-foreground mt-1">
        Est. {ticket.estimatedDuration} min
      </div>
    </div>
  );
}
