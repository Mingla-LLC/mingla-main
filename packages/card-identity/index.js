/**
 * @mingla/card-identity — the ONLY place any Mingla place/plan card value exists.
 *
 * Issue #1609, Direction C ("PLATE"), wave 1. Enforced by
 * I-PROPOSED-C-CARD-IDENTITY-SINGLE-SOURCE.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A PACKAGE, AND WHY IT IS PLAIN .js
 *
 * Seven surfaces render this card: the Explorer deck (S1), the Discover/profile
 * grid tile (S2), the in-chat card (S3), the 4:5 share snippet (S4), the OG /
 * link-preview image (S5), the public web page (S6) and the expanded sheet (S7).
 * Three of them cannot import from `app-mobile/src` at all:
 *
 *   - S6 renders from `@mingla/offering-rendering` on react-native-web;
 *   - S5 renders in `mingla-business/server` under Node + satori (CommonJS);
 *   - I-MOR-0827-PACKAGE-ISOLATION forbids either reaching into an app's src/.
 *
 * So the values live in a package, and the package is **RN-free and
 * dependency-free**: plain data and pure functions. No JSX, no react-native
 * import, no CSS, no expo, nothing.
 *
 * It is `index.js` (CommonJS) + `index.d.ts` rather than the `index.ts` the
 * sibling packages use, and that is deliberate. The CI gate for this invariant
 * must IMPORT THE REAL FUNCTIONS and re-run an independent oracle over them
 * (#1607: six shipped guards assert something *adjacent* to the behaviour — one
 * is satisfied by a comment, one slices on an anchor string that is not in the
 * file). A gate that parsed a .ts file for numbers would be exactly that failure
 * again. CommonJS runs unmodified under Metro, tsc, `node --test` and satori.
 *
 * ---------------------------------------------------------------------------
 * WHAT "ONE OBJECT AT EVERY SIZE" MEANS, MEASURED
 *
 * A glass plate's appearance depends on what is behind it. On seven surfaces
 * with seven different scrim depths a FIXED recipe would produce seven
 * different-looking objects. So the recipe is not fixed; the RESULT is. The
 * plate is a two-layer stack over the blurred backdrop:
 *
 *     [ over  ] rgba(255,255,255,0.12)     — constant, the lift
 *     [ under ] rgba(12,14,18,u)           — u DERIVED per surface
 *     [ blurred backdrop: photo + scrim ]
 *
 * `u = plateUnderAlpha(alpha)` solves L*(composite) = 23.50 against the
 * worst-case backdrop (a pure-white photograph under the bottom scrim at its
 * alpha at the plate's top edge). Every surface therefore lands on the same
 * L*, so every text ratio ON the plate is identical everywhere. That is a
 * measured statement, not a stylistic one.
 *
 * The opaque path lands on the same number: PLATE.fallbackSolid rgb(53,56,63)
 * measures L* 23.47, i.e. ~0.03 L* from the glass composite, where the
 * just-noticeable difference for a large flat field is ~2-3 L*. Android,
 * satori and the CSS `@supports not (backdrop-filter)` fallback are therefore
 * the same colour as each other and invisibly close to iOS.
 *
 * ---------------------------------------------------------------------------
 * PROVENANCE
 *
 * The ramp stops, the top-scrim stops, the 200pt top height and the 0.60
 * plateau are inherited VERBATIM from `app-mobile/src/components/
 * deckHeroConstants.ts` on branch 1609-collapsed-card, where they were derived
 * against both a WCAG legibility floor and a CIE L* presence floor, and where
 * the plateau's 0.60 is bounded above by the notification-badge ring at
 * alpha <= 0.617. That derivation is not repeated here; it is preserved in the
 * re-export module's comments. Nothing in this file re-tunes it.
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// 1 · The scrims
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The two ramps. Four stops each, bottom-anchored and top-anchored.
 *
 * `bottom` deepens to 0.94 so its tail resolves toward a definite tone rather
 * than a dimmed photograph — at 0.94 only ~6% of the photo's own texture is
 * transmitted, which is what converts the band from "dim photograph" into
 * "designed layer".
 *
 * `top` holds a 0.60 plateau to 60% of 200pt = 120pt of card-local y, which
 * covers every safe-area inset up to 76pt. It is 0.60 and not a rounder,
 * darker number because the #eb7825 notification badge's opaque ring carries
 * its SC 1.4.11 boundary, and darkening the backdrop erodes exactly that
 * boundary: alpha <= 0.617 is a hard ceiling.
 */
const RAMP = {
  bottom: {
    colors: ['rgba(0,0,0,0)', 'rgba(0,0,0,0.42)', 'rgba(0,0,0,0.78)', 'rgba(0,0,0,0.94)'],
    locations: [0, 0.3, 0.62, 1],
    alphas: [0, 0.42, 0.78, 0.94],
  },
  top: {
    colors: ['rgba(0,0,0,0.60)', 'rgba(0,0,0,0.60)', 'rgba(0,0,0,0.30)', 'rgba(0,0,0,0)'],
    locations: [0, 0.6, 0.82, 1],
    alphas: [0.6, 0.6, 0.3, 0],
    heightPt: 200,
    /** Card-local y below which the plateau must still hold its full alpha. */
    plateauHoldsToPt: 120,
    /** The badge-ring ceiling that fixes the plateau at 0.60. */
    maxPlateauAlpha: 0.617,
  },
};

/**
 * THE ramp evaluator. One implementation, used by the app AND by the CI oracle.
 *
 * `d` is depth in points measured from the CARD's bottom edge; the scrim is
 * bottom-anchored with height `scrimH`, its gradient running location 0 (alpha
 * 0) at the scrim's TOP down to location 1 (alpha 0.94) at the card's bottom.
 * A point at depth `d` therefore sits at `t = (scrimH - d) / scrimH` along the
 * gradient.
 */
function rampAlphaAtDepth(d, scrimH) {
  if (!(scrimH > 0)) return 0;
  let t = (scrimH - d) / scrimH;
  if (t <= 0) return RAMP.bottom.alphas[0];
  if (t >= 1) return RAMP.bottom.alphas[RAMP.bottom.alphas.length - 1];
  const loc = RAMP.bottom.locations;
  const a = RAMP.bottom.alphas;
  for (let i = 1; i < loc.length; i += 1) {
    if (t <= loc[i]) {
      const span = loc[i] - loc[i - 1];
      const frac = span === 0 ? 0 : (t - loc[i - 1]) / span;
      return a[i - 1] + frac * (a[i] - a[i - 1]);
    }
  }
  return a[a.length - 1];
}

