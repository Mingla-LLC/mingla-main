/**
 * issue #3281 — next-occurrence fields for public cards / SEO.
 * Loaded on intent from public fetch paths so the eager __common chunk
 * does not absorb schedule plumbing (#2099 / #3493 movement ceiling).
 */
import type { LiveEvent } from "../store/liveEventStore";

export type NextOccurrenceRow = {
  next_start_at?: string | null;
  next_end_at?: string | null;
};

export const attachNextOccurrenceFields = <T extends LiveEvent>(
  event: T,
  row: NextOccurrenceRow,
): T => {
  if (row.next_start_at == null || row.next_start_at === "") return event;
  return {
    ...event,
    nextStartAtUtc: row.next_start_at,
    nextEndAtUtc: row.next_end_at ?? null,
  };
};
