// Issue #1609 amendment 4 — the deck chrome must never sit on bare photo.
//
// #1609 deleted the white tray and made the collapsed card a full-bleed hero. That
// gained photo everywhere — INCLUDING behind the deck chrome, which previously had a
// calmer backdrop. In all six delivered #1609 captures the photo inside the chrome band
// reaches a 90th-percentile relative luminance of 0.783 to 0.984, and five of the six
// saturate to L = 1.000 somewhere in the band. White chrome against that measured
// 1.02:1 to 1.26:1, against a 3:1 requirement. The repair is a second, top-anchored
// LinearGradient whose alpha is BACK-SOLVED from the sRGB transfer function.
//
// This guard defends four properties, each of which is silent when it breaks — the card
// still renders, the chrome is just illegible on a bright photo:
//
//   P1  THE TOP RAMP CLEARS SC 1.4.11 ON A WHITE PHOTO. The bar for icons and a pill is
//       the 3:1 NON-TEXT floor, not 4.5:1. This guard IMPORTS the real
//       DECK_TOP_SCRIM_COLORS / DECK_TOP_SCRIM_LOCATIONS and re-derives the compositing
//       and contrast math over them from first principles, so weakening any stop fails
//       here. It does not assert that four string literals are still four string
//       literals.
//
//   P2  THE PLATEAU ACTUALLY REACHES THE CHROME. A ramp with the right alpha at y=0 and
//       the wrong decay is worthless: the lowest chrome pixel is the bottom of the 44pt
//       GlassTopBar button row at safeAreaTop + 46 screen / safeAreaTop + 44 card-local.
//       The guard converts points to gradient position using the REAL height constant
//       and asserts the floor still holds there at the largest supported inset.
//
//   P3  THE TWO SCRIMS NEVER OVERLAP. If they did, their alphas would stack and every
//       number in the BOTTOM ramp's derivation — which #1609 already shipped and Seth
//       already approved — would become fiction. Curated's 62% bottom scrim is the
//       tightest case.
//
//   P4  ALL THREE CARD FACES MOUNT IT, AND IT CARRIES NO FLEX-AXIS KEY. Two faces in
//       SwipeableCards (front and the behind/preview face — a missing top scrim on the
//       behind face flashes a bright band under the chrome on EVERY swipe as the cards
//       swap) and one in CuratedExperienceSwipeCard. The style must be absolute points:
//       ACTIVE I-PROPOSED-1593-LAYER-GEOMETRY-SINGLE-SOURCE.
//
// VACUITY DISCIPLINE. Seven guards on this deck have been found hollow (#1607),
// including one that passed 9/9 against a mutation that fully restored the defect.
// Therefore, in this file: every extraction asserts an EXACT expected count BEFORE it
// inspects content and finding zero targets is a FAILURE; every source lookup runs on
// comment-stripped source so a comment can never satisfy an assertion; T-7 runs the
// contrast checker against synthetic WRONG ramps (including the exact "no top scrim at
// all" state this amendment repairs) to prove the checker can actually reject one; and
// T-8 mechanically asserts every CLAIM token below appears in a real assertion message
// in this file's own code.
//
// CLAIMS
//   CLAIM: executes-the-real-top-scrim-constants
//   CLAIM: chrome-band-clears-non-text-3to1
//   CLAIM: plateau-covers-the-lowest-chrome-pixel
//   CLAIM: ramp-decays-to-fully-transparent
//   CLAIM: checker-rejects-a-bare-photo-chrome-band
//   CLAIM: top-and-bottom-scrims-never-overlap
//   CLAIM: top-scrim-carries-no-flex-axis-key
//   CLAIM: every-card-face-mounts-the-top-scrim
//   CLAIM: notification-badge-keeps-its-ring

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  DECK_SCRIM_LOCATIONS,
  DECK_TOP_SCRIM_COLORS,
  DECK_TOP_SCRIM_HEIGHT_PT,
  DECK_TOP_SCRIM_LOCATIONS,
  DECK_MAX_SUPPORTED_TOP_INSET_PT,
  DECK_CHROME_BAND_BOTTOM_PT,
  DECK_CARD_TOP_OFFSET_PT,
} from '../../deckHeroConstants.ts';