/**
 * The two alpha floors the scrim formula exists to guarantee, and the constants
 * back-solved from them.
 *
 *   K_PLATE = 1 / (1 - t(alpha 0.42)) — clause 1 guarantees scrim alpha >= 0.42
 *             at the plate's top edge. That is the plate's MATERIAL contract:
 *             below it, plateUnderAlpha would have to exceed 0.95 and the glass
 *             would stop being glass.
 *   K_TITLE = 1 / (1 - t(alpha 0.48)) — clause 2 guarantees scrim alpha >= 0.48
 *             at the title's top edge, back-solved from the 3:1 large-text
 *             floor with a 15% margin. dTitleTop is 0 when the title sits ON
 *             the plate, which self-disables the clause.
 */
const PLATE_ALPHA_FLOOR = 0.42;
const TITLE_ALPHA_FLOOR = 0.48;
const K_PLATE = 1.4286;
const K_TITLE = 1.5464;

/**
 * THE scrim formula. Every surface calls this. Nothing hard-codes a scrim
 * height, and nothing uses a percentage — a percentage makes the whole contrast
 * table valid only on the device it was computed on, which is why
 * `height: '52%'` / `'62%'` are deleted. Absolute points are also strictly
 * stronger I-PROPOSED-1593-LAYER-GEOMETRY-SINGLE-SOURCE compliance: no flex
 * axis, no dependence on a sibling or a resolved parent.
 *
 * Rounded UP to an even number of points so a 2x/3x raster never lands the
 * gradient's last row on a half-pixel, then clamped to the card.
 */
