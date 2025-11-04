import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Plus, Clock, FileText } from 'lucide-react';

interface TimeSlotContextMenuProps {
  agentId: string;
  startTime: Date;
  children: React.ReactNode;
}

export function TimeSlotContextMenu({ agentId, startTime, children }: TimeSlotContextMenuProps) {
  const handleCreateTicket = () => {
    // TODO: Open create ticket dialog
    console.log('Create ticket for agent', agentId, 'at', startTime);
  };

  const handleQuickSchedule = () => {
    // TODO: Open quick schedule dialog
    console.log('Quick schedule for agent', agentId, 'at', startTime);
  };

  const handleBlockTime = () => {
    // TODO: Create a blocked time appointment
    console.log('Block time for agent', agentId, 'at', startTime);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onClick={handleCreateTicket}>
          <FileText className="h-4 w-4 mr-2" />
          Create New Ticket
        </ContextMenuItem>

        <ContextMenuItem onClick={handleQuickSchedule}>
          <Plus className="h-4 w-4 mr-2" />
          Quick Schedule
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onClick={handleBlockTime}>
          <Clock className="h-4 w-4 mr-2" />
          Block Time
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