const urls = {
  swipeable: new URL('../../SwipeableCards.tsx', import.meta.url),
  curated: new URL('../../CuratedExperienceSwipeCard.tsx', import.meta.url),
  design: new URL('../../../constants/designSystem.ts', import.meta.url),
  self: new URL('./issue_1609_top_scrim_chrome_contrast.test.mjs', import.meta.url),
};

const sourceEntries = await Promise.all(
  Object.entries(urls).map(async ([key, url]) => [key, await readFile(url, 'utf8')]),
);
const source = Object.fromEntries(sourceEntries);

// ---------------------------------------------------------------------------
// Comment stripping. Every source lookup below runs on the stripped text, so a
// comment mentioning `topScrim` can never satisfy an assertion about mounting it.
// ---------------------------------------------------------------------------

function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += quote;
      i += 1;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') { out += src[i]; i += 1; }
        out += src[i];
        i += 1;
      }
      out += quote;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const stripped = {
  swipeable: stripComments(source.swipeable),
  curated: stripComments(source.curated),
  design: stripComments(source.design),
};

// Prove the stripper actually removed something, so a future refactor that turns it
// into an identity function cannot silently re-open the comment loophole.
assert.ok(
  stripped.swipeable.length < source.swipeable.length,
  'VACUITY: stripComments() returned SwipeableCards unchanged — every source assertion '
  + 'in this file would then be satisfiable by a comment',
);

// ---------------------------------------------------------------------------
// WCAG math, re-derived here rather than imported. If the product ever exports a
// contrast helper, this guard must NOT use it: a bug shared by the source and the
// test is invisible to the test.
// ---------------------------------------------------------------------------

