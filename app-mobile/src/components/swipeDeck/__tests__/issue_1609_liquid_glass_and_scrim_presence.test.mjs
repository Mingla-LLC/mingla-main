/**
 * #1609 — Liquid Glass + scrim PRESENCE guard.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT A DUPLICATE OF THE CONTRAST GUARD.
 *
 * `issue_1609_top_scrim_chrome_contrast.test.mjs` protects LEGIBILITY: can the text and
 * chrome be read against the scrim. Every one of its assertions passed on the build Seth
 * REJECTED on 2026-08-05. That is the point. His complaint was not that anything was
 * illegible — it was that neither gradient read as a designed element, and that the
 * badges read as flat dark pills rather than glass.
 *
 * So legibility is necessary and demonstrably not sufficient, and a second, orthogonal
 * property needs its own guard: PRESENCE. WCAG contrast ratio is the wrong instrument for
 * it. At low luminance the ratio's +0.05 flare term dominates, so two tones that are
 * obviously different to the eye can score close to 1.0. The right instrument is CIE L*
 * (lightness), where ~2-3 units is the just-noticeable difference for large flat fields.
 *
 * MEASURED, from the rejected capture `05-collapsed-bright-both-scrims.png`:
 *   default chip body   L* 12.9  vs surround L* 15.6-17.9  ->  delta L* -2.7 to -5.0
 *   curated accent chip L* 32.7  vs the same surround      ->  delta L* +11.3 to +26.7
 * The default chips sat at or below the JND — no perceptible body, only a 1px hairline at
 * 1.57:1 marking them. The accent chip, whose fill LIGHTENS instead of darkens, read
 * correctly against the identical backdrop. That contrast between the two, inside one
 * screenshot, is the whole diagnosis: the glass was never dropped and blur was never
 * disabled — a DARKENING fill was being asked to do its job on an already-dark scrim,
 * where it has nothing left to darken.
 *
 * This guard therefore asserts the two things that fix actually depends on:
 *   (a) both ramps clear a presence floor in L*, not merely a contrast floor; and
 *   (b) chips that sit on the scrim use a LIGHTENING fill.
 *
 * ANTI-HOLLOW-GUARD. Seven hollow guards have been found on this deck (#1607). T-8 runs
 * every checker in this file against the exact pre-rejection values and asserts each one
 * REJECTS them. A checker that cannot fail cannot pass this file.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createRequire } from 'node:module';
import {
  DECK_BOTTOM_SCRIM_HEIGHT_PT,
  DECK_SCRIM_COLORS,
  DECK_SCRIM_LOCATIONS,
  DECK_TOP_SCRIM_COLORS,
} from '../../deckHeroConstants.ts';

const urls = {
  swipeable: new URL('../../SwipeableCards.tsx', import.meta.url),
  curated: new URL('../../CuratedExperienceSwipeCard.tsx', import.meta.url),
  design: new URL('../../../constants/designSystem.ts', import.meta.url),
  // [TEST-MOD-APPROVED #1609] Direction C moved the card face's ONE piece of
  // glass into its own leaf module, shared by both card trees.
  plate: new URL('../../deckCardPlate.tsx', import.meta.url),
};

/**
 * Comments must be stripped before any source assertion. Learned the hard way on the
 * first run of T-7: the prose comment ADDED to styles.beenHere explains that it was moved
 * OFF `glass.chrome.tint.floor`, and the raw-text check then read its own documentation as
 * the defect it was looking for. A guard that greps documentation is a guard that reports
 * the opposite of the truth.
 */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const raw = {
  swipeable: await readFile(urls.swipeable, 'utf8'),
  curated: await readFile(urls.curated, 'utf8'),
  design: await readFile(urls.design, 'utf8'),
  plate: await readFile(urls.plate, 'utf8'),
};
const src = {
  swipeable: stripComments(raw.swipeable),
  curated: stripComments(raw.curated),
  design: stripComments(raw.design),
  plate: stripComments(raw.plate),
};

// [TEST-MOD-APPROVED #1609] The Been-here control's rest fill, read from the REAL
// package rather than copied — T-7 measures it rather than matching a token name.
const { BEEN_HERE } = createRequire(import.meta.url)('../../../../../packages/card-identity/index.js');
const REST_FILL = BEEN_HERE.states.rest.fill;

