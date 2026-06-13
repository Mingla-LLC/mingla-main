/**
 * ORCH-1130 Fix #2 [trip-pay-structure] — pure decision for the single-tier
 * checkout auto-skip, extracted so the loop-prevention gate/latch is unit
 * testable without rendering the expo-router screen.
 *
 * Background (INVESTIGATE_ORCH-1130 Issue #2): the auto-skip effect used to call
 * setLineQuantity AND router.replace('/buyer') in the SAME synchronous body. On
 * a warm-cache 2nd entry the navigation raced the cart write, /buyer read an
 * empty cart, and its pre-existing empty-cart guard bounced back to index → the
 * auto-skip re-fired → "Maximum update depth exceeded" ping-pong.
 *
 * This helper returns ONE of three outcomes per evaluation:
 *   - "noop"     → not a single bookable tier (or already-navigated this mount);
 *                  do nothing.
 *   - "addLine"  → the sole tier is bookable but its line is NOT yet in the cart;
 *                  dispatch setLineQuantity and WAIT (no navigation).
 *   - "navigate" → the sole tier's line is present (qty>=1) in the cart; it is
 *                  safe to router.replace('/buyer') exactly once.
 *
 * The component holds a useRef latch and passes `alreadyNavigated`; once it
 * navigates it flips the latch so this never returns "navigate" twice per mount.
 */

export interface AutoSkipTier {
  id: string;
  isUnlimited: boolean;
  /** Remaining bookable capacity; null when unlimited/unknown. */
  capacity: number | null;
}

export interface AutoSkipCartLine {
  ticketTypeId: string;
  quantity: number;
}

export type AutoSkipOutcome = "noop" | "addLine" | "navigate";

export interface AutoSkipInput {
  /** True once the latch has fired this mount — short-circuits to "noop". */
  alreadyNavigated: boolean;
  /** Null while the trip query is cold. */
  tripPresent: boolean;
  bookingsClosed: boolean;
  /** True when the trip end date is in the past (+24h grace). */
  isPast: boolean;
  /** The trip's bookable tiers mapped to the minimal shape. */
  tiers: AutoSkipTier[];
  /** Current cart lines. */
  lines: AutoSkipCartLine[];
}

/**
 * Decide the next auto-skip action. Single source of truth for both the gate
 * (navigate only once the line landed) and the latch (never navigate twice).
 */
export function decideAutoSkip(input: AutoSkipInput): AutoSkipOutcome {
  if (input.alreadyNavigated) return "noop";
  if (!input.tripPresent) return "noop";
  if (input.bookingsClosed) return "noop";
  if (input.tiers.length !== 1) return "noop";

  const sole = input.tiers[0];
  const soldOut = !sole.isUnlimited && (sole.capacity ?? 0) <= 0;
  if (soldOut) return "noop";
  if (input.isPast) return "noop";

  const soleLine = input.lines.find(
    (l) => l.ticketTypeId === sole.id && l.quantity >= 1,
  );
  // Gate: navigate ONLY once the cart write has landed (line present, qty>=1).
  // Until then, ask the caller to add the line and wait — no empty-cart window.
  return soleLine === undefined ? "addLine" : "navigate";
}
