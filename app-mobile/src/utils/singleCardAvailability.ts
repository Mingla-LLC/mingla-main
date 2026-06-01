/**
 * singleCardAvailability.ts
 *
 * Decisive scheduling-time availability for regular (single-place) cards.
 * Passive "open now" badges can remain informational; scheduling is only safe
 * when this helper can prove the venue is open at the selected datetime.
 */

import { extractWeekdayText, isPlaceOpenAt } from './openingHoursUtils';

export type SchedulingAvailabilityStatus = 'open' | 'closed' | 'unknown';

interface SingleCardAvailabilityInput {
  openingHours?: unknown;
  utcOffsetMinutes?: number | null;
  utc_offset_minutes?: number | null;
}

export interface SingleCardSchedulingAvailability {
  status: SchedulingAvailabilityStatus;
  isSafeToSchedule: boolean;
  reason?: string;
  timeLabel: string;
}

function formatScheduleTime(date: Date, locale?: string): string {
  return date.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function resolveSingleCardUtcOffset(card?: SingleCardAvailabilityInput | null): number | null {
  if (!card) return null;
  const offset = card.utcOffsetMinutes ?? card.utc_offset_minutes ?? null;
  return typeof offset === 'number' && Number.isFinite(offset) ? offset : null;
}

export function buildSingleCardNotSafeMessage(result: SingleCardSchedulingAvailability): string {
  return result.reason ?? `Mingla could not confirm this place is open at ${result.timeLabel}. Please choose a different time.`;
}

export function checkSingleCardSchedulingAvailability(
  card: SingleCardAvailabilityInput | null | undefined,
  scheduledTime: Date,
  locale?: string,
): SingleCardSchedulingAvailability {
  const timeLabel = formatScheduleTime(scheduledTime, locale);
  const weekdayText = extractWeekdayText(card?.openingHours as Parameters<typeof extractWeekdayText>[0]);
  const utcOffset = resolveSingleCardUtcOffset(card);
  const openAtSelectedTime = isPlaceOpenAt(weekdayText, scheduledTime, utcOffset);

  if (openAtSelectedTime === true) {
    return {
      status: 'open',
      isSafeToSchedule: true,
      timeLabel,
    };
  }

  if (openAtSelectedTime === false) {
    return {
      status: 'closed',
      isSafeToSchedule: false,
      reason: `This place is closed at ${timeLabel}. Please choose a different time.`,
      timeLabel,
    };
  }

  return {
    status: 'unknown',
    isSafeToSchedule: false,
    reason: `Mingla could not confirm this place is open at ${timeLabel}. Please choose a different time.`,
    timeLabel,
  };
}
