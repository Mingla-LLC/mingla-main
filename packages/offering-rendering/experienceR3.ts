/**
 * experienceR3 — issue #3281 Round 3 (3b + 3c client helpers).
 *
 * Pure + dep-free (I-MOR-0827-PACKAGE-ISOLATION). Single owner for:
 *   • the per-day / per-start "N left" / "Full" chip beside a day row,
 *   • the "about N min in" copy beside an itinerary stop,
 *   • the scope-aware "N spots left · M max" meta label.
 */

export type ExperienceCapacityScope = "total" | "per_day" | "per_start";

/** Narrow an untrusted value to a capacity scope; absent/unknown → "total". */
export const parseExperienceCapacityScope = (
  raw: unknown,
): ExperienceCapacityScope =>
  raw === "per_day" || raw === "per_start" ? raw : "total";

/**
 * Chip text for a numeric remaining count: "N left" / "Full". null (unlimited
 * or unknown) → null so the caller can fall back to its own wording.
 */
export const experienceRemainingChipText = (
  remaining: number | null | undefined,
): string | null => {
  if (typeof remaining !== "number" || !Number.isFinite(remaining)) return null;
  return remaining <= 0 ? "Full" : `${Math.round(remaining)} left`;
};

/** "about 30 min in" / "about 1 hr 30 min in"; null when unset or invalid. */
export const experienceStopOffsetLabel = (
  offsetMinutes: number | null | undefined,
): string | null => {
  if (typeof offsetMinutes !== "number" || !Number.isFinite(offsetMinutes)) {
    return null;
  }
  const n = Math.round(offsetMinutes);
  if (n < 0) return null;
  if (n === 0) return "at the start";
  if (n < 60) return `about ${n} min in`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m === 0 ? `about ${h} hr in` : `about ${h} hr ${m} min in`;
};

export interface ExperienceSeatsOccurrence {
  startAt: string;
  remaining: number | null;
}

export interface ExperienceSeatsInput {
  capacityScope?: ExperienceCapacityScope | null;
  occurrences: ReadonlyArray<ExperienceSeatsOccurrence>;
  /** Event-level remaining / total from the one ticket (scope = total). */
  ticketRemaining: number | null;
  quantityTotal: number | null;
  isUnlimited: boolean;
  nowMs?: number;
}

const seatsText = (
  remaining: number | null,
  total: number | null,
): string | null => {
  if (remaining === null && total === null) return null;
  if (remaining !== null && total !== null) {
    return `${Math.max(remaining, 0)} spots left · ${total} max`;
  }
  if (remaining !== null) return `${Math.max(remaining, 0)} spots left`;
  return total !== null ? `${total} max` : null;
};

/**
 * "3 spots left · 12 max". For per_day / per_start the remaining is the NEXT
 * OPEN day's (soonest upcoming occurrence that is not full), not the event-level
 * sum; when every upcoming day is full the label says so. total → legacy.
 */
export const experienceSeatsLabel = (
  input: ExperienceSeatsInput,
): string | null => {
  if (input.isUnlimited) return null;
  const scope = input.capacityScope ?? "total";
  if (scope === "total") {
    return seatsText(input.ticketRemaining, input.quantityTotal);
  }
  const nowMs = input.nowMs ?? Date.now();
  const upcoming = input.occurrences
    .map((o) => ({ o, ms: Date.parse(o.startAt) }))
    .filter((x) => Number.isFinite(x.ms) && x.ms >= nowMs)
    .sort((a, b) => a.ms - b.ms)
    .map((x) => x.o);
  if (upcoming.length === 0) {
    return seatsText(input.ticketRemaining, input.quantityTotal);
  }
  const open = upcoming.find((o) => o.remaining === null || o.remaining > 0);
  if (open === undefined) {
    return input.quantityTotal !== null
      ? `Full · ${input.quantityTotal} max`
      : "Full";
  }
  return seatsText(open.remaining, input.quantityTotal);
};