/* ------------------------------------------------------------------ *
 * Colour maths — re-derived here on purpose.
 *
 * These deliberately do NOT import any product helper. A bug shared between
 * the source and its test is invisible to the test, so the inversion is
 * written out independently and cross-checked against a published value in T-0.
 * ------------------------------------------------------------------ */

/** sRGB channel (0..1) -> linear light. */
function linearize(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a neutral grey at sRGB channel value c (0..1). */
function lumOfGrey(c) {
  return linearize(c);
}

/** CIE L* from relative luminance Y (0..1). ~2-3 units is the JND. */
function Lstar(Y) {
  return Y > 0.008856 ? 116 * Y ** (1 / 3) - 16 : 116 * (Y / 0.12842 + 0.13793) - 16;
}

/** WCAG contrast between two relative luminances. */
function contrast(a, b) {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/** Black scrim of `alpha` composited over a WHITE (channel 1.0) photo. */
function compositedOverWhite(alpha) {
  return lumOfGrey(1 - alpha);
}

function alphaOf(rgbaString) {
  const m = /rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/.exec(rgbaString);
  assert.ok(m, `alphaOf: could not parse an alpha out of ${rgbaString}`);
  return Number(m[1]);
}

/** Alpha of the ramp at fractional position p, linearly interpolated between stops. */
function alphaAt(colors, locations, p) {
  if (p <= locations[0]) return alphaOf(colors[0]);
  for (let i = 1; i < locations.length; i += 1) {
    if (p <= locations[i]) {
      const span = locations[i] - locations[i - 1];
      const t = span === 0 ? 0 : (p - locations[i - 1]) / span;
      return alphaOf(colors[i - 1]) + t * (alphaOf(colors[i]) - alphaOf(colors[i - 1]));
    }
  }
  return alphaOf(colors[colors.length - 1]);
}

/* ------------------------------------------------------------------ *
 * The checkers, as pure functions so T-8 can run them against the
 * pre-rejection values and prove they reject them.
 * ------------------------------------------------------------------ */

/** Presence floor for the BOTTOM ramp: the deep end must resolve to a definite tone. */
const BOTTOM_DEEP_END_MAX_LSTAR = 10;
/** Both ramps must traverse at least this much lightness on a white photo. */
const MIN_RAMP_TRAVERSAL_LSTAR = 40;
/** Presence floor for the TOP plateau. */
const TOP_PLATEAU_MAX_LSTAR = 50;

function checkBottomPresence(colors) {
  const deep = compositedOverWhite(alphaOf(colors[colors.length - 1]));
  const deepL = Lstar(deep);
  const clearL = Lstar(lumOfGrey(1)); // an unscrimmed white photo == L* 100
  return {
    deepL,
    traversal: clearL - deepL,
    ok: deepL <= BOTTOM_DEEP_END_MAX_LSTAR
      && clearL - deepL >= MIN_RAMP_TRAVERSAL_LSTAR,
  };
}

function checkTopPresence(colors) {
  const plateauL = Lstar(compositedOverWhite(alphaOf(colors[0])));
  const clearL = Lstar(lumOfGrey(1));
  return {
    plateauL,
    traversal: clearL - plateauL,
    ok: plateauL <= TOP_PLATEAU_MAX_LSTAR && clearL - plateauL >= MIN_RAMP_TRAVERSAL_LSTAR,
  };
}

/**
 * The notification badge's opaque ring is what carries SC 1.4.11 for the #eb7825 dot
 * (the fill itself cannot reach 3:1 at any usable alpha). Darkening the top scrim moves
 * the backdrop TOWARD that ring and erodes the boundary, so presence has a hard ceiling.
 */
const BADGE_RING_LUM = 0.007038; // rgba(18,20,26,1), computed in deckHeroConstants
function checkRingSurvives(colors) {
  const backdrop = compositedOverWhite(alphaOf(colors[0]));
  const ratio = contrast(backdrop, BADGE_RING_LUM);
  return { ratio, ok: ratio >= 3 };
}

test('T-0 the independently re-derived inversion reproduces a published value', () => {
  // deckHeroConstants publishes: alpha 0.45 composites white to L = 0.263292 (3.35:1).
  // If this drifts, every other number in this file is suspect.
  // Tolerance 1e-4, not 1e-5: this file's inversion and the one written out longhand in
  // deckHeroConstants agree to 0.263273 vs 0.263292 — 1.9e-5 apart, which is intermediate
  // rounding in the published figure, not a disagreement about the maths. Tightening below
  // that would assert someone's decimal places rather than the derivation.
  const y = compositedOverWhite(0.45);
  assert.ok(
    Math.abs(y - 0.263292) < 1e-4,
    `re-derived-inversion: expected ~0.263292 for alpha 0.45, got ${y.toFixed(6)}`,
  );
  assert.ok(Math.abs(contrast(1.0, y) - 3.35) < 0.01, 're-derived-inversion: 3.35:1 expected');
  // And L* 100 for white, the anchor the traversal numbers are measured from.
  assert.ok(Math.abs(Lstar(lumOfGrey(1)) - 100) < 1e-6, 're-derived-inversion: white is L* 100');
});

test('T-1 the bottom ramp resolves to a definite tone rather than a dimmed photo', () => {
  const r = checkBottomPresence(DECK_SCRIM_COLORS);
  assert.ok(
    r.ok,
    'bottom-ramp-presence: the deep end composites to L* '
    + `${r.deepL.toFixed(1)} over a white photo (traversal ${r.traversal.toFixed(1)} L*). `
    + `The floor is L* <= ${BOTTOM_DEEP_END_MAX_LSTAR} and a traversal >= `
    + `${MIN_RAMP_TRAVERSAL_LSTAR}. Above that ceiling the band reads as a photograph `
    + 'that happens to be dark, which is exactly what Seth rejected on 2026-08-05.',
  );
  console.log(`T-1 bottom deep end L* ${r.deepL.toFixed(2)}, traversal ${r.traversal.toFixed(1)}`);
});

test('T-2 the top plateau reads as a layer, not as a slightly darker photo', () => {
  const r = checkTopPresence(DECK_TOP_SCRIM_COLORS);
  assert.ok(
    r.ok,
    `top-plateau-presence: plateau composites to L* ${r.plateauL.toFixed(1)} over a white `
    + `photo (traversal ${r.traversal.toFixed(1)} L*). Floor is L* <= `
    + `${TOP_PLATEAU_MAX_LSTAR} and traversal >= ${MIN_RAMP_TRAVERSAL_LSTAR}.`,
  );
  console.log(`T-2 top plateau L* ${r.plateauL.toFixed(2)}, traversal ${r.traversal.toFixed(1)}`);
});

test('T-3 raising the top scrim has not eroded the notification-badge ring below 3:1', () => {
  const r = checkRingSurvives(DECK_TOP_SCRIM_COLORS);
  assert.ok(
    r.ok,
    `badge-ring-survives: the opaque ring measures ${r.ratio.toFixed(2)}:1 against the `
    + 'scrimmed backdrop, below the 3:1 SC 1.4.11 floor. The #eb7825 fill CANNOT reach 3:1 '
    + 'at any usable alpha, so this ring is the only thing carrying the badge boundary. '
    + 'Darkening the scrim moves the backdrop toward the ring — presence has a ceiling '
    + 'here (alpha <= 0.617), and it has just been crossed.',
  );
  console.log(`T-3 badge ring vs scrimmed backdrop ${r.ratio.toFixed(2)}:1`);
});

test('T-4 every bottom text band still clears its legibility floor after the re-derivation', () => {
  // Presence was raised by increasing alpha, which can only ever RAISE contrast for white
  // text. This asserts that rather than assuming it — and it is the assertion that would
  // catch a "presence" change made by LIGHTENING the ramp instead.
  // [TEST-MOD-APPROVED #1609] THE 0.52 WAS HARD-CODED HERE, and that made this
  // test unfalsifiable: Direction C replaced the 52% percentage with an absolute
  // 316pt height, and because the fraction lived in this file rather than being
  // read from the source, every band would have gone on passing while describing
  // a card that no longer ships. It now reads the REAL shipped height.
  //
  // The band list is re-derived for the same reason: the description and the
  // action rail are DELETED from the photograph, so two of the three bands were
  // measuring bare pixels. What remains on the photograph is the title, now
  // 30/700 at lineHeight 36 sitting 132pt off the card's bottom edge.
  const CARD_H = 783;
  const SCRIM_TOP = CARD_H - DECK_BOTTOM_SCRIM_HEIGHT_PT;
  const SCRIM_SPAN = CARD_H - SCRIM_TOP;
  const TITLE_BOTTOM = CARD_H - 132;
  const bands = [
    // [name, yTop, yBottom, required ratio]
    ['title 30/700 (large text)', TITLE_BOTTOM - 2 * 36, TITLE_BOTTOM, 3.0],
    // The plate's top edge — the deepest point the ramp is responsible for.
    ['plate top edge', CARD_H - 112, CARD_H - 16, 3.0],
  ];
  for (const [name, y0, y1, required] of bands) {
    // Worst case is the TOP of each band, where the ramp is lightest.
    const p = (y0 - SCRIM_TOP) / SCRIM_SPAN;
    assert.ok(p >= 0 && p <= 1, `band-legibility: ${name} falls outside the scrim`);
    const a = alphaAt(DECK_SCRIM_COLORS, DECK_SCRIM_LOCATIONS, p);
    const ratio = contrast(1.0, compositedOverWhite(a));
    assert.ok(
      ratio >= required,
      `band-legibility: ${name} measures ${ratio.toFixed(2)}:1 against a white photo at `
      + `alpha ${a.toFixed(3)}, below its ${required}:1 floor. Raising presence must never `
      + 'cost legibility.',
    );
    console.log(`T-4 ${name}: alpha ${a.toFixed(3)} -> ${ratio.toFixed(2)}:1 (floor ${required})`);
    // y1 is read so the band definition cannot silently collapse to a single row.
    assert.ok(y1 > y0, `band-legibility: ${name} has a non-positive height`);
  }
});

const CARD_H_REF = 783;

test('T-5 glass.badge.liquid exists and is a LIGHTENING fill, not another dark wash', () => {
  const block = /liquid:\s*\{([\s\S]*?)\n\s{4}\},/.exec(src.design);
  assert.ok(
    block,
    'liquid-tokens-exist: no `liquid: {` block found under glass.badge in designSystem.ts. '
    + 'The scrim-facing chips have no lightening fill to consume.',
  );
  const body = block[1];
  const fill = /fill:\s*'([^']+)'/.exec(body);
  const border = /border:\s*'([^']+)'/.exec(body);
  const highlight = /topHighlight:\s*'([^']+)'/.exec(body);
  assert.ok(fill && border && highlight, 'liquid-tokens-exist: fill/border/topHighlight required');

  // The whole point: the fill must be WHITE-based. A dark fill here would reproduce the
  // exact defect this token was introduced to remove.
  const rgb = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(fill[1]);
  assert.ok(rgb, 'liquid-fill-is-lightening: could not parse the fill colour');
  const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  assert.ok(
    r >= 240 && g >= 240 && b >= 240,
    `liquid-fill-is-lightening: the fill is rgb(${r},${g},${b}) — it must be a white-based `
    + 'LIGHTENING fill. A dark fill on an already-dark scrim has nothing to darken, which is '
    + 'precisely why the chips read as flat dark pills in the rejected build.',
  );

  // And it must actually lift the chip clear of the JND at the badge band.
  // [TEST-MOD-APPROVED #1609] Was `(665 - 783 * 0.48) / (783 * 0.52)`, a hard-coded
  // copy of the deleted 52% scrim. The chips it measured are gone, but the TOKEN
  // is still shipped and still consumed elsewhere, so the property is kept and
  // re-anchored to the real scrim at the depth the plate now occupies.
  const BADGE_BAND_P = (CARD_H_REF - 112 - (CARD_H_REF - DECK_BOTTOM_SCRIM_HEIGHT_PT)) / DECK_BOTTOM_SCRIM_HEIGHT_PT;
  const scrimAlpha = alphaAt(DECK_SCRIM_COLORS, DECK_SCRIM_LOCATIONS, BADGE_BAND_P);
  const BRIGHT_PHOTO_CHANNEL = 0.85;
  const backdropC = BRIGHT_PHOTO_CHANNEL * (1 - scrimAlpha);
  const fillAlpha = alphaOf(fill[1]);
  const chipC = backdropC + fillAlpha * (1 - backdropC);
  const dL = Lstar(lumOfGrey(chipC)) - Lstar(lumOfGrey(backdropC));
  assert.ok(
    dL >= 8,
    `liquid-fill-is-lightening: the chip lifts only ${dL.toFixed(1)} L* off the scrim at the `
    + 'badge band. The rejected build measured -2.7 to -5.0 (below the ~2-3 L* JND). The '
    + 'floor here is +8 so the chip has a perceptible body and not merely a hairline.',
  );
  console.log(`T-5 chip lifts +${dL.toFixed(1)} L* off the scrim (scrim alpha ${scrimAlpha.toFixed(3)})`);

  // The rim and bevel must be brighter than the default badge's, or the silhouette is
  // still carried by a 0.14 hairline.
  assert.ok(
    alphaOf(border[1]) > 0.14,
    `liquid-rim: border alpha ${alphaOf(border[1])} must exceed the default 0.14 hairline`,
  );
  assert.ok(
    alphaOf(highlight[1]) > 0.22,
    `liquid-bevel: topHighlight alpha ${alphaOf(highlight[1])} must exceed the default 0.22`,
  );
});

