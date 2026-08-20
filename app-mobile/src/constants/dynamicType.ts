/**
 * #2211 [a business user cannot accept a team invitation at the largest text size]
 * — the app's ONE definition of "how big has the user made the text, and how big
 * are we willing to let a CTA label get".
 *
 * ─── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 * React Native's iOS multiplier table (`RCTAccessibilityManager.mm`) runs to
 * 3.571 at the largest accessibility size, and `RCTTextAttributes.mm:139`
 * multiplies `lineHeight` by the same figure. A 14/20 label therefore lays out
 * at 50/71.4 pt — inside a pill whose height is 44. The consumer app has NO
 * shared CTA primitive at all — every CTA is hand-rolled per screen, and only
 * 6 of its 167 touchable-bearing files cap the multiplier — so there was no
 * single place a ceiling could live. This module is that place.
 *
 * ─── WHY 2, AND WHY THAT IS NOT A SHORTFALL ────────────────────────────────
 * WCAG 1.4.4 asks for 200 % resize without loss of content or functionality.
 * 200 % of the `md` label (14/20) is 28/40 pt, which is the largest label a
 * 44 pt pill hosts intact; 200 % of `lg` (16/24) is 32/48 inside a 52 pt pill.
 * So the cap IS the requirement, not a compromise against it — and the touch
 * target keeps its full height either way because the pill's vertical
 * constraint is `minHeight`, never `height`.
 *
 * At or below the cap these helpers are identity: nothing moves for the
 * overwhelming majority of users, who are at or near `fontScale === 1`.
 *
 * NOTE — `app/+not-found.tsx` keeps its own `CTA_MAX_FONT_SCALE` from #2180.
 * It is read BY PATH from the immutable `issue_2180_not_found_structure`
 * suite, so it is deliberately NOT moved here. Same number, same intent,
 * different owner.
 */

/**
 * The ceiling a CTA label's font multiplier is clamped to. See the header for
 * why 200 % is the requirement rather than a concession to it.
 */
export const BUTTON_MAX_FONT_SCALE = 2;

/**
 * Where "large text" begins. React Native's table puts the largest ORDINARY
 * step at 1.353 and the first ACCESSIBILITY step at 1.786, so 1.5 sits in the
 * gap between them and belongs to no real step in either direction.
 */
export const LARGE_TEXT_FONT_SCALE = 1.5;

/**
 * Where the ACCESSIBILITY-MAX band begins. RN's two largest steps are 3.059
 * and 3.571; 2.5 separates the merely-large accessibility sizes from the
 * extreme ones and, like 1.5, is not itself a step.
 */
export const ACCESSIBILITY_MAX_FONT_SCALE = 2.5;

/** The analytics bucket names. Kept narrow so a typo is a type error. */
export type TextSizeBucket =
  | "default"
  | "large"
  | "accessibility"
  | "accessibility_max";

/**
 * A non-finite or non-positive `fontScale` is not a real setting — it is a
 * platform that has not reported one yet. Treat it as 1 rather than letting a
 * NaN reach either the layout maths or PostHog.
 */
export function normalizeFontScale(fontScale: number): number {
  if (!Number.isFinite(fontScale) || fontScale <= 0) return 1;
  return fontScale;
}

/** True once the user has moved text beyond every ordinary step. */
export function isLargeText(fontScale: number): boolean {
  return normalizeFontScale(fontScale) >= LARGE_TEXT_FONT_SCALE;
}

/**
 * Coarse band for analytics. Four buckets, not twelve: the question this
 * answers is "how many of our users are in accessibility territory", and a
 * per-step histogram would be a high-cardinality property for no extra answer.
 */
export function textSizeBucket(fontScale: number): TextSizeBucket {
  const scale = normalizeFontScale(fontScale);
  if (scale >= ACCESSIBILITY_MAX_FONT_SCALE) return "accessibility_max";
  if (scale >= LARGE_TEXT_FONT_SCALE) return "accessibility";
  if (scale >= 1.15) return "large";
  return "default";
}

/**
 * The exact property bag registered with PostHog as super properties (i.e.
 * attached to EVERY subsequent event). #2211: before this, PostHog held zero
 * properties matching font / accessibility / scale / text_size across 30 days
 * of traffic — confirmed by query, not assumed — so the real-world exposure of
 * every Dynamic Type defect was unknowable from our own data.
 *
 * `font_scale` is rounded to 2 dp so the property does not acquire needless
 * cardinality from floating-point noise.
 */
export function textSizeAnalyticsProperties(fontScale: number): {
  font_scale: number;
  text_size_bucket: TextSizeBucket;
  is_large_text: boolean;
} {
  const scale = normalizeFontScale(fontScale);
  return {
    font_scale: Math.round(scale * 100) / 100,
    text_size_bucket: textSizeBucket(scale),
    is_large_text: isLargeText(scale),
  };
}
