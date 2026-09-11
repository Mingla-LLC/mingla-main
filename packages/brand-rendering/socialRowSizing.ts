// socialRowSizing — issue #3188 [brand-page social icons wrap onto a second line].
//
// THE ONE PLACE the shared public-brand-page socials row decides how big a
// social chip is. Pure arithmetic: no React, no react-native, no imports at
// all. That is deliberate and load-bearing — `mingla-business jest (full
// suite)` is the only ALWAYS-RUN required gate and it is a node/ts-jest
// runner, so a module that pulled in react-native could not be unit-tested
// there at all.
//
// WHY A COMPUTED SIZE AND NOT A FLEXBOX ONE-LINER.
// `styles.socialsRow` used to be `flexWrap: "wrap"` with a hard `width: 44`
// chip, and Yoga/react-native-web default `flex-shrink` to **0** (measured on
// the deployed page — investigation F-1), so the layout engine's only move
// once `N*44 + (N-1)*10` exceeded the container was to start a second line.
// At eight links in the desktop sticky panel that is the reported 6 + 2 split.
// Simply deleting `flexWrap` would have produced horizontal OVERFLOW instead,
// which is worse. So: this module computes a diameter that fits, and
// `flexShrink: 1` on the chip is the structural backstop behind it.
//
// WHY THE CALLER MUST PASS THE ROW'S OWN MEASURED WIDTH.
// The container that overflows is the desktop sticky panel, and its inner
// width is a FIXED 318pt regardless of viewport (360 panel − 2×1px border −
// 2×20pt padding; measured live at exactly 318 — investigation F-2). Anything
// derived from `useWindowDimensions()` or `useResponsiveLayout().width` reads
// 1440 there and would shrink nothing, leaving the reported bug exactly where
// it was reported. Sizing therefore comes from the row's own `onLayout`.
//
// WHY THE HARD FLOOR IS AN ACCESSIBILITY CONSTANT, NOT A TASTE ONE.
// `hitSlop` is a proven NO-OP on react-native-web (investigation F-5: a live
// element whose source claims a 44pt target via hitSlop renders as a bare
// 40×40 box with zero padding or margin). On every web surface the visible
// circle IS the tap target, so the computed diameter itself has to satisfy
// WCAG 2.2 AA SC 2.5.8 Target Size (Minimum) = 24×24 CSS px. Hence
// SOCIAL_CHIP_D_MIN. Do NOT lower it, and do NOT claim a 44pt web target.

/** Today's diameter, the iOS HIG touch minimum, and the hard upper cap. */
export const SOCIAL_CHIP_D_MAX = 44;
/**
 * Soft design floor — below this a Lucide glyph at our stroke stops reading as
 * a distinct brand mark. Soft because the row spends its GAP first to stay
 * above it (step 4 below) rather than shrinking straight through it.
 */
export const SOCIAL_CHIP_D_FLOOR = 28;
/**
 * HARD floor. WCAG 2.2 AA SC 2.5.8 is 24×24 CSS px and on web the visible
 * circle is the whole tap target (`hitSlop` is inert there). Never breached.
 */
export const SOCIAL_CHIP_D_MIN = 24;
/** Today's gap. */
export const SOCIAL_ROW_GAP_MAX = 10;
/** Tightest gap that still visually separates two adjacent filled circles. */
export const SOCIAL_ROW_GAP_MIN = 4;
/** Today's glyph-to-circle ratio (21 inside 44), preserved exactly. */
export const SOCIAL_GLYPH_RATIO = 21 / 44;
/** Below 12px a 24-unit Lucide viewBox loses its distinguishing detail. */
export const SOCIAL_GLYPH_MIN = 12;
/**
 * Pre-measurement seed = the narrowest real container across every surface
 * (a 320pt device: 320 − 20 − 20 padding − 2×1px border = 278). Seeding at the
 * NARROWEST width makes the first frame conservative, so the measured width
 * only ever grows a chip — never clips one, and never squashes it to an
 * ellipse the way seeding at D_MAX would.
 */
export const SOCIAL_ROW_SEED_WIDTH = 278;

export interface SocialRowMetrics {
  diameter: number;
  gap: number;
  glyph: number;
  strokeWidth: number;
  hitSlop: { top: number; bottom: number; left: number; right: number };
}