test('T-6 no chip sits on the scrim at all — there is ONE piece of glass on the card face', () => {
  // [TEST-MOD-APPROVED #1609] SUPERSEDED MECHANISM, STRICTLY STRONGER ASSERTION.
  //
  // This test previously required EXACTLY 10 `<GlassBadge liquid>` in
  // SwipeableCards and 6 in CuratedExperienceSwipeCard, on the reasoning that a
  // chip left on the dark tint floor reads as a flat pill inside the bottom
  // scrim. That reasoning was correct and it is now satisfied by construction:
  // #1609 Direction C DELETES every chip from both card faces. Five chips per
  // face were five BlurViews, five shadowed lifted objects and five
  // `entryIndex`-staggered Animated.Views inside the promotion diff — the exact
  // shape that produced #1576.
  //
  // Requiring a count of chips that no longer exist would fail on a card that is
  // strictly better than the one the count was written for. Asserting ZERO is
  // the stronger statement: there is no chip that COULD be on the wrong path.
  const targets = [
    ['SwipeableCards', src.swipeable],
    ['CuratedExperienceSwipeCard', src.curated],
  ];
  for (const [name, code] of targets) {
    const all = [...code.matchAll(/<GlassBadge\b/g)].length;
    assert.equal(
      all,
      0,
      `chips-consume-liquid: ${name} mounts ${all} <GlassBadge> elements on the card face. `
      + 'Direction C carries every fact on ONE plate; a chip here is five nodes of swipe-path '
      + 'cost and a per-badge stagger inside the promotion diff (#1576).',
    );
    // ANTI-VACUITY. If the element name were ever renamed, the count above would
    // be 0 for the wrong reason. The plate must actually be mounted instead.
    assert.ok(
      /<DeckCardPlate\b/.test(code),
      `chips-consume-liquid: ${name} mounts neither a chip NOR the plate — this test would `
      + 'otherwise pass vacuously on a card face that renders nothing at all.',
    );
  }
  // And exactly one BlurView survives across both faces: the plate's.
  const blurs = [...src.plate.matchAll(/<BlurView\b/g)].length;
  assert.equal(blurs, 1, `chips-consume-liquid: the plate mounts ${blurs} BlurViews, expected exactly 1`);
});

