/**
 * curatedStopsAvailability.ts
 *
 * ORCH-1019 F-2 / F-1(c): canonical curated all-stops availability validator.
 *
 * Mirrors the reference-correct ActionButtons.tsx:479-511 pattern. There is NO
 * bespoke day-key lookup here — `extractWeekdayText` + `isPlaceOpenAt`
 * (openingHoursUtils.ts) handle every persisted `openingHours` shape
 * (Google-v1 `weekdayDescriptions`, legacy lowercase day-record, `{lines}`,
 * `string[]`, JSON-string). This file is the single shared validator used by
 * BOTH the SavedTab schedule path and the CalendarTab reschedule path, so the
 * "All Stops Are Open!" / "Some Stops Are Closed" verdict is computed in one
 * place and cannot drift.
 *
 * Pure logic, no React-Native dependencies → Deno-runnable unit test
 * (curatedStopsAvailability.test.ts), matching the friendMenu.ts pattern.
 *
 * Verdict semantics (Constitution #9 — no fabricated availability):
 *   isPlaceOpenAt === false → CLOSED → counts toward "Some Stops Are Closed".
 *   isPlaceOpenAt === true  → OPEN.
 *   isPlaceOpenAt === null  → honest-unknown (no parseable hours) → NOT safe
 *                             to schedule. Curated plans only get an "all open"
 *                             verdict when every stop is proven open.
 *
 * #4347 wave 3 follow-up: `isPlaceOpenAt` is now the yes/no projection of
 * `getOpenStatusAt` (one overnight-hours model), so this check, the plan
 * sheet's at-arrival chips and its warning agree after midnight: a stop open
 * "6:00 PM – 2:00 AM" on Saturday is open at a Sunday 01:00 arrival.
 */

import { extractWeekdayText, openMinutesLeftAt } from './openingHoursUtils';

export interface StopAvailability {
  stopName: string;
  status: 'open' | 'closed' | 'unknown';
  isOpen: boolean; // true only when status === 'open'
  reason?: string; // present when status !== 'open'
}

export interface CuratedStopsAvailabilityResult {
  allOpen: boolean;
  results: StopAvailability[];
}

// Minimal structural shape — accepts CuratedStop without importing the full
// type, so this helper stays a pure leaf (and Deno-testable with plain objects).
export interface AvailabilityStop {
  placeName?: string;
  openingHours?: unknown;
  estimatedDurationMinutes?: number;
  travelTimeFromPreviousStopMin?: number | null;
  utcOffsetMinutes?: number | null;
  // legacy snake_case escape hatch (forward-compat with generator emission)
  utc_offset_minutes?: number | null;
}

const DEFAULT_STOP_DURATION_MIN = 45;

/**
 * #4347 wave 3 rework — ONE "worth arriving" rule for the plan sheet and this
 * check: a stop that closes within this many minutes of your arrival counts as
 * CLOSED. The plan sheet's chips and warning (curatedPlanModel.arrivalOpen)
 * read the same constant, so scheduling can never accept a time the sheet
 * calls closed.
 */
export const MIN_USEFUL_OPEN_MINUTES = 15;

/**
 * Format the per-stop closed reason. `locale` is threaded in so the caller's
 * resolved user locale is honoured (SavedTab passes getUserLocale()); the
 * Deno test passes a fixed locale for determinism.
 */
function formatClosedReason(arrivalTime: Date, locale?: string): string {
  const timeStr = arrivalTime.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `Closed at ${timeStr}`;
}

function formatClosingSoonReason(arrivalTime: Date, locale?: string): string {
  const timeStr = arrivalTime.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `Closes within ${MIN_USEFUL_OPEN_MINUTES} min of arriving at ${timeStr}`;
}

function formatUnknownReason(arrivalTime: Date, locale?: string): string {
  const timeStr = arrivalTime.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `Hours unavailable at ${timeStr}`;
}