/**
 * Solve one row of `count` social chips into `containerWidth` points.
 *
 * Guarantees for every reachable input (`count` 1..8, `containerWidth` >= 220):
 *   • `count * diameter + (count - 1) * gap <= containerWidth`  — it fits
 *   • `SOCIAL_CHIP_D_MIN <= diameter <= SOCIAL_CHIP_D_MAX`      — a11y + no growth
 *   • `hitSlop.left === hitSlop.right <= floor(gap / 2)`        — no overlapping targets
 *
 * @param containerWidth the row's OWN measured width, or `null` before the
 *   first `onLayout` (never a viewport width — see the header note).
 * @param count how many chips the row will render.
 */
export function solveSocialRow(
  containerWidth: number | null,
  count: number,
): SocialRowMetrics {
  // 0. The caller never renders an empty row (`socialsBlock` is null at zero
  //    entries), but a 0/negative/NaN count must not produce NaN geometry.
  const n =
    Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;

  // 1. Fall back to the conservative seed for any width we cannot trust.
  const width =
    containerWidth === null ||
    !Number.isFinite(containerWidth) ||
    containerWidth <= 0
      ? SOCIAL_ROW_SEED_WIDTH
      : containerWidth;

  // 2-3. Fix the gap FIRST, then FLOOR the diameter. Flooring is what makes
  //      the fit arithmetically guaranteed: the intuitive alternative (solve a
  //      proportional gap, then round it) overflows — at W=318, N=7 it yields
  //      d=38, gap=9, total 320 > 318.
  let gap = SOCIAL_ROW_GAP_MAX;
  let diameter = Math.floor((width - (n - 1) * gap) / n);

  // 4. Cap at today's size (the common case — every brand in production has at
  //    most one link, so nothing visible changes for them). Otherwise, if we
  //    have dropped under the soft design floor, spend the GAP before
  //    shrinking the circle any further.
  if (diameter >= SOCIAL_CHIP_D_MAX) {
    diameter = SOCIAL_CHIP_D_MAX;
  } else if (diameter < SOCIAL_CHIP_D_FLOOR) {
    gap = SOCIAL_ROW_GAP_MIN;
    diameter = Math.floor((width - (n - 1) * gap) / n);
  }

  // 5. Hard accessibility floor. If this clamp bites, the row's computed sum
  //    can exceed `width` — `flexShrink: 1` on the chip is the documented
  //    backstop, and ONE LINE still wins over a wrap. Unreachable today: the
  //    narrowest real container is 278pt, where N=8 yields 31.
  diameter = Math.max(diameter, SOCIAL_CHIP_D_MIN);

  // 6. Scale the glyph with the circle or it clips — `SocialIcon` used to be a
  //    hardcoded 21.
  const glyph = Math.max(
    SOCIAL_GLYPH_MIN,
    Math.round(diameter * SOCIAL_GLYPH_RATIO),
  );

  // 7. Thin the stroke as the glyph shrinks; a 2.2 stroke inside a 15px mark
  //    fills the counters and the brand becomes unrecognisable.
  const strokeWidth = diameter >= 40 ? 2.2 : diameter >= 32 ? 2 : 1.8;

  // 8. Restore the lost touch area on NATIVE ONLY (`hitSlop` is inert on
  //    react-native-web — F-5; the web target is the circle, floored at 24).
  //    Horizontal slop is capped at floor(gap/2) so adjacent hit boxes can
  //    NEVER overlap: centre-to-centre spacing is `diameter + gap`, and an
  //    uncapped ceil((44-d)/2) would make neighbours overlap whenever
  //    `diameter + gap < 44`. An overlapping target is resolved by responder
  //    order, so a tap in the seam opens the WRONG social network — a strictly
  //    worse failure than a 41pt target with clean boundaries.
  const vSlop = Math.max(0, Math.ceil((SOCIAL_CHIP_D_MAX - diameter) / 2));
  const hSlop = Math.min(vSlop, Math.floor(gap / 2));

  return {
    diameter,
    gap,
    glyph,
    strokeWidth,
    hitSlop: { top: vSlop, bottom: vSlop, left: hSlop, right: hSlop },
  };
}
