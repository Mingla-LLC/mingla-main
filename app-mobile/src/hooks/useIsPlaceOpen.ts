import { useState, useEffect, useCallback, useMemo } from 'react';
import { isPlaceOpenNow, extractWeekdayText } from '../utils/openingHoursUtils';

/**
 * Returns the live open/closed status for a place.
 *
 * @param openingHours - any shape of opening hours data from the card
 * @returns boolean | null — true = open, false = closed, null = unknown (hide badge)
 *
 * Re-checks every 60 seconds so the badge updates live.
 */
export function useIsPlaceOpen(
  openingHours:
    | string
    | { open_now?: boolean; weekday_text?: string[] }
    | Record<string, string>
    | string[]
    | null
    | undefined,
  utcOffsetMinutes?: number | null,
): boolean | null {
  // Extract weekday_text and stabilise identity so the interval doesn't
  // reset on every render (extractWeekdayText returns a new array each call).
  const weekdayTextRaw = extractWeekdayText(openingHours);
  const weekdayTextKey = weekdayTextRaw ? JSON.stringify(weekdayTextRaw) : null;
  const weekdayText = useMemo(() => weekdayTextRaw, [weekdayTextKey]);

  const compute = useCallback(() => {
    return isPlaceOpenNow(weekdayText, utcOffsetMinutes);
  }, [weekdayText, utcOffsetMinutes]);

  const [isOpen, setIsOpen] = useState<boolean | null>(compute);

  useEffect(() => {
    // Recompute immediately when data changes
    setIsOpen(compute());

    // Re-check every 60 seconds
    const interval = setInterval(() => {
      setIsOpen(compute());
    }, 60_000);

    return () => clearInterval(interval);
  }, [compute]);

  return isOpen;
}
