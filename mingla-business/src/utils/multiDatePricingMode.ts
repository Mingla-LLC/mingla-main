/**
 * multiDatePricingMode — issue #2160. A LEAF module, deliberately.
 *
 * ⚠️  DO NOT MOVE THIS BACK INTO `draftEventStore.ts`, AND DO NOT ADD AN IMPORT
 * TO THIS FILE.
 *
 * It lived there for one commit and broke an unrelated TRIP render suite.
 * `businessEvents.ts` imported `draftEventStore` with `import type` only — which
 * TypeScript ERASES, so no runtime require existed. Adding a VALUE import of the
 * coercion turned that erased import into a real one, dragging
 * `draftEventStore` — and the AsyncStorage-backed zustand persist behind it —
 * into every consumer of `businessEvents.ts`. `EditPublishedTripScreen` is one,
 * and its render suite died with "[@RNC/AsyncStorage]: NativeModule:
 * AsyncStorage is null" without a single line of trip code changing.
 *
 * Same class as the #2135 incident where a static import pulled
 * `Sheet -> expo-blur` into three unrelated suites. A pure two-state coercion
 * has no business carrying a storage engine behind it, so it lives on its own
 * with zero imports and both sides point here.
 */

/** The organiser's per-event multi-day pricing choice. */
export type MultiDatePricingMode = "per_day" | "all_days";

/**
 * Total function over an untyped draft field. A draft persisted before #2160
 * carries `undefined`; anything unrecognised is also "per_day". Never returns a
 * third state, exactly like the NOT NULL database column, whose DEFAULT this
 * mirrors — which is why no persist migrator was needed.
 */
export const draftMultiDatePricingMode = (
  value: unknown,
): MultiDatePricingMode => (value === "all_days" ? "all_days" : "per_day");

/**
 * #3344 — the short note under a ticket price on a multi-date event: "per day"
 * or "for all days". The #2160 rule, for every surface that mounts the shared
 * ticket box (the live page and the organiser's preview must say the same).
 *
 * Null when there is nothing to qualify: no real choice of days, or no priced
 * ticket (a free event has no price to multiply). Kept import-free with the
 * rest of this leaf module.
 */
export const multiDatePricingNote = (input: {
  hasDayChoice: boolean;
  tickets: readonly { priceGbp?: number | null }[];
  pricingMode: MultiDatePricingMode;
}): "per day" | "for all days" | null => {
  if (!input.hasDayChoice) return null;
  if (!input.tickets.some((ticket) => (ticket.priceGbp ?? 0) > 0)) return null;
  return input.pricingMode === "all_days" ? "for all days" : "per day";
};