test('T-7 the Been-here control is lifted off its backdrop, not left on the dark floor', () => {
  // [TEST-MOD-APPROVED #1609] SUPERSEDED MECHANISM, SAME PROPERTY, MEASURED.
  //
  // This test previously required the literal token `glass.badge.liquid.fill`
  // inside `styles.beenHere`. The PROPERTY it was defending — the control must be
  // LIFTED off its backdrop rather than sunk into it — is unchanged and is now
  // enforced numerically instead of by token name.
  //
  // Two things moved under Direction C. The control no longer sits on the action
  // rail over bare scrim; it sits on the PLATE, so the tone it must lift off is
  // the plate's L* 23.5, not the scrim's ~0.87 band. And its fill is now
  // per-STATE (rest / pressed / flash / settled / failed), so a single style
  // token cannot express it — `beenHereStateStyle()` reads all five from
  // @mingla/card-identity.
  //
  // glass.badge.liquid.fill is 0.12; the control's rest fill is 0.14, because on
  // the plate it needs slightly more lift than a chip needed on the scrim. That
  // difference is exactly why the token could not simply be reused.
  const block = /beenHere:\s*\{([\s\S]*?)\n\s{2}\},/.exec(src.swipeable);
  assert.ok(block, 'been-here-liquid: no `beenHere: {` style block found in SwipeableCards');
  const body = block[1];

  assert.ok(
    !/glass\.chrome\.tint\.floor/.test(body),
    'been-here-liquid: styles.beenHere references glass.chrome.tint.floor, the darkening wash '
    + 'it was moved off. On a near-black backdrop a darkening wash has nothing to darken and '
    + 'the control reads as the flattest element on the card.',
  );
  assert.ok(
    /beenHereStateStyle\(/.test(src.swipeable),
    'been-here-liquid: the control no longer reads its per-state fill from the package',
  );

  // The property, measured: the rest fill must LIGHTEN the plate, not darken it.
  const rest = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/.exec(REST_FILL);
  assert.ok(rest, `been-here-liquid: could not parse the rest fill "${REST_FILL}"`);
  const [r, g, b, a] = [Number(rest[1]), Number(rest[2]), Number(rest[3]), Number(rest[4])];
  assert.ok(
    r >= 240 && g >= 240 && b >= 240,
    `been-here-liquid: the rest fill rgb(${r},${g},${b}) is not a LIGHTENING fill. A dark fill on `
    + 'a dark plate leaves the control the flattest element on the card — the #1609 rejection.',
  );
  assert.ok(a > 0.12, `been-here-liquid: the rest fill alpha ${a} does not exceed the 0.12 chip lift`);
});

test('T-8 every checker in this file REJECTS the exact pre-rejection values', () => {
  // The build Seth rejected, verbatim. If any checker passes these, it cannot detect the
  // defect it claims to guard and this whole file is theatre.
  const REJECTED_BOTTOM = [
    'rgba(0,0,0,0)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.68)', 'rgba(0,0,0,0.82)',
  ];
  const REJECTED_TOP = [
    'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.12)', 'rgba(0,0,0,0)',
  ];

  assert.equal(
    checkBottomPresence(REJECTED_BOTTOM).ok,
    false,
    'checker-can-fail: the bottom-presence checker ACCEPTED the rejected 0.82 deep end '
    + `(L* ${checkBottomPresence(REJECTED_BOTTOM).deepL.toFixed(1)}). It cannot detect the defect.`,
  );
  assert.equal(
    checkTopPresence(REJECTED_TOP).ok,
    false,
    'checker-can-fail: the top-presence checker ACCEPTED the rejected 0.45 plateau '
    + `(L* ${checkTopPresence(REJECTED_TOP).plateauL.toFixed(1)}).`,
  );

  // The ring ceiling must reject an over-darkened scrim — presence is bounded, not free.
  const TOO_DARK = ['rgba(0,0,0,0.70)', 'rgba(0,0,0,0.70)', 'rgba(0,0,0,0.30)', 'rgba(0,0,0,0)'];
  assert.equal(
    checkRingSurvives(TOO_DARK).ok,
    false,
    'checker-can-fail: the ring checker ACCEPTED a 0.70 plateau, which buries the badge ring.',
  );
  // ...and must accept the shipped one, so it is not simply always-false.
  assert.equal(
    checkRingSurvives(DECK_TOP_SCRIM_COLORS).ok,
    true,
    'checker-can-fail: the ring checker rejected the SHIPPED value — it is always-false and '
    + 'therefore equally useless.',
  );
  assert.equal(checkBottomPresence(DECK_SCRIM_COLORS).ok, true, 'checker-can-fail: always-false');
  assert.equal(checkTopPresence(DECK_TOP_SCRIM_COLORS).ok, true, 'checker-can-fail: always-false');

  console.log(
    'T-8 rejected bottom L* '
    + `${checkBottomPresence(REJECTED_BOTTOM).deepL.toFixed(1)} / shipped `
    + `${checkBottomPresence(DECK_SCRIM_COLORS).deepL.toFixed(1)}; rejected top L* `
    + `${checkTopPresence(REJECTED_TOP).plateauL.toFixed(1)} / shipped `
    + `${checkTopPresence(DECK_TOP_SCRIM_COLORS).plateauL.toFixed(1)}`,
  );
});
