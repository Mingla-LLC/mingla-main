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
 *   isPlaceOpenAt === null  → honest-unknown (no parseable hours) → treated as
 *                             OPEN-but-unknown, does NOT block — consistent with
 *                             the regular-card advisory path and the reference
 *                             ActionButtons (which only flags `=== false`).
 */

import { extractWeekdayText, isPlaceOpenAt } from './openingHoursUtils';

export interface StopAvailability {
  stopName: string;
  isOpen: boolean; // true when isPlaceOpenAt === true OR === null (honest-unknown is non-blocking)
  reason?: string; // present only when isOpen === false
}

export interface CuratedStopsAvailabilityResult {
  allOpen: boolean;
  results: StopAvailability[];
}

// Minimal structural shape — accepts CuratedStop without importing the full
// type, so this helper stays a pure leaf (and Deno-testable with plain objects).
interface AvailabilityStop {
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
  return `May be closed at ${timeStr}`;
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
  let cumulativeMinutes = 0;

  const results: StopAvailability[] = stops.map((stop, idx) => {
    const arrivalTime = new Date(startTime.getTime() + cumulativeMinutes * 60_000);
    const weekdayText = extractWeekdayText(stop.openingHours as Parameters<typeof extractWeekdayText>[0]);
    // Per-stop venue offset if present; else canonical reader's documented
    // device-local fallback (same as the reference ActionButtons call).
    const utcOffset = stop.utcOffsetMinutes ?? stop.utc_offset_minutes ?? null;
    const openAtArrival = isPlaceOpenAt(weekdayText, arrivalTime, utcOffset);

    // PRESERVE the existing cumulative model (SavedTab.tsx:1170-1174):
    cumulativeMinutes += stop.estimatedDurationMinutes ?? DEFAULT_STOP_DURATION_MIN;
    if (idx < stops.length - 1 && stops[idx + 1]?.travelTimeFromPreviousStopMin) {
      cumulativeMinutes += stops[idx + 1]!.travelTimeFromPreviousStopMin!;
    }

    const stopName = stop.placeName ?? 'Stop';

    if (openAtArrival === false) {
      return { stopName, isOpen: false, reason: formatClosedReason(arrivalTime, locale) };
    }
    // true OR null → not blocking (null = honest-unknown; advisory only).
    return { stopName, isOpen: true };
  });

  return { allOpen: results.every((r) => r.isOpen), results };
}
