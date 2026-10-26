// Issue #4130 (Wave 0) — the colour and arrow of a stat card's trend.
//
// Pure module. Up is green with a rising arrow, down is red with a falling
// arrow, and anything else (no change, not known) is neutral grey with a
// level dash. Before this, a card given no direction drew every trend red and
// falling, even when the number went up (Dashboard audit, #4130).
//
//   trendUp: true -> up, false -> down, anything else -> flat

export const TREND_TONES = Object.freeze({
  up: Object.freeze({ tone: "up", arrow: "↗", className: "text-[var(--color-success-700)]" }),
  down: Object.freeze({ tone: "down", arrow: "↘", className: "text-[var(--color-error-700)]" }),
  flat: Object.freeze({ tone: "flat", arrow: "–", className: "text-[var(--color-text-tertiary)]" }),
});

export function trendTone(trendUp) {
  if (trendUp === true) return TREND_TONES.up;
  if (trendUp === false) return TREND_TONES.down;
  return TREND_TONES.flat;
}

/** A direction word ("up" / "down" / anything) as the `trendUp` a StatCard takes. */
export function trendUpFromDirection(direction) {
  if (direction === "up") return true;
  if (direction === "down") return false;
  return undefined;
}
