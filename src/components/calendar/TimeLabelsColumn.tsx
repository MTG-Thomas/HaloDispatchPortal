import { format, setHours, setMinutes } from 'date-fns';
import { cn } from '@/lib/utils';
import type { CalendarConfig } from '@/lib/calendarConfig';
import { generateTimeSlots } from '@/lib/calendarConfig';

interface TimeLabelsColumnProps {
  config: CalendarConfig;
  hasBeforeHours?: boolean;
  hasAfterHours?: boolean;
  className?: string;
  allDayHeight: number;
  beforeHoursHeight: number;
  afterHoursHeight: number;
}

export function TimeLabelsColumn({
  config,
  hasBeforeHours = false,
  hasAfterHours = false,
  className,
  allDayHeight,
  beforeHoursHeight,
  afterHoursHeight,
}: TimeLabelsColumnProps) {
  const timeSlots = generateTimeSlots(config);
  const slotHeight = 48; // Must match CalendarColumn

  return (
    <div className={cn('border-r bg-muted/10', className)}>
      {/* All Day Section Label */}
      <div
        className="border-b flex items-center px-2 text-xs text-muted-foreground bg-muted/10"
        style={{ height: `${allDayHeight}px` }}
      >
        All Day
      </div>

      {/* Before Hours Section Label */}
      {hasBeforeHours && (
        <div
          className="border-b flex items-start px-2 pt-1 text-[10px] text-muted-foreground bg-orange-50 dark:bg-orange-950/20"
          style={{ height: `${beforeHoursHeight}px` }}
        >
          Before {config.dayStartHour} AM
        </div>
      )}

      {/* Time labels for regular hours */}
      <div
        className="grid"
        style={{
          gridTemplateRows: `repeat(${timeSlots.length}, ${slotHeight}px)`,
          minHeight: `${timeSlots.length * slotHeight}px`,
        }}
      >
        {timeSlots.map((slot) => (
          <div
            key={slot.index}
            className={cn(
              'border-t text-xs text-muted-foreground relative flex items-start',
              slot.minute === 0 && 'border-t-2 font-medium'
            )}
          >
            {slot.minute === 0 && (
              <span className="absolute -top-2 left-2">
                {format(setHours(setMinutes(new Date(), 0), slot.hour), 'h a')}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* After Hours Section Label */}
      {hasAfterHours && (
        <div
          className="border-t flex items-start px-2 pt-1 text-[10px] text-muted-foreground bg-orange-50 dark:bg-orange-950/20"
          style={{ height: `${afterHoursHeight}px` }}
        >
          After {config.dayEndHour > 12 ? config.dayEndHour - 12 : config.dayEndHour} PM
        </div>
      )}
    </div>
  );
}
