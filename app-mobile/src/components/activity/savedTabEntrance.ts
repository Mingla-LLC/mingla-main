/**
 * Issue #1636 — the Likes entrance stagger used to scale with list length.
 *
 * The old effect in `SavedTab.tsx` scheduled one `setTimeout(..., index * 60)`
 * per card across the WHOLE list, so the last card's spring did not even START
 * until `N * 60 ms`:
 *
 *     N =  50  ->  3.0 s
 *     N = 148  ->  8.9 s   (the real production ceiling account)
 *     N = 200  -> 12.0 s
 *
 * Every card sat at 80 % scale until its turn arrived, so the screen read as
 * "still loading" long after the data had landed — a delay that was purely
 * client-side and that a warm cache could not fix. Worse, the effect's
 * dependency was `[filteredCards.length]`, so any change in the match count
 * (i.e. every keystroke in the search box) reset all N cards to 0.8 and
 * restarted the entire ramp mid-interaction.
 *
 * The fix keeps the entrance — Likes is supposed to feel premium, not abrupt —
 * but bounds its tail. The delay is clamped, so the ramp still reads as a
 * stagger for the cards a user can actually see on first paint, and every card
 * after that shares the same (bounded) start.
 *
 * `SavedTab` pairs this with a "already animated" id set so a card animates in
 * exactly once per mount, which is what stops the search box from restarting
 * the ramp.
 */

/** Scale a card starts at before springing to 1. */
export const ENTRANCE_START_SCALE = 0.8;

/** Per-position delay step, unchanged from the original motion language. */
export const ENTRANCE_STAGGER_STEP_MS = 60;

/**
 * The position at which the ramp stops growing. Chosen so the staggered run is
 * comfortably longer than the first-paint window (a Likes card is ~180pt tall,
 * so roughly 4-5 fit on an SM-A725F screen) while the tail stays bounded.
 */
export const ENTRANCE_MAX_STAGGER_STEPS = 8;

/**
 * The hard ceiling on how late the LAST card can begin its entrance, for any
 * list length whatsoever. 8 * 60 = 480 ms.
 */
export const ENTRANCE_MAX_DELAY_MS = ENTRANCE_STAGGER_STEP_MS * ENTRANCE_MAX_STAGGER_STEPS;

/**
 * Delay, in milliseconds, before the card at `index` starts its entrance
 * spring.
 *
 * Contract (this is what the regression test pins):
 *   - monotonically non-decreasing in `index`;
 *   - strictly stepped by `ENTRANCE_STAGGER_STEP_MS` while
 *     `index <= ENTRANCE_MAX_STAGGER_STEPS`, so the entrance still reads as a
 *     stagger rather than a single simultaneous pop;
 *   - NEVER greater than `ENTRANCE_MAX_DELAY_MS`, no matter how large the list
 *     is. This is the property that makes the tail independent of N.
 */
export function getEntranceStaggerDelayMs(index: number): number {
  if (!Number.isFinite(index) || index <= 0) return 0;
  const step = Math.min(Math.floor(index), ENTRANCE_MAX_STAGGER_STEPS);
  return step * ENTRANCE_STAGGER_STEP_MS;
}