function scrimHeight(dPlateTop, dTitleTop, cardH) {
  const h = Math.ceil(Math.max(K_PLATE * dPlateTop, K_TITLE * dTitleTop));
  return Math.min(h + (h % 2), cardH - (cardH % 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 · Colour math (private — the CI oracle re-implements its own)
// ─────────────────────────────────────────────────────────────────────────────

function srgbChannelToLinear(c8) {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb) {
  return (
    0.2126 * srgbChannelToLinear(rgb[0]) +
    0.7152 * srgbChannelToLinear(rgb[1]) +
    0.0722 * srgbChannelToLinear(rgb[2])
  );
}

/** CIE L* from a relative luminance Y (D65, Y already normalised to 0..1). */
function lStarFromLuminance(y) {
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

function over(fg, alpha, bg) {
  return [
    fg[0] * alpha + bg[0] * (1 - alpha),
    fg[1] * alpha + bg[1] * (1 - alpha),
    fg[2] * alpha + bg[2] * (1 - alpha),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 · The plate — the one material
// ─────────────────────────────────────────────────────────────────────────────

const PLATE_BOUNDARIES = {
  standard: { color: 'rgba(255,255,255,0.38)', rgb: [255, 255, 255], alpha: 0.38, width: 1 },
  compact: { color: 'rgba(255,255,255,0.86)', rgb: [255, 255, 255], alpha: 0.86, width: 1 },
  ogOpaque: { color: 'rgba(255,255,255,0.48)', rgb: [255, 255, 255], alpha: 0.48, width: 1 },
};

const PLATE = {
  /** The invariant. Every surface's composite lands here, whatever its scrim. */
  targetLstar: 23.5,
  /** The constant lift. Never varies. */
  lift: 'rgba(255,255,255,0.12)',
  liftRgb: [255, 255, 255],
  liftAlpha: 0.12,
  /** The under-layer's colour; only its ALPHA is derived per surface. */
  underRgb: [12, 14, 18],
  /**
   * 1pt border.
   *
   * 0.38, NOT 0.30. SC 1.4.11 is satisfied by max(fill, border) across the FULL
   * photo-luminance range, not by either alone: on a bright photo the dark fill
   * carries it, on a dark photo the light border does. At 0.30 the boundary
   * measures 2.46:1 and FAILS. (2.46, not the 2.54 this docblock and the spec's
   * §3.2 both carried until #1609's tester re-derived it independently: the
   * oracle in __tests__/card_identity_single_source.test.mjs measures 2.4648
   * against this module's own scrimHeight/plateUnderAlpha. Below the 3.0 floor
   * either way — the value 0.38 is unchanged — but a negative control is only
   * useful if its number is the one the gate actually reports.) (For scale: the
   * shipped Discover
   * `bottomChip`'s 0.14 border measures 1.55:1 — a live failure.) 0.38 is a
   * value that had to be raised, not one that was inherited.
   */
  boundaries: PLATE_BOUNDARIES,
  border: PLATE_BOUNDARIES.standard.color,
  borderRgb: PLATE_BOUNDARIES.standard.rgb,
  borderAlpha: PLATE_BOUNDARIES.standard.alpha,
  borderWidth: PLATE_BOUNDARIES.standard.width,
  /** 1pt inset highlight at the top edge. Decorative. */
  topHighlight: 'rgba(255,255,255,0.50)',
  /**
   * Android + satori + the CSS `@supports not (backdrop-filter)` fallback.
   * L* 23.47 — matched to the glass composite, not to a badge composite.
   */
  fallbackSolid: 'rgb(53,56,63)',
  fallbackSolidRgb: [53, 56, 63],
  blurIntensity: 18,
  /**
   * 'light', NOT 'dark', and this is load-bearing.
   *
   * expo-blur's dark tint lays its OWN darkening over the backdrop before any
   * fill applies, so a dark tint plus a white lift partially cancel — measured
   * on device at #1609, a predicted +11.8 L* lift landed at +3 to +5. And on a
   * scrim the blur has nothing to blur anyway (convolving a smooth gradient is
   * a visual no-op), so a dark tint contributes only suppression. Do not
   * "fix" this to 'dark'.
   */
  blurTint: 'light',
};

/**
 * THE plate's under-layer alpha. Derived, never chosen.
 *
 * Solves `L*(lift over under over backdrop) = PLATE.targetLstar`, where the
 * backdrop is the worst case the rest of the system is derived against: a
 * pure-white photograph with the bottom scrim at `scrimAlphaAtPlateTop` over
 * it. Monotonic in u, so a bisection is exact to machine precision and needs no
 * solver dependency.
 *
 * Returned rounded to 3dp because that is the precision the renders and
 * frozen_c.json are frozen at, and an un-rounded value would make the CI
 * oracle's equality checks depend on float noise.
 */
function plateUnderAlpha(scrimAlphaAtPlateTop) {
  const backdropChannel = 255 * (1 - scrimAlphaAtPlateTop);
  const backdrop = [backdropChannel, backdropChannel, backdropChannel];
  const lStarForU = (u) =>
    lStarFromLuminance(
      relativeLuminance(over(PLATE.liftRgb, PLATE.liftAlpha, over(PLATE.underRgb, u, backdrop))),
    );
  // L* decreases as u increases (the under-layer is near-black).
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (lStarForU(mid) > PLATE.targetLstar) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 1000) / 1000;
}

/**
 * The plate's row geometry, derived from its outer height.
 *
 * The plate is a FIXED RECTANGLE with no data-dependent height: rows are
 * fixed-height with content vertically centred, so a 1-line meta and an absent
 * meta occupy the same box. React Native's box model always includes the
 * border in `height`, so the content box is `plateH - 2 * borderWidth` and the
 * control row takes the remainder. That single subtraction is the whole
 * silhouette, and it is asserted rather than commented.
 *
 * `withMeta === false` is the ONE alternate silhouette in the entire system:
 * when the meta row would be empty (no rating, no price, no distance, no
 * category — vacuity-guarded), the FACTS ROW is omitted and the plate is
 * PLATE_H_NO_META instead of PLATE_H. The card's bottom edge, the plate's
 * bottom edge and the plate's left/right edges never move.
 *
 * ---------------------------------------------------------------------------
 * THE DIVIDER IS NEVER OMITTED (Seth, #1609 comment 5196932627, 2026-08-05)
 *
 * §3.6 used to drop the divider WITH the meta row. The divider carries the
 * chevron, and the chevron is the card's only visible expand affordance — it
 * exists because "Details" was rejected in favour of a view affordance. Taking
 * it away on the sparsest card in the pool inverts that decision at exactly the
 * moment the user has least to go on: a place with no rating, no price, no
 * distance and no category then renders with nothing at all to say it opens.
 * The tester confirmed it on device (P3-1). So the divider is a constant row of
 * this object, and only the FACTS row is data-dependent.
 *
 * `clearance` is what that costs, and it is why the short plate is NOT simply
 * `plateH - META_ROW_H`. The chevron is `CHEVRON.size` tall and centred on the
 * divider LINE, so it reaches `(CHEVRON.size - DIVIDER_H) / 2` above it. On the
 * full plate that overhang lands in the meta row's own vertical slack and costs
 * nothing. With the facts row gone there is no row above the divider at all,
 * and the plate clips (`overflow:'hidden'`), so the overhang has to be reserved
 * explicitly — otherwise the divider coincides with the plate's 1pt top
 * highlight and the chevron is sliced in half by the plate's own top edge.
 *
 * Below the divider NOTHING changes: `control` is the same height in both
 * silhouettes, so the Been-here pill and the share glyph sit exactly where they
 * sit on the 96pt plate. That is the whole point of "the chevron sits in it
 * exactly as it does on the 96pt plate".
 */
const META_ROW_H = 40;
const DIVIDER_H = 1;

/**
 * ISSUE #1700 — THE WRAPPING LAW, AND WHY IT COSTS A THIRD SILHOUETTE.
 *
 * Seth, 2026-08-07: *"I want everything to take one line but when something is
 * cut off, or bleeds out of the box, it should go to the next line so everything
 * is visible."*
 *
 * The facts line used to be `numberOfLines={1}` + `ellipsizeMode="tail"`, which
 * is how "★ 4.6 · 20.9 mi · Icebreakers" became "★ 4.6 · 20.9 mi · Icebrea…" —
 * the fact a user swiped for, silently deleted, on a plate with 20pt of unused
 * vertical slack directly above it.
 *
 * So the meta row may now hold TWO lines, and the plate grows by exactly one
 * line box to hold them. Everything from the divider DOWN is byte-identical in
 * all three silhouettes — the pill and the share glyph never move — and the
 * plate's bottom and side edges never move either. Only its TOP edge rises.
 *
 * ---------------------------------------------------------------------------
 * AND THAT TOP EDGE IS NOT FREE. Measured, not assumed:
 *
 *   silhouette   plate top   scrim alpha there   title top   title contrast
 *   no meta          80          0.8334            172          5.64:1
 *   one line        112          0.7908            204          3.73:1
 *   two lines       131          0.7411            223          2.96:1   <-- FAIL
 *
 * A taller plate pushes the TITLE into a thinner part of the scrim, and against
 * a pure-white photograph 30/700 text landed at 2.96:1 — under the 3.0 floor
 * SC 1.4.3 sets for large text. Growing the plate without touching the scrim
 * would have shipped a WCAG failure that no screenshot review could catch.
 *
 * THE FIX IS NOT A PER-CARD SCRIM. `surfaceScrimHeight`'s docblock is right that
 * a scrim whose height varied per card would make the deck's dark band jump on
 * every swipe. It stays ONE number — solved from the TALLEST silhouette the
 * surface can produce rather than from its canonical one. 316 -> 346pt (44.2% of
 * a 783pt card). Every shallower silhouette then gets strictly MORE contrast,
 * which is the same argument the short plate already relied on:
 *
 *   silhouette   title contrast @316   @346
 *   no meta            5.64             6.93
 *   one line           3.73             4.66
 *   two lines          2.96             3.74
 *
 * The plate's own tone is held at L* 23.50 in all three by re-deriving its
 * under-layer alpha at its actual top edge (`plateUnderForHeight`) — the plate
 * does not lighten as it grows, it compensates.
 */
const META_LINES_MAX = 2;

/**
 * The meta line's line box. Derived from the surface's own `metaSize` so a
 * second line cannot be measured against a number that lives in one app's
 * StyleSheet — `deckCardPlate.tsx` carried a hardcoded `lineHeight: 19` that
 * nothing here knew about, and the two-line row is `META_ROW_H + this`.
 *
 * 1.36 reproduces that shipped 19 at `metaSize: 14` exactly (14 * 1.36 = 19.04),
 * so no surface's one-line rendering moves by a pixel.
 */
const META_LH_RATIO = 1.36;

function metaLineHeight(surfaceKey) {
  const s = SURFACES[surfaceKey];
  if (!s) throw new Error(`@mingla/card-identity: unknown surface "${surfaceKey}"`);
  return Math.round(s.metaSize * META_LH_RATIO);
}

/** The meta row's height for `lines` lines on a surface. 0 lines = no row. */
function metaRowHeight(lines, surfaceKey) {
  if (!lines || lines < 1) return 0;
  return META_ROW_H + (Math.min(lines, META_LINES_MAX) - 1) * metaLineHeight(surfaceKey);
}

/**
 * The no-facts plate, PER SURFACE.
 *
 * `PLATE_H_NO_META` is 64, and its docblock says plainly that it is *S1's*
 * alternate silhouette — but it is a bare constant, so anything that reached for
 * "the plate with no facts" got S1's number whatever surface it was on. On
 * s3Chat, whose whole plate is 56pt, that is 8pt TALLER than the plate it is
 * supposedly a shortened version of, and it lands the plate's top edge at a
 * scrim alpha of 0.3043 — under the 0.42 material floor. Found by #1700's
 * silhouette sweep; the constant was never wrong for S1 and never right anywhere
 * else, and nothing had ever asked.
 *
 * The alternate exists only where the composition it is derived FROM exists: the
 * facts row swapped for the chevron's clearance, with the divider surviving. That
 * is the control-surface composition. A surface with no controls has no chevron,
 * so it has no clearance to reserve and no alternate — its plate keeps its
 * canonical height and simply renders no facts in it.
 */
function plateHeightNoMeta(surfaceKey) {
  const s = SURFACES[surfaceKey];
  if (!s) throw new Error(`@mingla/card-identity: unknown surface "${surfaceKey}"`);
  if (!s.controls) return s.plateH;
  return s.plateH - META_ROW_H + CHEVRON_CLEARANCE;
}

/** The plate's outer height for `lines` lines of facts on a surface. */
function plateHeightForMetaLines(surfaceKey, lines) {
  const s = SURFACES[surfaceKey];
  if (!s) throw new Error(`@mingla/card-identity: unknown surface "${surfaceKey}"`);
  if (!lines || lines < 1) return plateHeightNoMeta(surfaceKey);
  return s.plateH + (Math.min(lines, s.metaLines) - 1) * metaLineHeight(surfaceKey);
}

/**
 * `meta` is the LINE COUNT (0, 1 or 2). `true`/`false` are still accepted and
 * mean 1 and 0 — every pre-#1700 call site and the oracle's own G3b assertions
 * pass booleans, and silently reinterpreting `true` as something other than one
 * line is how a compatibility shim becomes a bug.
 */
function plateRows(plateH, meta, surfaceKey) {
  const lines = meta === true ? 1 : meta === false ? 0 : Number(meta) || 0;
  const content = plateH - 2 * PLATE.borderWidth;
  const metaH = metaRowHeight(lines, surfaceKey || 's1Single');
  // NEVER conditional. See the docblock: the divider carries the affordance.
  const divider = DIVIDER_H;
  // Forward reference to section 4 — `plateRows` is only ever CALLED after this
  // module has finished evaluating, so there is no temporal-dead-zone hazard,
  // and CHEVRON_CLEARANCE belongs with the chevron it is derived from.
  const clearance = lines >= 1 ? 0 : CHEVRON_CLEARANCE;
  return { meta: metaH, divider, clearance, control: content - metaH - divider - clearance };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · Plate furniture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The meta line is ONE Text with weighted spans, not a middot-separated line at
 * one weight — that is a flatter version of the problem C exists to fix.
 *
 *     * 4.4  ·  6.7 mi  ·  ££  ·  Whiskey Bar
 *     └─700─┘  └──500 @1.0──┘   └─500 @0.72─┘
 *
 * ORDER IS TRUNCATION PRIORITY. Tail-ellipsis eats the last span first, so the
 * least valuable fact sits last on purpose. Separators render BETWEEN PRESENT
 * SPANS ONLY — never leading, never trailing (Constitution 9).
 *
 * The separators stay at 0.45 (3.98:1) and are treated as non-text structural
 * marks: they carry no information and are never announced, because the
 * composed accessibility label joins with commas.
 */
const META = {
  /** The only fact that ranks places against each other. */
  rating: { weight: '700', color: '#FFFFFF' },
  /** The feasibility facts. */
  fact: { weight: '500', color: '#FFFFFF' },
  /** Structure, not content. */
  separator: { weight: '500', color: 'rgba(255,255,255,0.45)', text: ' · ' },
  /** Recedes, and is the sacrificial tail. */
  tail: { weight: '500', color: 'rgba(255,255,255,0.72)' },
};

/** 1pt, rendered as TWO segments leaving a gap the chevron sits in. */
const DIVIDER = {
  color: 'rgba(255,255,255,0.22)',
  height: DIVIDER_H,
  /**
   * THE CHEVRON BREAKS THE DIVIDER. A 16pt chevron-up sits centred in a 28pt
   * gap between the two divider segments, so the affordance is part of the
   * object's construction rather than a sticker on it. It replaces the word
   * "Details". pointerEvents 'none', zero gesture owners.
   */
  gap: 28,
};

const CHEVRON = { color: 'rgba(255,255,255,0.72)', size: 16 };

/**
 * The points the short plate must reserve ABOVE the divider so the chevron is
 * drawn whole.
 *
 * The chevron's box is centred on the 1pt divider line, so it reaches
 * `(CHEVRON.size - DIVIDER_H) / 2` = 7.5pt above that line's top edge. Rounded
 * UP to a whole point: the plate is a raster-aligned rectangle and a half-point
 * of reserved space would put the divider — and therefore the chevron — on a
 * half-pixel at 2x. Rounding DOWN instead would clip half a point of the icon
 * off the plate's top edge, which is the exact defect this constant exists to
 * prevent.
 *
 * It is ZERO on the full plate: there the meta row sits above the divider and
 * its own vertical slack (40pt row, 19pt line, centred → 10.5pt each side)
 * already absorbs the overhang.
 */
const CHEVRON_CLEARANCE = Math.ceil((CHEVRON.size - DIVIDER_H) / 2);

const SHARE_GLYPH = { color: 'rgba(255,255,255,0.90)', size: 20, target: 44 };

/**
 * The saved / scheduled state discs, top-right, on the top scrim. Same material
 * recipe as the plate so the card has exactly one glass vocabulary.
 */
const STATE_DISC = { size: 28, radius: 14, top: 14, right: 16, gap: 6 };

/**
 * Been There. No question mark, ever.
 *
 * Press -> green "Thank you" (~1400ms) -> settled green and checked. THREE
 * non-colour channels carry the state — glyph, copy, and fill category — so the
 * state never depends on colour alone.
 *
 * THE BORDER IS LOAD-BEARING. The control sits ON the plate and its fill is the
 * same family as the plate's, so the boundary is carried by the border alone:
 * the minimum white border alpha for a 3:1 boundary against the plate is 0.349.
 * A 0.30 border would fail. It is 0.46 here.
 *
 * `inFlightAfterMs` is #1618: the write is not instant and nothing visual bound
 * to `inFlight`, so a user tapped and the control looked EXACTLY as it had
 * before — for a measured 75 seconds. A spinner appears past this threshold;
 * below it the press feedback alone is the signal, because flashing a spinner
 * on a 300ms write is worse than none.
 */
const BEEN_HERE = {
  height: 44,
  paddingHorizontal: 14,
  borderRadius: 22,
  borderWidth: 1,
  gap: 6,
  labelSize: 13,
  labelWeight: '500',
  glyphSize: { rest: 16, active: 18 },
  spinnerSize: 14,
  inFlightAfterMs: 6000,
  flashHoldMs: 1400,
  states: {
    rest: {
      fill: 'rgba(255,255,255,0.14)',
      border: 'rgba(255,255,255,0.46)',
      androidFill: 'rgb(77,77,77)',
      androidBorder: 'rgb(143,143,143)',
    },
    pressed: {
      fill: 'rgba(255,255,255,0.24)',
      border: 'rgba(255,255,255,0.46)',
      androidFill: 'rgb(98,98,98)',
      androidBorder: 'rgb(143,143,143)',
    },
    flash: {
      fill: 'rgba(34,197,94,0.42)',
      border: 'rgba(134,239,172,0.66)',
      androidFill: 'rgb(19,113,54)',
      androidBorder: 'rgb(98,175,126)',
    },
    settled: {
      fill: 'rgba(34,197,94,0.42)',
      border: 'rgba(134,239,172,0.66)',
      androidFill: 'rgb(19,113,54)',
      androidBorder: 'rgb(98,175,126)',
    },
    failed: {
      fill: 'rgba(185,28,28,0.60)',
      border: 'rgba(254,202,202,0.72)',
      androidFill: 'rgb(140,21,21)',
      androidBorder: 'rgb(199,158,158)',
    },
  },
};

/**
 * The curated mark — the sliver stack. Two slivers peeking above the plate's
 * top edge, and that stack is the ENTIRE curated identity: no text, no colour,
 * no extra image decode, no gesture owner. It reads at 402pt and at 173pt for
 * the same reason — it is the object's silhouette, not a label on it.
 *
 * `offsets` are measured UP from the plate's top edge, so sliver1's bottom edge
 * sits flush on the plate and sliver2 sits 6pt above it (4pt tall + a 2pt gap).
 *
 * CORRECTED ALPHAS. The design's first pass claimed the stack had "zero
 * contrast risk (each sliver carries its own fill)". That was wrong: a sliver's
 * fill is a translucent white over the SCRIM, and what matters is its ratio
 * against the scrim immediately around it, which is nearly the same tone. At
 * the originally specified 0.34 / 0.22 they measure 2.85:1 and 1.98:1 and FAIL
 * SC 1.4.11 (which applies, because the stack is the sole curated marker).
 * 0.44 / 0.44 measure 3.69:1 and 3.60:1.
 */
/**
 * #1701 — DETAILS, the labelled way into the card.
 *
 * Seth, 2026-08-07: "I want a button beside been there which indicates view more
 * with an eye icon." The chevron stays — he kept it deliberately at #1609 and it
 * is the gesture hint. This is the affordance for everyone who never discovers
 * a chevron, which on a card whose whole face is the tap target is most people.
 *
 * IT IS BEEN-HERE'S GEOMETRY, NOT A NEW SHAPE. Height, radius, border width,
 * gap, label size and label weight are all read from `BEEN_HERE` below rather
 * than retyped, because the two sit side by side in one row and a 2pt disagreement
 * between them reads as a mistake. Only the FILL differs, and that difference is
 * the whole point: one control records something about the past, the other opens
 * something. Measured against the plate's own L* 23.50:
 *
 *     white label on the orange fill ....... 8.74:1   (AA needs 4.5)
 *     the border against the plate ......... 3.84:1   (SC 1.4.11 needs 3.0)
 *     the fill against the plate ........... 1.34:1   -- NOT a boundary
 *
 * The border is Been-here's `rgba(255,255,255,0.46)` and not an orange one, and
 * that is deliberate: an orange border needs alpha 0.70 to reach 3:1 against the
 * plate, at which point it reads hotter than the accent it is edging. The fill
 * carries the accent; the border carries the boundary. Those are different jobs
 * and giving both to one colour is what forces the 0.70.
 */
const DETAILS = {
  fill: 'rgba(235,120,37,0.22)',
  fillPressed: 'rgba(235,120,37,0.32)',
  /** Android's plate is opaque, so the composites are pre-solved. */
  androidFill: 'rgb(93,70,57)',
  androidFillPressed: 'rgb(111,76,55)',
  color: '#FFFFFF',
};

const SLIVER = {
  height: 4,
  radius: 2,
  offsets: [0, 6],
  insets: [24, 34],
  alpha: 0.44,
  boundaries: {
    none: { color: 'rgba(0,0,0,0)', rgb: [0, 0, 0], alpha: 0, width: 0 },
    compact: { color: 'rgba(0,0,0,0.56)', rgb: [0, 0, 0], alpha: 0.56, width: 0.5 },
  },
};

/**
 * The drag handle, for a surface that draws its own (S7 — the expanded sheet's
 * hero, where gorhom's handle is suppressed so it cannot push the hero down and
 * put white above the photograph).
 *
 * IT SITS ON AN UNKNOWN PHOTOGRAPH, WITH NO TOP SCRIM UNDER IT. `200 + 316 = 516`
 * of a 520pt hero would leave 4pt of clean photograph, so the top scrim is
 * omitted and the handle has to carry its own boundary.
 *
 * The construction is OPAQUE CORE + DARK RING, the same two-tone answer the
 * S2/S3 slivers use, so the system has one answer to "a light mark on an unknown
 * photograph". Swept over 41 photo luminances, `max(fill, ring)` measures 4.10:1
 * worst case against a 3.0 floor. The obvious first try — a 0.90 white over a
 * 0.45 black ring — measures 2.65:1 and FAILS, because both layers are
 * translucent and therefore fail in the SAME place: on a mid-grey photo the fill
 * and the ring converge on the backdrop together.
 *
 * `coverlessFill` is the one case where a translucent handle is safe: the
 * coverless hero is a known solid slab, so there is no photograph to fail
 * against and the ring would be a border around nothing.
 */
const HANDLE = {
  width: 36,
  height: 5,
  radius: 2.5,
  top: 10,
  target: 44,
  fill: '#FFFFFF',
  ringWidth: 0.5,
  ring: 'rgba(0,0,0,0.75)',
  coverlessFill: 'rgba(255,255,255,0.90)',
};

// ─────────────────────────────────────────────────────────────────────────────
// 5 · The type ladder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * k = w / 402, then snapped to an existing token. The ladder terminates exactly
 * on a shipped component without being fitted to it: S2's 14/600 title and
 * 11/500 meta at rgba(255,255,255,0.72) are the values
 * `glass.discover.card.bottomChip` already ships.
 *
 * Dynamic Type is CAPPED, not disabled. At the cap the meta line still fits one
 * line because the plate is a fixed rectangle and the row ellipsises rather
 * than growing.
 */
const MAX_FONT_SCALE = { title: 1.4, meta: 1.3, controlLabel: 1.2 };

function typeLadder(surfaceKey) {
  const s = SURFACES[surfaceKey];
  if (!s) throw new Error(`@mingla/card-identity: unknown surface "${surfaceKey}"`);
  return {
    title: { size: s.titleSize, lineHeight: s.titleLH, lines: s.titleLines, weight: s.titleWeight },
    meta: { size: s.metaSize, weight: '500', lines: 1 },
    plateRadius: s.plateR,
    sliverHeight: s.sliver.height,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6 · The seven surface descriptors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every surface that renders this card, with the values its geometry is
 * DERIVED from. The CI oracle iterates this map, so a new surface cannot be
 * added without entering the oracle — that is assertion G3 of
 * I-PROPOSED-C-CARD-IDENTITY-SINGLE-SOURCE.
 *
 * `tier` encodes the degradation ladder:
 *   L1 (truth)      — the control row renders IFF the surface accepts touch AND
 *                     owns the primary interaction. Everywhere else a Been-here
 *                     button is a lie about affordance. That is a truth rule,
 *                     not a size rule.
 *   L2 (proportion) — the photograph retains >= 60% of the card's height, and
 *                     the name sits ON the photograph while the plate alone is
 *                     <= 20% of card height, joining the plate above that. The
 *                     60% floor is the retention of the SHIPPED Discover tile
 *                     (64.2%), so the rule is calibrated to a thing that works.
 *
 * S5 is the one declared exception to L2's name clause: at 26.7% the name
 * should join the plate, and it does not, because S5 is the only LANDSCAPE
 * surface in the system (1.9:1 against 0.51-1.10 everywhere else) and a plate
 * carrying a 56px name plus a meta line would bury the cover. The exception is
 * declared rather than hidden behind a re-fitted threshold.
 *
 * `topScrim: false` on S6 phone because 200 + 316 > 480 — a web page has no
 * floating chrome over the hero to protect, so the top scrim is omitted rather
 * than allowed to overlap and invalidate the bottom ramp's arithmetic.
 */
const SURFACES = {
  s1Single: {
    label: 'S1 deck card — single place',
    w: 402, h: 783, cardR: 40,
    sideInset: 14, bottomInset: 16,
    plateW: 374, plateH: 96, plateR: 24,
    titleSize: 30, titleLH: 36, titleLines: 2, titleWeight: '700', titleInset: 20,
    metaSize: 14,
    metaLines: 2,
    gap: 20,
    titleOnPlate: false,
    controls: true,
    topScrim: true,
    curated: false,
    plateBoundary: 'standard',
    sliverBoundary: 'none',
    sliver: { height: 4, radius: 2, alpha: 0.44, opaque: ['rgb(143,143,143)', 'rgb(145,145,145)'], forcedOpaque: false },
  },
  s1Curated: {
    label: 'S1 deck card — curated plan',
    w: 402, h: 783, cardR: 40,
    sideInset: 14, bottomInset: 16,
    plateW: 374, plateH: 96, plateR: 24,
    titleSize: 30, titleLH: 36, titleLines: 2, titleWeight: '700', titleInset: 20,
    metaSize: 14,
    metaLines: 2,
    gap: 20,
    titleOnPlate: false,
    controls: true,
    topScrim: true,
    curated: true,
    plateBoundary: 'standard',
    sliverBoundary: 'none',
    sliver: { height: 4, radius: 2, alpha: 0.44, opaque: ['rgb(143,143,143)', 'rgb(145,145,145)'], forcedOpaque: false },
  },
  s2Grid: {
    label: 'S2 Discover / profile grid tile',
    w: 173, h: 240, cardR: 24,
    sideInset: 10, bottomInset: 10,
    plateW: 153, plateH: 76, plateR: 14,
    titleSize: 14, titleLH: 18, titleLines: 2, titleWeight: '600', titleInset: 10,
    metaSize: 11,
    metaLines: 1,
    gap: 0,
    titleOnPlate: true,
    controls: false,
    topScrim: false,
    curated: true,
    plateBoundary: 'compact',
    sliverBoundary: 'compact',
    sliver: { height: 2, radius: 1, alpha: 0.96, opaque: ['rgb(255,255,255)', 'rgb(255,255,255)'], forcedOpaque: true },
  },
  s3Chat: {
    label: 'S3 in-chat card',
    w: 241, h: 220, cardR: 16,
    sideInset: 8, bottomInset: 8,
    plateW: 225, plateH: 56, plateR: 14,
    titleSize: 18, titleLH: 22, titleLines: 2, titleWeight: '600', titleInset: 8,
    metaSize: 13,
    metaLines: 1,
    gap: 0,
    titleOnPlate: true,
    controls: false,
    topScrim: false,
    curated: true,
    plateBoundary: 'compact',
    sliverBoundary: 'compact',
    sliver: { height: 2, radius: 1, alpha: 0.96, opaque: ['rgb(255,255,255)', 'rgb(255,255,255)'], forcedOpaque: true },
  },
  s4Snippet: {
    label: 'S4 4:5 share snippet',
    w: 360, h: 450, cardR: 32,
    sideInset: 13, bottomInset: 14,
    plateW: 334, plateH: 40, plateR: 22,
    titleSize: 27, titleLH: 33, titleLines: 2, titleWeight: '700', titleInset: 18,
    metaSize: 13,
    metaLines: 1,
    gap: 18,
    titleOnPlate: false,
    controls: false,
    topScrim: false,
    curated: true,
    plateBoundary: 'standard',
    sliverBoundary: 'none',
    sliver: { height: 4, radius: 2, alpha: 0.42, opaque: ['rgb(133,133,133)', 'rgb(135,135,135)'], forcedOpaque: false, insets: [25, 35] },
  },
  s5Og: {
    label: 'S5 OG / link-preview image',
    w: 1200, h: 630, cardR: 0,
    sideInset: 56, bottomInset: 48,
    plateW: 1088, plateH: 168, plateR: 28,
    titleSize: 56, titleLH: 64, titleLines: 1, titleWeight: '800', titleInset: 56,
    metaSize: 30,
    metaLines: 1,
    gap: 28,
    titleOnPlate: false,
    controls: false,
    topScrim: false,
    curated: true,
    /** satori has no backdrop-filter, so this surface is opaque by construction. */
    opaqueOnly: true,
    plateBoundary: 'ogOpaque',
    sliverBoundary: 'none',
    sliver: { height: 12, radius: 6, alpha: 0.54, alpha2: 0.58, opaque: ['rgb(176,176,176)', 'rgb(187,187,187)'], forcedOpaque: true, insets: [66, 76] },
  },
  s6Phone: {
    label: 'S6 public web page — phone breakpoint',
    w: 390, h: 480, cardR: 24,
    sideInset: 16, bottomInset: 16,
    plateW: 358, plateH: 96, plateR: 22,
    titleSize: 30, titleLH: 36, titleLines: 2, titleWeight: '700', titleInset: 16,
    metaSize: 14,
    metaLines: 2,
    gap: 20,
    titleOnPlate: false,
    controls: true,
    topScrim: false,
    curated: true,
    plateBoundary: 'standard',
    sliverBoundary: 'none',
    sliver: { height: 4, radius: 2, alpha: 0.44, opaque: ['rgb(143,143,143)', 'rgb(145,145,145)'], forcedOpaque: false, insets: [24, 34] },
  },
  /**
   * S7 — the expanded sheet's hero (#1605 wave 4).
   *
   * THE PLATE IS BYTE-IDENTICAL TO S1's, AND THAT IS THE WHOLE DESIGN. Opening a
   * card must CONTINUE it rather than cut to a new screen, so the hero puts the
   * same 374 x 96 r24 plate at the same 14/16 inset with the same 20pt gap and
   * the same 30/36 two-line title. Because `scrimHeight` reads only the plate's
   * CARD-LOCAL geometry, that alone forces H = 316, alpha = 0.791, u = 0.622 and
   * therefore every ratio on the plate to equal s1Single's — measured, not
   * asserted (the oracle's T-2/T-3/T-4/T-7 iterate this descriptor like any
   * other, and T-10 below pins the height-independence).
   *
   * `h: 432` IS THE CLAMP MINIMUM, NOT A FIXED HEIGHT. S7 is the first surface
   * whose height varies with the device:
   *
   *     heroH = min(520, max(432, sheetH - 216))
   *
   * `scrimHeight` clamps to `cardH`, so a SMALLER h can only SHORTEN the scrim —
   * entering the minimum is entering the worst case, and 432 > 316 proves the
   * clamp never binds anywhere in the range. T-10 asserts that across the whole
   * range rather than trusting the argument.
   *
   * `topScrim: false`: 200 (top) + 316 (bottom) = 516 of a 520pt hero would leave
   * 4pt of clean photograph at the clamp MAXIMUM and does not fit at the minimum
   * at all. The one piece of chrome that sat on the top scrim — the drag handle —
   * carries its own two-tone boundary instead (opaque white core + dark ring,
   * 4.10:1 worst case over a 41-luminance sweep).
   *
   * `controls: true` by rule L1: the sheet accepts touch AND owns the primary
   * interaction, so the Been-here control belongs here. That is what makes it
   * reachable from the six entry points that have no collapsed card behind them.
   */
  s7Expanded: {
    label: 'S7 expanded sheet — hero',
    w: 402, h: 432, cardR: 28,
    sideInset: 14, bottomInset: 16,
    plateW: 374, plateH: 96, plateR: 24,
    titleSize: 30, titleLH: 36, titleLines: 2, titleWeight: '700', titleInset: 20,
    metaSize: 14,
    metaLines: 2,
    gap: 20,
    titleOnPlate: false,
    controls: true,
    topScrim: false,
    curated: true,
    plateBoundary: 'standard',
    sliverBoundary: 'none',
    sliver: { height: 4, radius: 2, alpha: 0.44, opaque: ['rgb(143,143,143)', 'rgb(145,145,145)'], forcedOpaque: false },
  },
};

/** The package-owned plate boundary selected by a surface descriptor. */
function surfacePlateBoundary(surfaceKey) {
  const s = SURFACES[surfaceKey];
  if (!s) throw new Error(`@mingla/card-identity: unknown surface "${surfaceKey}"`);
  return PLATE.boundaries[s.plateBoundary];
}

/** The package-owned curated-sliver boundary selected by a surface descriptor. */
function surfaceSliverBoundary(surfaceKey) {
  const s = SURFACES[surfaceKey];
  if (!s) throw new Error(`@mingla/card-identity: unknown surface "${surfaceKey}"`);
  return SLIVER.boundaries[s.sliverBoundary];
}

/**
 * S7's hero height, from the sheet's own resolved height. The ONE variable
 * height in the system, and it is a FUNCTION so no surface can retype it.
 *
 *     216 = 92 (the action band) + 120 (five lines of description) + 4
 *
 * The fold is sized to PROVE there is more below it; the hero takes what is
 * left, bounded to [432, 520]. Every ratio in the S7 column is invariant across
 * that range because `scrimHeight` clamps to `cardH` and 432 > 316 (T-10).
 */
const S7_HERO_MIN = 432;
const S7_HERO_MAX = 520;
const S7_FOLD_RESERVE = 216;

function expandedHeroHeight(sheetH) {
  if (!(sheetH > 0)) return S7_HERO_MIN;
  return Math.min(S7_HERO_MAX, Math.max(S7_HERO_MIN, sheetH - S7_FOLD_RESERVE));
}

/**
 * The COVERLESS hero. There is no photograph, so there is no glass — the
 * material needs media and there is none. The hero collapses to ONE slab of
 * `PLATE.fallbackSolid` (L* 23.47, i.e. 0.01 L* from the glass composite), not a
 * plate drawn on a slab: a plate on a same-toned slab has only its 0.38 border to
 * separate it, which is furniture pretending to be structure.
 *
 *     232 = 132 (title bottom) + 2 x 36 (two title lines) + 20 (breathing) + 8
 *
 * Derived from `titleBottom('s7Expanded')` and the descriptor's own type ladder
 * so it cannot drift from the plate it is shaped around.
 */
const S7_COVERLESS_TOP_BREATHING = 20;
const S7_COVERLESS_TOP_PAD = 8;

function expandedCoverlessHeroHeight() {
  const s = SURFACES.s7Expanded;
  return (
    titleBottom('s7Expanded') +
    s.titleLines * s.titleLH +
    S7_COVERLESS_TOP_BREATHING +
    S7_COVERLESS_TOP_PAD
  );
}

/**
 * The two depths every derived value hangs off, in points from the card's
 * bottom edge. Both are FUNCTIONS of the descriptor, never typed in.
 *
 * `dTitleTop` is 0 when the title sits on the plate, which self-disables the
 * title clause of the scrim formula.
 */
function plateTopDepth(surfaceKey) {
  const s = SURFACES[surfaceKey];
  if (!s) throw new Error(`@mingla/card-identity: unknown surface "${surfaceKey}"`);
  return s.bottomInset + s.plateH;
}

function titleBottom(surfaceKey, plateH) {
  const s = SURFACES[surfaceKey];
  if (!s) throw new Error(`@mingla/card-identity: unknown surface "${surfaceKey}"`);
  if (s.titleOnPlate) return 0;
  return s.bottomInset + (plateH == null ? s.plateH : plateH) + s.gap;
}

function titleTopDepth(surfaceKey) {
  const s = SURFACES[surfaceKey];
  if (!s) throw new Error(`@mingla/card-identity: unknown surface "${surfaceKey}"`);
  if (s.titleOnPlate) return 0;
  return titleBottom(surfaceKey) + s.titleLines * s.titleLH;
}

/**
 * #1700 — the same two depths, for ANY silhouette the surface can produce.
 *
 * `plateTopDepth` / `titleTopDepth` answer for the canonical one-line plate and
 * keep doing so; these take the line count. They exist so the scrim solver and
 * the CI oracle can sweep EVERY silhouette instead of trusting that the
 * canonical one is the worst case — which, from #1700, it is not.
 *
 * `lines` of 0 is the no-facts plate (PLATE_H_NO_META), 1 the canonical one,
 * and up to `SURFACES[key].metaLines` the wrapped one.
 */
function plateTopDepthForLines(surfaceKey, lines) {
  const s = SURFACES[surfaceKey];
  if (!s) throw new Error(`@mingla/card-identity: unknown surface "${surfaceKey}"`);
  return s.bottomInset + plateHeightForMetaLines(surfaceKey, lines);
}

function titleTopDepthForLines(surfaceKey, lines) {
  const s = SURFACES[surfaceKey];
  if (!s) throw new Error(`@mingla/card-identity: unknown surface "${surfaceKey}"`);
  if (s.titleOnPlate) return 0;
  return plateTopDepthForLines(surfaceKey, lines) + s.gap + s.titleLines * s.titleLH;
}

/** Every silhouette a surface can render, shallowest plate first: [0, 1, ... metaLines]. */
function surfaceSilhouettes(surfaceKey) {
  const s = SURFACES[surfaceKey];
  if (!s) throw new Error(`@mingla/card-identity: unknown surface "${surfaceKey}"`);
  const out = [];
  for (let n = 0; n <= s.metaLines; n += 1) out.push(n);
  return out;
}

/**
 * The scrim height for a surface — ONE number per surface, never per card.
 *
 * #1700 CHANGED WHICH SILHOUETTE IT IS SOLVED FROM, and not which axis varies.
 * It used to solve from the CANONICAL plate. It now solves from the TALLEST
 * silhouette the surface can produce (`metaLines` lines of facts), because the
 * plate's top edge is the shallowest point the scrim has to carry and the
 * canonical plate is no longer that point.
 *
 * The reason the original chose the canonical one still holds and is still
 * honoured: a scrim whose height changed per card would make the deck's dark
 * band jump on every swipe. This is a fixed number computed from a worst case,
 * so nothing jumps — and every shallower silhouette sits DEEPER in a scrim that
 * is now longer, i.e. gets strictly more contrast. Measured on s1Single, white
 * 30/700 title against a pure-white photograph:
 *
 *     no meta  5.64 -> 6.93   one line  3.73 -> 4.66   two lines  2.96 -> 3.74
 *
 * Without this change the two-line silhouette shipped at 2.96:1, under the 3.0
 * floor. The oracle asserts the floors at EVERY silhouette, not just the
 * canonical one, so this cannot regress silently.
 */
function surfaceScrimHeight(surfaceKey) {
  const s = SURFACES[surfaceKey];
  if (!s) throw new Error(`@mingla/card-identity: unknown surface "${surfaceKey}"`);
  // Both depths through the per-line helpers: `titleTopDepthForLines` is what
  // self-disables clause 2 on a title-on-plate surface (S3/S4 return 0). Doing
  // the arithmetic inline here instead skipped that and gave S2 a 190pt scrim
  // where 124 is correct.
  return scrimHeight(
    plateTopDepthForLines(surfaceKey, s.metaLines),
    titleTopDepthForLines(surfaceKey, s.metaLines),
    s.h,
  );
}

/**
 * The derived under-layer alpha for a surface at a GIVEN plate height.
 *
 * #1700: the plate's rendered tone is pinned to L* 23.50, and the backdrop it
 * composites over is the scrim at the plate's own top edge — which moves when
 * the plate grows. Re-solving here is what stops a two-line plate reading
 * lighter than a one-line one; the plate compensates rather than drifting.
 */
function plateUnderForHeight(surfaceKey, plateH) {
  const s = SURFACES[surfaceKey];
  if (!s) throw new Error(`@mingla/card-identity: unknown surface "${surfaceKey}"`);
  return plateUnderAlpha(
    rampAlphaAtDepth(s.bottomInset + plateH, surfaceScrimHeight(surfaceKey)),
  );
}

/** The derived under-layer alpha for a surface's canonical (one-line) plate. */
function surfacePlateUnder(surfaceKey) {
  return plateUnderForHeight(surfaceKey, SURFACES[surfaceKey].plateH);
}

/**
 * S1's alternate silhouette. The ONE data-dependent height in the system: a
 * discrete constant rather than a measured one, and DERIVED rather than typed.
 *
 *     full   1 border + 40 meta + 1 divider + 53 control + 1 border = 96
 *     short  1 border +  8 clr  + 1 divider + 53 control + 1 border = 64
 *
 * The short plate is the full plate with the FACTS ROW swapped for the
 * chevron's clearance. Everything from the divider down is byte-identical, so
 * the divider, the chevron, the Been-here pill and the share glyph all sit
 * exactly where they sit on the 96pt plate — which is what Seth's #1609
 * decision requires, and the reason this is `plateH - META_ROW_H +
 * CHEVRON_CLEARANCE` and not a fourth number somebody has to keep in sync.
 *
 * It was 54 until 2026-08-05, when §3.6 still omitted the divider along with
 * the facts row. 54 cannot hold this composition at all: 2 borders + a 7.5pt
 * chevron overhang + the divider + the 44pt Been-here target is 54.5 before any
 * breathing room, so the pill would have touched the plate's border on both
 * edges. The height moved because the composition changed, not to make a number
 * rounder.
 */
const PLATE_H_NO_META = SURFACES.s1Single.plateH - META_ROW_H + CHEVRON_CLEARANCE;

// Attached AFTER BEEN_HERE evaluates: DETAILS is declared above it (next to the
// other furniture) but its geometry IS Been-here's, and reading it at declaration
// time would be a temporal-dead-zone bug rather than a design decision.
DETAILS.glyphSize = BEEN_HERE.glyphSize.rest;
DETAILS.gap = BEEN_HERE.gap;
DETAILS.paddingH = BEEN_HERE.paddingHorizontal;
DETAILS.labelSize = BEEN_HERE.labelSize;
DETAILS.labelWeight = BEEN_HERE.labelWeight;
DETAILS.border = BEEN_HERE.states.rest.border;
DETAILS.androidBorder = BEEN_HERE.states.rest.androidBorder;
/** The gap between Been-here and Details in the control row. */
DETAILS.gapFromBeenHere = 8;
Object.freeze(DETAILS);

module.exports = {
  RAMP,
  PLATE,
  META,
  DIVIDER,
  CHEVRON,
  SHARE_GLYPH,
  STATE_DISC,
  BEEN_HERE,
  DETAILS,
  SLIVER,
  HANDLE,
  SURFACES,
  MAX_FONT_SCALE,
  META_ROW_H,
  META_LINES_MAX,
  META_LH_RATIO,
  DIVIDER_H,
  CHEVRON_CLEARANCE,
  PLATE_H_NO_META,
  PLATE_ALPHA_FLOOR,
  TITLE_ALPHA_FLOOR,
  K_PLATE,
  K_TITLE,
  S7_HERO_MIN,
  S7_HERO_MAX,
  S7_FOLD_RESERVE,
  expandedHeroHeight,
  expandedCoverlessHeroHeight,
  scrimHeight,
  rampAlphaAtDepth,
  plateUnderAlpha,
  plateRows,
  metaLineHeight,
  metaRowHeight,
  plateHeightNoMeta,
  plateHeightForMetaLines,
  plateUnderForHeight,
  typeLadder,
  plateTopDepth,
  plateTopDepthForLines,
  titleBottom,
  titleTopDepth,
  titleTopDepthForLines,
  surfaceSilhouettes,
  surfacePlateBoundary,
  surfaceSliverBoundary,
  surfaceScrimHeight,
  surfacePlateUnder,
};
