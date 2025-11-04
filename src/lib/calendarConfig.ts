export interface CalendarConfig {
  dayStartHour: number;
  dayEndHour: number;
  slotIncrement: number; // in minutes
}

export const DEFAULT_CALENDAR_CONFIG: CalendarConfig = {
  dayStartHour: 8,
  dayEndHour: 17, // 5 PM - last slot will be 4:45 PM
  slotIncrement: 15,
};

/**
 * Calculate which grid row a time should start at (1-indexed for CSS Grid)
 */
export function getGridRowFromTime(time: Date, config: CalendarConfig): number {
  const totalMinutesFromMidnight = time.getHours() * 60 + time.getMinutes();
  const startMinutes = config.dayStartHour * 60;
  const minutesFromStart = totalMinutesFromMidnight - startMinutes;
  const slotIndex = Math.floor(minutesFromStart / config.slotIncrement);
  return slotIndex + 1; // CSS Grid is 1-indexed
}

/**
 * Calculate the exact fractional position within a grid row (0-1)
 * For appointments that don't align perfectly with slot boundaries
 */
export function getSubSlotOffset(time: Date, config: CalendarConfig): number {
  const totalMinutesFromMidnight = time.getHours() * 60 + time.getMinutes();
  const startMinutes = config.dayStartHour * 60;
  const minutesFromStart = totalMinutesFromMidnight - startMinutes;
  const slotIndex = Math.floor(minutesFromStart / config.slotIncrement);
  const slotStartMinutes = slotIndex * config.slotIncrement;
  const offsetWithinSlot = minutesFromStart - slotStartMinutes;
  return offsetWithinSlot / config.slotIncrement; // 0-1 fraction
}

/**
 * Generate time slots for the calendar grid
 */
export function generateTimeSlots(config: CalendarConfig) {
  const totalHours = config.dayEndHour - config.dayStartHour;
  const slotsPerHour = 60 / config.slotIncrement;
  const totalSlots = totalHours * slotsPerHour;

  return Array.from({ length: totalSlots }, (_, i) => {
    const totalMinutes = i * config.slotIncrement;
    const hour = Math.floor(totalMinutes / 60) + config.dayStartHour;
    const minute = totalMinutes % 60;
    return { hour, minute, index: i };
  });
}