/**
 * #4347 wave 3 — THE ONE arrival-time model for a curated plan.
 *
 * Each stop's arrival = start + every earlier stop's dwell + every leg up to it
 * (the same cumulative model the schedule check has always used). The expanded
 * plan's clock times, its per-stop conditions and its warning card, the deck's
 * smart chip and the schedule safety check below all read THIS function, so a
 * time on screen and the time the safety check tests can never disagree.
 *
 * Pure, no React Native — Deno-testable like the validator.
 */
export interface PlanStopTiming {
  readonly index: number;
  readonly arrival: Date;
  /** arrival + this stop's dwell. */
  readonly departure: Date;
  readonly dwellMinutes: number;
  /** Minutes of travel INTO this stop from the previous one; null for stop 1 / no figure. */
  readonly legMinutes: number | null;
}

export function curatedArrivalTimes(
  stops: readonly AvailabilityStop[],
  startTime: Date,
): PlanStopTiming[] {
  let cumulativeMinutes = 0;
  return stops.map((stop, idx) => {
    const arrival = new Date(startTime.getTime() + cumulativeMinutes * 60_000);
    const dwellMinutes = stop.estimatedDurationMinutes ?? DEFAULT_STOP_DURATION_MIN;
    const leg = idx > 0 && stop.travelTimeFromPreviousStopMin ? stop.travelTimeFromPreviousStopMin : null;
    // PRESERVE the existing cumulative model (SavedTab.tsx:1170-1174):
    cumulativeMinutes += dwellMinutes;
    if (idx < stops.length - 1 && stops[idx + 1]?.travelTimeFromPreviousStopMin) {
      cumulativeMinutes += stops[idx + 1]!.travelTimeFromPreviousStopMin!;
    }
    return {
      index: idx,
      arrival,
      departure: new Date(arrival.getTime() + dwellMinutes * 60_000),
      dwellMinutes,
      legMinutes: leg,
    };
  });
}

/**
 * Canonical curated all-stops validator. Preserves the existing cumulative
 * arrival-time model (each stop's estimated arrival = start + Σ prior
 * durations + Σ travel times) and routes every open/closed decision through
 * the canonical reader.
 *
 * @param stops      ordered curated stops
 * @param startTime  the chosen/estimated plan start datetime (NOT new Date())
 * @param locale     optional user locale for the closed-reason time string
 */
export function checkAllCuratedStopsOpen(
  stops: AvailabilityStop[],
  startTime: Date,
  locale?: string,
): CuratedStopsAvailabilityResult {
  const timings = curatedArrivalTimes(stops, startTime);

  const results: StopAvailability[] = stops.map((stop, idx) => {
    const arrivalTime = timings[idx]!.arrival;
    const weekdayText = extractWeekdayText(stop.openingHours as Parameters<typeof extractWeekdayText>[0]);
    // Per-stop venue offset if present; else canonical reader's documented
    // device-local fallback (same as the reference ActionButtons call).
    const utcOffset = stop.utcOffsetMinutes ?? stop.utc_offset_minutes ?? null;
    const minutesLeft = openMinutesLeftAt(weekdayText, arrivalTime, utcOffset);

    const stopName = stop.placeName ?? 'Stop';

    if (minutesLeft === 0) {
      return { stopName, status: 'closed', isOpen: false, reason: formatClosedReason(arrivalTime, locale) };
    }
    if (minutesLeft !== null && minutesLeft < MIN_USEFUL_OPEN_MINUTES) {
      return { stopName, status: 'closed', isOpen: false, reason: formatClosingSoonReason(arrivalTime, locale) };
    }
    if (minutesLeft !== null) {
      return { stopName, status: 'open', isOpen: true };
    }
    return { stopName, status: 'unknown', isOpen: false, reason: formatUnknownReason(arrivalTime, locale) };
  });

  return { allOpen: results.every((r) => r.isOpen), results };
}