/** sRGB relative luminance of a GREY channel (R=G=B collapses the coefficients to 1). */
function luminanceOfGrey(channel255) {
  const c = channel255 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** sRGB relative luminance of an arbitrary colour. */
function luminanceOfRgb(r, g, b) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(l1, l2) {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Parse 'rgba(0,0,0,0.45)' -> 0.45. Throws rather than silently yielding NaN. */
function alphaOf(rgbaString) {
  const m = /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*([0-9.]+)\s*\)$/.exec(rgbaString);
  assert.ok(
    m,
    `executes-the-real-top-scrim-constants: top scrim stop ${JSON.stringify(rgbaString)} `
    + 'is not a pure-black rgba() stop — the whole derivation assumes a black scrim over '
    + 'the photo, so a hue change here silently invalidates every number below',
  );
  const a = Number(m[1]);
  assert.ok(Number.isFinite(a) && a >= 0 && a <= 1, `alpha out of range: ${rgbaString}`);
  return a;
}

/** Alpha at fractional position p in [0,1] — the linear interpolation LinearGradient renders. */
function alphaAt(p, colors, locations) {
  assert.equal(
    colors.length,
    locations.length,
    'executes-the-real-top-scrim-constants: the top scrim colour and location arrays have '
    + `different lengths (${colors.length} vs ${locations.length}) — LinearGradient would `
    + 'silently reinterpolate and every contrast number below would be fiction',
  );
  if (p <= locations[0]) return alphaOf(colors[0]);
  for (let i = 1; i < locations.length; i += 1) {
    if (p <= locations[i]) {
      const span = locations[i] - locations[i - 1];
      const tt = span === 0 ? 1 : (p - locations[i - 1]) / span;
      const a0 = alphaOf(colors[i - 1]);
      const a1 = alphaOf(colors[i]);
      return a0 + (a1 - a0) * tt;
    }
  }
  return alphaOf(colors[colors.length - 1]);
}

/** A black scrim of alpha a over a pure-white (255) photo. */
const compositedOverWhite = (a) => 255 * (1 - a);

// The independent back-solve: minimum alpha for white chrome to reach 3:1 over white.
//   1.05 / (L + 0.05) >= 3  =>  L <= 0.30
//   L = ((c' + 0.055) / 1.055) ** 2.4  =>  c' = 1.055 * 0.30 ** (1/2.4) - 0.055
const NON_TEXT_MIN_RATIO = 3.0;
const MAX_PERMITTED_LUMINANCE = 1.05 / NON_TEXT_MIN_RATIO - 0.05;
const REQUIRED_MIN_ALPHA = 1 - (1.055 * MAX_PERMITTED_LUMINANCE ** (1 / 2.4) - 0.055);

// The chrome band, in CARD-LOCAL points, at the largest supported safe-area inset.
// GlassTopBar row: top = insets.top + 2, height 44 -> bottom = insets.top + 46.
// SwipeableCards' container adds paddingTop 2 above the card, so card-local y is
// screen y minus 2.
const LOWEST_CHROME_PIXEL_PT =
  DECK_MAX_SUPPORTED_TOP_INSET_PT + DECK_CHROME_BAND_BOTTOM_PT - DECK_CARD_TOP_OFFSET_PT;

/** Fractional position within the top scrim for a card-local y in points. */
const topScrimPositionForY = (y) => y / DECK_TOP_SCRIM_HEIGHT_PT;

// Sample points across the whole chrome band, not just its edges — a ramp can satisfy
// both endpoints and dip in the middle. This is the "blind in the middle" hollow-guard
// shape #1607 found.
const CHROME_SAMPLES = (() => {
  const rows = [];
  for (let y = 0; y <= LOWEST_CHROME_PIXEL_PT; y += 4) rows.push(y);
  if (rows[rows.length - 1] !== LOWEST_CHROME_PIXEL_PT) rows.push(LOWEST_CHROME_PIXEL_PT);
  return rows;
})();

/** Returns a list of failure strings; empty means the ramp covers the chrome band. */
function checkChromeBand(colors, locations, heightPt) {
  const failures = [];
  for (const y of CHROME_SAMPLES) {
    const a = alphaAt(y / heightPt, colors, locations);
    const ratio = contrast(1.0, luminanceOfGrey(compositedOverWhite(a)));
    if (!(ratio >= NON_TEXT_MIN_RATIO)) {
      failures.push(
        `y=${y}pt -> scrim alpha ${a.toFixed(3)} -> ${ratio.toFixed(2)}:1, below the `
        + `required ${NON_TEXT_MIN_RATIO}:1`,
      );
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------

test('T-1 the REAL shipped top-scrim constants clear the 3:1 non-text floor across the whole chrome band', () => {
  assert.ok(
    Array.isArray(DECK_TOP_SCRIM_COLORS) && Array.isArray(DECK_TOP_SCRIM_LOCATIONS),
    'executes-the-real-top-scrim-constants: DECK_TOP_SCRIM_COLORS / '
    + 'DECK_TOP_SCRIM_LOCATIONS did not import as arrays — this guard executes the real '
    + 'constants and must never fall back to a local copy of them',
  );
  assert.equal(
    DECK_TOP_SCRIM_COLORS.length,
    4,
    'executes-the-real-top-scrim-constants: expected exactly 4 top-scrim stops, found '
    + `${DECK_TOP_SCRIM_COLORS.length} — dropping a stop is exactly how a plateau `
    + 'collapses into a linear fade that no longer reaches the chrome',
  );
  assert.ok(
    CHROME_SAMPLES.length >= 25,
    `VACUITY: the chrome band sampled at only ${CHROME_SAMPLES.length} points`,
  );

  const failures = checkChromeBand(
    DECK_TOP_SCRIM_COLORS, DECK_TOP_SCRIM_LOCATIONS, DECK_TOP_SCRIM_HEIGHT_PT,
  );
  assert.deepEqual(
    failures,
    [],
    'chrome-band-clears-non-text-3to1: the shipped top scrim no longer holds the 3:1 '
    + 'non-text floor for white chrome on a pure-white hero: ' + failures.join(' | '),
  );

  const worst = CHROME_SAMPLES
    .map((y) => contrast(1.0, luminanceOfGrey(compositedOverWhite(
      alphaAt(topScrimPositionForY(y), DECK_TOP_SCRIM_COLORS, DECK_TOP_SCRIM_LOCATIONS),
    ))))
    .reduce((a, b) => Math.min(a, b));
  console.log(
    `T-1 required alpha >= ${REQUIRED_MIN_ALPHA.toFixed(6)}; shipped plateau alpha `
    + `${alphaOf(DECK_TOP_SCRIM_COLORS[0])}; worst contrast anywhere in the chrome band `
    + `= ${worst.toFixed(2)}:1 (needs ${NON_TEXT_MIN_RATIO}:1)`,
  );
});

test('T-2 the plateau alpha is at or above the independently back-solved minimum', () => {
  // Sanity-check the derivation itself against the published #1609 figure (0.4165)
  // before using it to judge the shipped value.
  assert.ok(
    Math.abs(REQUIRED_MIN_ALPHA - 0.4162) < 0.001,
    'chrome-band-clears-non-text-3to1: the back-solve drifted to '
    + `${REQUIRED_MIN_ALPHA} — it must reproduce the 3:1 figure (0.4162) that #1609 `
    + 'pillar 1 published for large text, because both are the same sRGB inversion',
  );
  const plateau = alphaOf(DECK_TOP_SCRIM_COLORS[0]);
  assert.ok(
    plateau >= REQUIRED_MIN_ALPHA,
    `chrome-band-clears-non-text-3to1: plateau alpha ${plateau} is below the derived `
    + `minimum ${REQUIRED_MIN_ALPHA.toFixed(6)} — the chrome would fail SC 1.4.11 on a `
    + 'white photo, which is the exact defect amendment 4 repairs',
  );
});

test('T-3 the plateau still holds at the LOWEST chrome pixel on the largest supported inset', () => {
  assert.ok(
    DECK_MAX_SUPPORTED_TOP_INSET_PT >= 62,
    'plateau-covers-the-lowest-chrome-pixel: the supported inset ceiling dropped to '
    + `${DECK_MAX_SUPPORTED_TOP_INSET_PT}pt, below the 62pt safe-area top of the largest `
    + 'shipping iOS device (iPhone 17 Pro Max) — the chrome would fall off the plateau there',
  );
  const p = topScrimPositionForY(LOWEST_CHROME_PIXEL_PT);
  assert.ok(
    p <= 1,
    'plateau-covers-the-lowest-chrome-pixel: the lowest chrome pixel at '
    + `${LOWEST_CHROME_PIXEL_PT}pt falls OUTSIDE the ${DECK_TOP_SCRIM_HEIGHT_PT}pt scrim `
    + 'entirely — it would sit on completely bare photo',
  );
  const a = alphaAt(p, DECK_TOP_SCRIM_COLORS, DECK_TOP_SCRIM_LOCATIONS);
  const ratio = contrast(1.0, luminanceOfGrey(compositedOverWhite(a)));
  assert.ok(
    ratio >= NON_TEXT_MIN_RATIO,
    `plateau-covers-the-lowest-chrome-pixel: at y=${LOWEST_CHROME_PIXEL_PT}pt (bottom of `
    + `the 44pt GlassTopBar button row at a ${DECK_MAX_SUPPORTED_TOP_INSET_PT}pt inset) `
    + `the scrim is only ${a.toFixed(3)} alpha, giving ${ratio.toFixed(2)}:1`,
  );
  console.log(
    `T-3 lowest chrome pixel y=${LOWEST_CHROME_PIXEL_PT}pt = position `
    + `${p.toFixed(3)} of the ramp -> alpha ${a.toFixed(3)} -> ${ratio.toFixed(2)}:1`,
  );
});

test('T-4 the ramp decays to fully transparent so it never paints a visible edge', () => {
  const alphas = DECK_TOP_SCRIM_COLORS.map(alphaOf);
  assert.equal(
    alphas[alphas.length - 1],
    0,
    'ramp-decays-to-fully-transparent: the last stop must be fully transparent, or the '
    + 'scrim paints a hard horizontal seam across the middle of every photo',
  );
  for (let i = 1; i < alphas.length; i += 1) {
    assert.ok(
      alphas[i] <= alphas[i - 1],
      `ramp-decays-to-fully-transparent: stop ${i} (${alphas[i]}) is DARKER than stop `
      + `${i - 1} (${alphas[i - 1]}) — a top scrim must be monotonically non-increasing `
      + 'or it reads as a band floating in the photo rather than a fade from the edge',
    );
  }
  for (let i = 1; i < DECK_TOP_SCRIM_LOCATIONS.length; i += 1) {
    assert.ok(
      DECK_TOP_SCRIM_LOCATIONS[i] > DECK_TOP_SCRIM_LOCATIONS[i - 1],
      'ramp-decays-to-fully-transparent: gradient locations must strictly increase',
    );
  }
  assert.equal(
    DECK_TOP_SCRIM_LOCATIONS[0], 0,
    'ramp-decays-to-fully-transparent: the ramp must be anchored at the card top edge',
  );
  assert.equal(
    DECK_TOP_SCRIM_LOCATIONS[DECK_TOP_SCRIM_LOCATIONS.length - 1], 1,
    'ramp-decays-to-fully-transparent: the ramp must terminate at the scrim foot',
  );
});

test('T-5 the top and bottom scrims never overlap, so the shipped bottom ramp math stays exact', () => {
  // Curated is the tight case: its bottom scrim is 62% tall, so it begins at 0.38 of
  // the card height. Read the two percentages out of the real sources rather than
  // restating them here.
  // Scope the extraction to the `heroScrim: {` style block in each file. A file-wide
  // percentage sweep also catches `height: '100%'` on the hero image and would make this
  // test pass vacuously on a 100% "bottom scrim" that does not exist.
  const heights = [];
  for (const [name, src] of [['SwipeableCards', stripped.swipeable], ['CuratedExperienceSwipeCard', stripped.curated]]) {
    const blocks = [...src.matchAll(/\bheroScrim:\s*\{([\s\S]*?)\n\s*\},/g)];
    assert.equal(
      blocks.length,
      1,
      `top-and-bottom-scrims-never-overlap: expected exactly ONE \`heroScrim: {\` style `
      + `declaration in ${name}, found ${blocks.length} — this test would then be reading `
      + 'the wrong element',
    );
    const pct = /height:\s*["']([0-9.]+)%["']/.exec(blocks[0][1]);
    assert.ok(
      pct,
      `top-and-bottom-scrims-never-overlap: styles.heroScrim in ${name} no longer declares `
      + 'a percentage height, so the non-overlap arithmetic below cannot be computed',
    );
    heights.push(Number(pct[1]));
  }
  assert.equal(
    heights.length, 2,
    'top-and-bottom-scrims-never-overlap: expected exactly 2 bottom-scrim heights (the '
    + `52% place scrim and the 62% curated scrim), found ${heights.length}`,
  );
  const tallestBottomPct = Math.max(...heights);
  assert.ok(
    tallestBottomPct >= 62,
    'top-and-bottom-scrims-never-overlap: the tallest bottom scrim read as '
    + `${tallestBottomPct}% — expected the curated card's 62%. If that shrank, this test `
    + 'is measuring the wrong element and would pass vacuously',
  );
  const minCardHeightPt = DECK_TOP_SCRIM_HEIGHT_PT / (1 - tallestBottomPct / 100);
  const SHORTEST_SUPPORTED_CARD_PT = 576; // iPhone SE 3rd gen: 667pt screen - 91pt chrome
  assert.ok(
    minCardHeightPt <= SHORTEST_SUPPORTED_CARD_PT,
    'top-and-bottom-scrims-never-overlap: a top scrim of '
    + `${DECK_TOP_SCRIM_HEIGHT_PT}pt against a ${tallestBottomPct}% bottom scrim only `
    + `clears on cards at least ${minCardHeightPt.toFixed(1)}pt tall, but the shortest `
    + `supported card is ${SHORTEST_SUPPORTED_CARD_PT}pt. The two ramps would STACK, and `
    + 'every contrast number in the bottom ramp derivation would be fiction',
  );
  // And on the #1593 reference device, prove it directly.
  const REFERENCE_CARD_H = 783;
  const bottomStartsAt = REFERENCE_CARD_H * (1 - tallestBottomPct / 100);
  assert.ok(
    DECK_TOP_SCRIM_HEIGHT_PT < bottomStartsAt,
    'top-and-bottom-scrims-never-overlap: on the 783pt reference card the top scrim ends '
    + `at ${DECK_TOP_SCRIM_HEIGHT_PT}pt but the bottom scrim begins at `
    + `${bottomStartsAt.toFixed(2)}pt`,
  );
  console.log(
    `T-5 top scrim ends ${DECK_TOP_SCRIM_HEIGHT_PT}pt; tallest bottom scrim begins `
    + `${bottomStartsAt.toFixed(2)}pt on the 783pt reference card; clears on any card `
    + `>= ${minCardHeightPt.toFixed(1)}pt`,
  );
  // Guard the bottom ramp itself is untouched by this amendment.
  assert.deepEqual(
    [...DECK_SCRIM_LOCATIONS],
    [0, 0.32, 0.62, 1],
    'top-and-bottom-scrims-never-overlap: the BOTTOM scrim locations changed. Amendment 4 '
    + 'adds a top anchor and must leave the already-approved bottom ramp byte-identical',
  );
});

test('T-6 every card face mounts the top scrim, and the style carries no flex-axis key', () => {
  // Exact-count extraction FIRST. Zero targets is a failure, not a pass.
  const mounts = [
    ['SwipeableCards', stripped.swipeable, 2],
    ['CuratedExperienceSwipeCard', stripped.curated, 1],
  ];
  for (const [name, src, expected] of mounts) {
    const found = [...src.matchAll(/<LinearGradient\b[\s\S]{0,400}?\/>/g)]
      .filter((m) => /DECK_TOP_SCRIM_COLORS/.test(m[0]) && /styles\.topScrim/.test(m[0]));
    assert.equal(
      found.length,
      expected,
      `every-card-face-mounts-the-top-scrim: expected exactly ${expected} <LinearGradient> `
      + `element(s) in ${name} that use BOTH DECK_TOP_SCRIM_COLORS and styles.topScrim, `
      + `found ${found.length}. In SwipeableCards the two are the front face and the `
      + 'behind/preview face — dropping the behind face flashes a bright band under the '
      + 'chrome on every swipe as the cards swap.',
    );
    for (const m of found) {
      assert.match(
        m[0],
        /locations=\{DECK_TOP_SCRIM_LOCATIONS\}/,
        `every-card-face-mounts-the-top-scrim: a top scrim in ${name} does not use `
        + 'DECK_TOP_SCRIM_LOCATIONS — a per-site locations literal is exactly how the '
        + 'place and curated ramps drifted apart before',
      );
      assert.match(
        m[0],
        /pointerEvents="none"/,
        `every-card-face-mounts-the-top-scrim: a top scrim in ${name} is missing `
        + 'pointerEvents="none" and would take touches off the pan gesture',
      );
    }
  }

  // The style itself: absolute points, no flex-axis key, no percentage.
  for (const [name, src] of [['SwipeableCards', stripped.swipeable], ['CuratedExperienceSwipeCard', stripped.curated]]) {
    const decls = [...src.matchAll(/\btopScrim:\s*\{([\s\S]*?)\n\s*\},/g)];
    assert.equal(
      decls.length,
      1,
      `top-scrim-carries-no-flex-axis-key: expected exactly ONE \`topScrim: {\` style `
      + `declaration in ${name}, found ${decls.length}`,
    );
    const body = decls[0][1];
    assert.doesNotMatch(
      body,
      /\bflex\s*:/,
      `top-scrim-carries-no-flex-axis-key: styles.topScrim in ${name} declares a \`flex\` `
      + 'key. That is the exact shape of #1593 — one flex-axis style resolving to a '
      + 'different height under two different sibling sets. ACTIVE '
      + 'I-PROPOSED-1593-LAYER-GEOMETRY-SINGLE-SOURCE',
    );
    assert.doesNotMatch(
      body,
      /height:\s*["'][0-9.]+%["']/,
      `top-scrim-carries-no-flex-axis-key: styles.topScrim in ${name} sizes its height as `
      + 'a PERCENTAGE. The chrome it protects is laid out in absolute points '
      + '(safeAreaTop + a 44pt row), so a percentage silently under-covers the chrome on '
      + 'any device whose card is shorter than the reference',
    );
    assert.match(
      body,
      /height:\s*DECK_TOP_SCRIM_HEIGHT_PT/,
      `top-scrim-carries-no-flex-axis-key: styles.topScrim in ${name} must take its height `
      + 'from DECK_TOP_SCRIM_HEIGHT_PT, not a local literal',
    );
    assert.match(
      body,
      /top:\s*0/,
      `top-scrim-carries-no-flex-axis-key: styles.topScrim in ${name} is not anchored to `
      + 'the card top edge',
    );
  }
});

test('T-7 the checker actually REJECTS a bare chrome band and a too-weak ramp', () => {
  // If this checker cannot reject a wrong ramp it proves nothing about the right one.
  // Case A is literally the pre-amendment state: no top scrim at all.
  const bad = [
    ['no top scrim at all (the pre-amendment state)',
      ['rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)'], [0, 0.6, 0.82, 1]],
    ['plateau just below the derived minimum',
      ['rgba(0,0,0,0.40)', 'rgba(0,0,0,0.40)', 'rgba(0,0,0,0.12)', 'rgba(0,0,0,0)'], [0, 0.6, 0.82, 1]],
    ['right alpha at the top but decaying before it reaches the chrome',
      ['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.12)', 'rgba(0,0,0,0)'], [0, 0.12, 0.3, 1]],
    ['a mid-band dip that both endpoints hide',
      ['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.20)', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0)'], [0, 0.3, 0.6, 1]],
  ];
  for (const [label, colors, locations] of bad) {
    const failures = checkChromeBand(colors, locations, DECK_TOP_SCRIM_HEIGHT_PT);
    assert.ok(
      failures.length > 0,
      `checker-rejects-a-bare-photo-chrome-band: the contrast checker ACCEPTED a ramp it `
      + `must reject — "${label}". A checker that cannot fail proves nothing about the `
      + 'shipped ramp, which is precisely how seven hollow guards passed on this deck (#1607)',
    );
  }
  // And prove the real ramp is not merely being accepted by a checker that accepts
  // everything: the shipped ramp must pass the same function that rejected all four.
  assert.deepEqual(
    checkChromeBand(DECK_TOP_SCRIM_COLORS, DECK_TOP_SCRIM_LOCATIONS, DECK_TOP_SCRIM_HEIGHT_PT),
    [],
    'checker-rejects-a-bare-photo-chrome-band: the shipped ramp failed the same checker',
  );
});

test('T-8 the #eb7825 notification badge keeps the ring that carries its boundary', () => {
  // The honest finding recorded in deckHeroConstants: the badge FILL cannot reach 3:1
  // against the backdrop at any usable alpha (it is 2.90:1 on bare white, and exactly
  // camouflaged at alpha 0.405). SC 1.4.11 is satisfied by its own opaque ring instead,
  // so the ring is load-bearing for accessibility and must not be removed.
  // `badge: {` appears more than once in designSystem (glass.badge is the LOCKED chip
  // contract). Select the block that actually declares a bgColor — the chrome badge —
  // and assert there is exactly one, so this can never read the wrong block.
  const badgeBlocks = [...stripped.design.matchAll(/\bbadge:\s*\{([\s\S]*?)\n\s*\},/g)]
    .map((m) => m[1])
    .filter((b) => /bgColor:/.test(b));
  assert.equal(
    badgeBlocks.length,
    1,
    'notification-badge-keeps-its-ring: expected exactly ONE `badge: {` block in '
    + `designSystem declaring a bgColor, found ${badgeBlocks.length} — this test would `
    + 'otherwise be reading the wrong block, or passing vacuously',
  );
  const badgeBlock = badgeBlocks[0];
  const bg = /bgColor:\s*'(#[0-9a-fA-F]{6})'/.exec(badgeBlock);
  const ring = /borderColor:\s*'rgba\((\d+),\s*(\d+),\s*(\d+),\s*1\)'/.exec(badgeBlock);
  const ringW = /borderWidth:\s*([0-9.]+)/.exec(badgeBlock);
  assert.ok(bg && ring && ringW, 'notification-badge-keeps-its-ring: badge fill, ring colour or ring width missing');
  assert.equal(
    bg[1].toLowerCase(), '#eb7825',
    'notification-badge-keeps-its-ring: the badge fill is no longer the brand accent — '
    + 'the luminance figures in this test no longer describe the shipped badge',
  );
  assert.ok(
    Number(ringW[1]) >= 1,
    `notification-badge-keeps-its-ring: the badge ring shrank to ${ringW[1]}pt`,
  );

  const fillL = luminanceOfRgb(0xeb, 0x78, 0x25);
  const ringL = luminanceOfRgb(Number(ring[1]), Number(ring[2]), Number(ring[3]));
  const scrimmedBackdropL = luminanceOfGrey(
    compositedOverWhite(alphaOf(DECK_TOP_SCRIM_COLORS[0])),
  );
  const fillVsRing = contrast(fillL, ringL);
  const ringVsBackdrop = contrast(ringL, scrimmedBackdropL);
  assert.ok(
    fillVsRing >= NON_TEXT_MIN_RATIO,
    `notification-badge-keeps-its-ring: badge fill vs its own ring is ${fillVsRing.toFixed(2)}:1`,
  );
  assert.ok(
    ringVsBackdrop >= NON_TEXT_MIN_RATIO,
    'notification-badge-keeps-its-ring: the badge ring against the SCRIMMED backdrop is '
    + `only ${ringVsBackdrop.toFixed(2)}:1. The badge fill itself is `
    + `${contrast(fillL, scrimmedBackdropL).toFixed(2)}:1 against that backdrop, so the `
    + 'ring is the only thing separating the badge from the photo — if the ring stops '
    + 'clearing 3:1 the badge is no longer identifiable at all',
  );
  console.log(
    `T-8 badge fill L=${fillL.toFixed(6)}, ring L=${ringL.toFixed(6)}, scrimmed backdrop `
    + `L=${scrimmedBackdropL.toFixed(6)} | fill-vs-ring ${fillVsRing.toFixed(2)}:1, `
    + `ring-vs-backdrop ${ringVsBackdrop.toFixed(2)}:1, fill-vs-backdrop `
    + `${contrast(fillL, scrimmedBackdropL).toFixed(2)}:1 (documented as carried by the ring)`,
  );
});

test('T-9 every CLAIM in this file header appears in a real assertion message', () => {
  const claims = [...source.self.matchAll(/^\/\/\s+CLAIM:\s+(\S+)$/gm)].map((m) => m[1]);
  assert.ok(
    claims.length >= 9,
    `VACUITY: expected at least 9 CLAIM tokens in the header, found ${claims.length}`,
  );
  const body = stripComments(source.self);
  for (const claim of claims) {
    assert.ok(
      body.includes(claim),
      `VACUITY: CLAIM "${claim}" is advertised in this guard's header but appears in no `
      + 'assertion message in its body — the header would be describing coverage that '
      + 'does not exist, which is the #1607 hollow-guard shape',
    );
  }
});
