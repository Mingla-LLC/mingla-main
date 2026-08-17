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
