import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { CheckCircle, XCircle, Clock, Edit, Trash2, Play } from 'lucide-react';
import type { Appointment, AppointmentStatus } from '@/types';

interface AppointmentContextMenuProps {
  appointment: Appointment;
  children: React.ReactNode;
}

export function AppointmentContextMenu({ appointment, children }: AppointmentContextMenuProps) {
  const { updateAppointment, deleteAppointment, updateTicket } = useDispatchStore();

  const handleStatusChange = (status: AppointmentStatus) => {
    updateAppointment(appointment.id, { status });

    // Also update the ticket status if completing
    if (status === 'completed') {
      updateTicket(appointment.ticketId, { status: 'resolved' });
    } else if (status === 'cancelled') {
      updateTicket(appointment.ticketId, { status: 'on_hold' });
    }
  };

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this appointment?')) {
      deleteAppointment(appointment.id);
      // Revert ticket to in_progress if it was scheduled
      updateTicket(appointment.ticketId, { status: 'in_progress' });
    }
  };

  const handleEdit = () => {
    // TODO: Open edit dialog
    console.log('Edit appointment', appointment.id);
  };

  const getStatusIcon = (status: AppointmentStatus) => {
    switch (status) {
      case 'scheduled':
        return <Clock className="h-4 w-4" />;
      case 'in_progress':
        return <Play className="h-4 w-4" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4" />;
      case 'cancelled':
        return <XCircle className="h-4 w-4" />;
    }
  };

  const statusLabels: Record<AppointmentStatus, string> = {
    scheduled: 'Scheduled',
    in_progress: 'In Progress',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <ContextMenuItem onClick={handleEdit}>
          <Edit className="h-4 w-4 mr-2" />
          Edit Appointment
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Clock className="h-4 w-4 mr-2" />
            Change Status
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {Object.entries(statusLabels).map(([status, label]) => (
              <ContextMenuItem
                key={status}
                onClick={() => handleStatusChange(status as AppointmentStatus)}
                disabled={appointment.status === status}
              >
                {getStatusIcon(status as AppointmentStatus)}
                <span className="ml-2">{label}</span>
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        <ContextMenuItem
          onClick={() => handleStatusChange('in_progress')}
          disabled={appointment.status === 'in_progress'}
        >
          <Play className="h-4 w-4 mr-2" />
          Start Work
        </ContextMenuItem>

        <ContextMenuItem
          onClick={() => handleStatusChange('completed')}
          disabled={appointment.status === 'completed'}
        >
          <CheckCircle className="h-4 w-4 mr-2" />
          Mark Complete
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onClick={handleDelete} className="text-destructive">
          <Trash2 className="h-4 w-4 mr-2" />
          Delete Appointment
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
