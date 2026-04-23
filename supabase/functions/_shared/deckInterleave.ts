/**
 * ORCH-0634 — Round-robin interleave helper
 *
 * Serves one card per chip in the user's selected order, then rotates back to
 * the first chip for the second card, and so on. When a chip's bucket is
 * exhausted, it drops out of rotation. Result respects `totalLimit` as the
 * hard cap.
 *
 * Used by discover-cards multi-chip singles fan-out to ensure users see a card
 * from each selected chip before the deck backfills with second-and-beyond
 * cards from rich chips.
 *
 * Deterministic for identical inputs — positions stable across partial fetches
 * (Invariant I-PROGRESSIVE-DELIVERY-EXPANSION-NOT-REPLACEMENT).
 *
 * Complexity: O(total cards) single pass. No sort — caller pre-sorts per-chip
 * by signal_score DESC.
 */

export interface InterleaveInput<T> {
  /**
   * chipKey → ordered results (caller pre-sorts by relevance).
   * Map insertion order is preserved and drives the rotation order.
   * Use a Map (not a plain object) to guarantee ordering in all JS engines.
   */
  perChip: Map<string, T[]>;
  totalLimit: number;
}

export function roundRobinByChip<T>(
  input: InterleaveInput<T>,
): T[] {
  const { perChip, totalLimit } = input;
  if (totalLimit <= 0) return [];
  if (perChip.size === 0) return [];

  // Snapshot each chip's current pointer (mutated during drain).
  // Using plain array of [chipKey, ptr, items] tuples for zero allocations in the hot loop.
  const buckets: Array<{ key: string; ptr: number; items: T[] }> = [];
  for (const [key, items] of perChip) {
    if (items.length > 0) {
      buckets.push({ key, ptr: 0, items });
    }
  }
  if (buckets.length === 0) return [];

  const result: T[] = [];
  let anyAdded = true;

  while (result.length < totalLimit && anyAdded) {
    anyAdded = false;
    for (const bucket of buckets) {
      if (bucket.ptr < bucket.items.length) {
        result.push(bucket.items[bucket.ptr]);
        bucket.ptr += 1;
        anyAdded = true;
        if (result.length >= totalLimit) break;
      }
    }
  }

  return result;
}
