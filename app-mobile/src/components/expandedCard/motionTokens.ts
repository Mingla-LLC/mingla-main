/**
 * #4347 wave 3 — THE motion tokens for the expanded card (the spec's motion
 * table, section 3b). Every animation on the plan sheet reads its timing here,
 * and every one has a Reduce Motion path that shows the end state at once.
 *
 * All of it runs on Reanimated (the engine the deck already uses); the plan's
 * RN `Animated` timeline and the Android-only `LayoutAnimation` rows are gone.
 */

/** ease-out cubic, as a Reanimated `Easing.bezier` argument list. */
export const EASE_OUT: readonly [number, number, number, number] = [0.33, 1, 0.68, 1];
/** The route stop "pop" overshoots a little (the prototype's 1.25 back-out). */
export const EASE_POP: readonly [number, number, number, number] = [0.2, 0.9, 0.3, 1.25];

export const PLAN_MOTION = {
  /** Sheet opens on a plan: stops pop in, legs draw left to right. */
  routeStopMs: 260,
  routeStopFromScale: 0.4,
  routeLegMs: 320,
  /** Start-to-start gap between stops; shrunk so the whole draw fits the budget. */
  routeStaggerMs: 290,
  /** The whole route draw finishes under this, however many stops. */
  routeBudgetMs: 1200,
  /** Stop cards appear: rise 12pt and fade in, one after another. */
  cardRiseMs: 240,
  cardRiseFromY: 12,
  cardStaggerMs: 60,
  /** Tap a stop in the navigator: smooth scroll, then a light pulse on the card. */
  jumpScrollMs: 350,
  pulseMs: 350,
  pulseRing: 'rgba(249,115,22,0.45)',
  /** Swap a stop: old card fades out, new one slides in, later times count. */
  swapMs: 280,
  swapFromX: 24,
  /** A stop's More panel grows (iPhone and Android alike). */
  detailsMs: 220,
  /** The warning card slides down from the summary. */
  warningMs: 220,
  warningFromY: -8,
  /** The sticky navigator shows / hides. */
  navigatorMs: 220,
} as const;

/**
 * The delay before stop `index` (0-based) pops in, so that `count` stops all
 * finish inside `routeBudgetMs`. Legs start with the stop they lead into.
 */
export function routeStaggerMs(count: number): number {
  if (count <= 1) return 0;
  const room = PLAN_MOTION.routeBudgetMs - Math.max(PLAN_MOTION.routeStopMs, PLAN_MOTION.routeLegMs);
  return Math.min(PLAN_MOTION.routeStaggerMs, Math.floor(room / (count - 1)));
}

/** Total time the route draw takes for `count` stops (for tests: always under budget). */
export function routeDrawTotalMs(count: number): number {
  if (count <= 0) return 0;
  return routeStaggerMs(count) * (count - 1) + Math.max(PLAN_MOTION.routeStopMs, PLAN_MOTION.routeLegMs);
}
