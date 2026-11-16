/**
 * #4445: when a form is submitted with something wrong, the person must be taken
 * to the first thing to fix. Pure helpers (no React) so they are testable in Deno.
 */

/** The first key, in screen order, whose value is true (has an error); null when all are fine. */
export function firstErrorKey<K extends string>(order: readonly K[], hasError: Partial<Record<K, boolean>>): K | null {
  for (const key of order) if (hasError[key]) return key;
  return null;
}

/** Where to scroll so a field sits a little below the top edge, never above the content. */
export function scrollTargetY(fieldY: number, margin = 16): number {
  return Math.max(0, Math.round(fieldY - margin));
}
