/**
 * scheduleDateExpansion — active-date computation for ORCH-0704 v2.
 *
 * "Active date" = a calendar date (ISO YYYY-MM-DD) the event is
 * scheduled to occur on. Used by `updateLiveEventFields` to detect
 * destructive whenMode/recurrence/multiDates changes that would drop
 * a date the buyer had access to → triggers refund-first reject.
 *
 * Per ORCH-0704 v2 spec §3.3.4.
 */

import type {
  WhenMode,
  RecurrenceRule,
  MultiDateEntry,
} from "../store/draftEventStore";
import { expandRecurrenceToDates } from "./recurrenceRule";

export interface ActiveSchedule {
  whenMode: WhenMode;
  date: string | null;
  recurrenceRule: RecurrenceRule | null;
  multiDates: MultiDateEntry[] | null;
}

const toIsoDate = (d: Date): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

/**
 * Returns sorted ISO YYYY-MM-DD list of all dates the event is
 * scheduled for.
 *
 *   single mode      → [event.date] (filtered if null)
 *   recurring mode   → expandRecurrenceToDates(rule, firstDate) → ISO
 *   multi_date mode  → multiDates[i].date list
 */
export const computeActiveDates = (s: ActiveSchedule): string[] => {
  if (s.whenMode === "single") {
    return s.date !== null ? [s.date] : [];
  }
  if (s.whenMode === "recurring") {
    if (s.date === null || s.recurrenceRule === null) return [];
    const dates = expandRecurrenceToDates(s.recurrenceRule, s.date);
    return dates.map(toIsoDate).sort();
  }
  if (s.whenMode === "multi_date") {
    if (s.multiDates === null) return [];
    return s.multiDates.map((m) => m.date).sort();
  }
  // Exhaustive — TypeScript catches missing branches.
  const _exhaust: never = s.whenMode;
  return _exhaust;
};

/**
 * Returns dates present in `before.activeDates` but missing from
 * `after.activeDates`. If empty, no destructive change occurred.
 *
 * If `before` and `after` produce identical active-date sets, returns []
 * (e.g., recurrence rule mutated but expanded dates are the same — rare
 * but valid).
 */
export const computeDroppedDates = (
  before: ActiveSchedule,
  after: ActiveSchedule,
): string[] => {
  const beforeDates = new Set(computeActiveDates(before));
  const afterDates = new Set(computeActiveDates(after));
  return [...beforeDates].filter((d) => !afterDates.has(d)).sort();
};
