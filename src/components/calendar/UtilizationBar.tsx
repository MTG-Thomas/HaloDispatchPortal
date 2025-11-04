import { isSameDay } from 'date-fns';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { cn } from '@/lib/utils';

interface UtilizationBarProps {
  agentId: string;
  date: Date;
}

export function UtilizationBar({ agentId, date }: UtilizationBarProps) {
  const { agents, appointments } = useDispatchStore();

  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return null;

  // Get day of week
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = dayNames[date.getDay()] as keyof typeof agent.workingHours;
  const workingDay = agent.workingHours[dayName];

  if (!workingDay.isWorking) {
    return (
      <div className="text-[10px] text-center text-muted-foreground py-1">
        Non-working day
      </div>
    );
  }

  // Calculate available hours
  const [startHour, startMinute] = workingDay.startTime.split(':').map(Number);
  const [endHour, endMinute] = workingDay.endTime.split(':').map(Number);
  const availableHours = (endHour * 60 + endMinute - (startHour * 60 + startMinute)) / 60;

  // Calculate scheduled hours
  const dayAppointments = appointments.filter(
    (apt) => apt.agentId === agentId && isSameDay(apt.startTime, date)
  );

  const scheduledMinutes = dayAppointments.reduce((total, apt) => {
    const duration = (apt.endTime.getTime() - apt.startTime.getTime()) / (1000 * 60);
    return total + duration;
  }, 0);

  const scheduledHours = scheduledMinutes / 60;
  const utilizationPercentage = (scheduledHours / availableHours) * 100;

  // Determine color based on utilization
  const getUtilizationColor = () => {
    if (utilizationPercentage >= 100) return 'bg-red-500';
    if (utilizationPercentage >= 80) return 'bg-orange-500';
    if (utilizationPercentage >= 50) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <div className="space-y-0.5">
      {/* Bar */}
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full transition-all', getUtilizationColor())}
          style={{ width: `${Math.min(utilizationPercentage, 100)}%` }}
        />
      </div>

      {/* Text */}
      <div className="text-[10px] text-center font-medium">
        {scheduledHours.toFixed(1)}/{availableHours.toFixed(1)}{' '}
        <span className="text-muted-foreground">
          {utilizationPercentage.toFixed(0)}%
        </span>{' '}
        <span
          className={cn(
            utilizationPercentage >= 100
              ? 'text-red-600'
              : utilizationPercentage >= 50
              ? 'text-orange-600'
              : 'text-green-600'
          )}
        >
          {(availableHours - scheduledHours).toFixed(1)}
        </span>
      </div>
    </div>
  );
}
