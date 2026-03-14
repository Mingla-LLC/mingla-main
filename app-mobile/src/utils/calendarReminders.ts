import * as Calendar from "expo-calendar";
import type { DeviceCalendarEvent } from "../services/deviceCalendarService";

/**
 * Builds a full-day calendar event with 7-tier reminder alarms
 * for birthdays and holidays.
 *
 * Alarm offsets (in minutes before event):
 *   3 months (91 days), 1 month (30 days), 2 weeks, 1 week,
 *   3 days, 1 day, day-of
 */
export function buildHolidayCalendarEvent(
  title: string,
  nextOccurrence: Date,
  notes?: string
): DeviceCalendarEvent {
  const startDate = new Date(nextOccurrence);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(nextOccurrence);
  endDate.setHours(23, 59, 59, 999);

  return {
    title,
    startDate,
    endDate,
    notes: notes || "Reminder from Mingla",
    alarms: [
      { relativeOffset: -131040, method: Calendar.AlarmMethod.ALERT }, // 91 days
      { relativeOffset: -43200, method: Calendar.AlarmMethod.ALERT }, // 30 days
      { relativeOffset: -20160, method: Calendar.AlarmMethod.ALERT }, // 14 days
      { relativeOffset: -10080, method: Calendar.AlarmMethod.ALERT }, // 7 days
      { relativeOffset: -4320, method: Calendar.AlarmMethod.ALERT }, // 3 days
      { relativeOffset: -1440, method: Calendar.AlarmMethod.ALERT }, // 1 day
      { relativeOffset: 0, method: Calendar.AlarmMethod.ALERT }, // Day of
    ],
  };
}
