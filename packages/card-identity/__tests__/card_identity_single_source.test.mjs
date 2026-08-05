/**
 * I-PROPOSED-C-CARD-IDENTITY-SINGLE-SOURCE — the executing gate.
 *
 * Issue #1609, Direction C. Registered in
 * .github/workflows/issue-1609-card-identity.yml.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS GUARD IS SHAPED THE WAY IT IS
 *
 * #1607 exists because six shipped guards assert something ADJACENT to the
 * behaviour instead of the behaviour: one is satisfied by a comment, one slices
 * on an anchor string that does not appear in the file it reads. A guard that
 * re-states the design's own numbers back to itself proves nothing — it is the
 * unfalsifiable-test class, green CI over a broken product.
 *
 * So this file does three things that a source-grep cannot:
 *
 *   G1  It scans the real card sources for the forbidden literal set,
 *       allowlisting ONLY the package. Comments are stripped first, so no
 *       assertion here can be satisfied — or tripped — by prose.
 *
 *   G2  It IMPORTS THE REAL `scrimHeight`, `plateUnderAlpha` and
 *       `rampAlphaAtDepth` and runs an INDEPENDENT WCAG + CIE L* oracle over
 *       every surface descriptor. The oracle's colour maths is re-derived here
 *       from the sRGB and CIE definitions and shares NO code with the package —
 *       that is the whole point, and T-0 proves the two agree on a published
 *       reference while T-9 proves the oracle REJECTS known-bad values.
 *
 *   G3  It asserts the surface descriptors are exported and complete, so a new
 *       surface cannot be added without entering the oracle.
 *
 * ---------------------------------------------------------------------------
 * FAILS-ON-REVERT, PROVEN THREE WAYS (see the #1609 implementation report):
 *   - restore any one triplicated ramp literal to a card file   -> G1 fires
 *   - change PLATE.lift by 0.02                                 -> G2 fires on L*
 *   - add an eighth surface without a verdict                   -> G3 fires
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
/** THE REAL MODULE. Not a copy of its numbers — the functions themselves. */
const CI = require_('../index.js');

// ─────────────────────────────────────────────────────────────────────────────
// The independent oracle. Re-derived from the specifications, sharing no code
// with the package under test.
// ─────────────────────────────────────────────────────────────────────────────

/** IEC 61966-2-1 sRGB EOTF. */
function toLinear(channel8) {
  const c = channel8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance (Rec. 709 coefficients). */
function luminance([r, g, b]) {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG 2.1 contrast ratio. */
function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** CIE 1976 L*, from a D65-relative luminance. */
function lStar(y) {
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

/** Straight-alpha source-over composite. */
function composite(fg, alpha, bg) {
  return [
    fg[0] * alpha + bg[0] * (1 - alpha),
    fg[1] * alpha + bg[1] * (1 - alpha),
    fg[2] * alpha + bg[2] * (1 - alpha),
  ];
}

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
/** The greyscale photo sweep. 41 samples across the full 0..255 range. */
const PHOTO_SWEEP = Array.from({ length: 41 }, (_, i) => (255 * i) / 40);

function parseRgba(str) {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(str);
  assert.ok(m, `oracle: could not parse colour "${str}"`);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: m[4] === undefined ? 1 : Number(m[4]) };
}

/** The backdrop a plate sits on: a photo of luminance `photo8`, under the scrim. */
function backdropAt(photo8, scrimAlpha) {
  return composite(BLACK, scrimAlpha, [photo8, photo8, photo8]);
}

/** The plate's two-layer composite over that backdrop. */
function plateOver(backdrop, under) {
  return composite(
    CI.PLATE.liftRgb,
    CI.PLATE.liftAlpha,
    composite(CI.PLATE.underRgb, under, backdrop),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// What is BUILT, and what is not. G3's new-surface trap hangs off this.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wave 1 builds S1 only. A surface is `built` when a real file renders it, and
 * only a built surface's file can be scanned by G1 — but EVERY surface, built or
 * not, goes through G2's oracle, because the point of the descriptor table is
 * that a value cannot enter the system without being measured.
 */
const BUILT = new Set(['s1Single', 's1Curated']);

/**
 * Designed, measured, and CLEARING every floor — but no file renders them yet
 * (waves 3 and 4). They are held to exactly the same floors as a built surface,
 * because the whole point of measuring the descriptor rather than the pixels is
 * that the verdict does not wait for the file.
 */
const DESIGNED = new Set(['s4Snippet', 's6Phone']);

/** Held to the floors: everything that is not explicitly pinned as open. */
function heldToFloors(key) {
  return BUILT.has(key) || DESIGNED.has(key);
}

/**
 * MEASURED SHORTFALLS ON SURFACES THAT ARE NOT BUILT YET.
 *
 * These are NOT waivers and they are NOT skips. Running this oracle for the
 * first time against the design's own descriptors found that the plate's
 * boundary against the photograph, and the curated slivers, do NOT clear their
 * 3:1 floors on S2, S3 and S5 — the design states 3.17:1 for S2 and "identical"
 * for S3, and states the slivers land "exactly on 3.00:1". They do not.
 *
 * Pinning the measured values here means (a) the numbers cannot drift further
 * without failing this gate, and (b) waves 2 and 3 cannot mark those surfaces
 * `built` until the shortfall is designed out — at which point the pin fails and
 * has to be deleted, which is the point.
 *
 * Reported against #1609; the S2/S3/S5 fix belongs to waves 2 and 3.
 */
const KNOWN_OPEN = {
  s2Grid: { boundary: 2.2, slivers: [3.02, 2.44] },
  s3Chat: { boundary: 2.2, slivers: [2.95, 2.23] },
  s5Og: { boundary: 2.68, slivers: [8.02, 7.58] },
};

// ─────────────────────────────────────────────────────────────────────────────
// G1 — the forbidden literal set
// ─────────────────────────────────────────────────────────────────────────────

const REPO = new URL('../../../', import.meta.url);

/** The files that render a Direction-C card TODAY. Grows with each wave. */
const SCANNED = {
  'SwipeableCards.tsx': 'app-mobile/src/components/SwipeableCards.tsx',
  'CuratedExperienceSwipeCard.tsx': 'app-mobile/src/components/CuratedExperienceSwipeCard.tsx',
  'deckCardPlate.tsx': 'app-mobile/src/components/deckCardPlate.tsx',
  'deckHeroConstants.ts': 'app-mobile/src/components/deckHeroConstants.ts',
};

function read(rel) {
  return readFileSync(fileURLToPath(new URL(rel, REPO)), 'utf8');
}

/**
 * Strip `//` and block comments, and JSX `{/* ... *\/}` blocks, so that no
 * assertion in this file can be satisfied OR tripped by prose. This is the
 * defect class #1607 named: a guard one of whose assertions was satisfied by a
 * comment. String literals are preserved, because they are exactly what G1 hunts.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (inLine) {
      if (c === '\n') { inLine = false; out += c; }
      i += 1;
      continue;
    }
    if (inBlock) {
      if (c === '*' && n === '/') { inBlock = false; i += 2; continue; }
      if (c === '\n') out += c;
      i += 1;
      continue;
    }
    if (quote) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i += 1; continue; }
    if (c === '/' && n === '/') { inLine = true; i += 2; continue; }
    if (c === '/' && n === '*') { inBlock = true; i += 2; continue; }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * Every literal that MUST come from the package. Each entry is [pattern, why].
 * The ramp stops are here because they were triplicated across
 * SwipeableCards.tsx:3079, :3292 and CuratedExperienceSwipeCard.tsx:444 before
 * #1609, and that triplication is how the place card and the curated card
 * drifted apart in the first place.
 */
const FORBIDDEN = [
  [/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\.(42|78|94|60|30)\s*\)/, 'a scrim ramp stop'],
  [/rgb\(\s*53\s*,\s*56\s*,\s*63\s*\)/, "the plate's opaque fallback solid"],
  [/rgba\(\s*12\s*,\s*14\s*,\s*18\s*,/, "the plate's under-layer"],
  [/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.(12|38|50|22|45|72|90|44|14|46|24)\s*\)/, 'a plate or plate-furniture fill'],
  [/rgba\(\s*34\s*,\s*197\s*,\s*94\s*,/, "the Been-here settled fill"],
  [/rgba\(\s*134\s*,\s*239\s*,\s*172\s*,/, "the Been-here settled border"],
  [/rgba\(\s*185\s*,\s*28\s*,\s*28\s*,/, "the Been-here failed fill"],
  [/rgba\(\s*254\s*,\s*202\s*,\s*202\s*,/, "the Been-here failed border"],
  // A percentage height on a scrim or plate is the #1593 / device-dependence
  // defect, not merely a style choice.
  [/(heroScrim|topScrim|plate|scrim)\s*:\s*\{[^}]*height\s*:\s*['"][\d.]+%['"]/i, 'a PERCENTAGE scrim/plate height'],
];

test('G1 no card surface carries a literal the package owns', () => {
  let scanned = 0;
  for (const [name, rel] of Object.entries(SCANNED)) {
    const code = stripComments(read(rel));
    // Anti-vacuity: prove the file really was read and really was stripped.
    assert.ok(code.length > 500, `G1: ${name} stripped to ${code.length} chars — it was not read`);
    scanned += 1;
    for (const [pattern, why] of FORBIDDEN) {
      const hit = pattern.exec(code);
      assert.equal(
        hit,
        null,
        `G1: ${name} hard-codes ${why} (${hit && hit[0]}). Every such value MUST come from `
        + '@mingla/card-identity — that is I-PROPOSED-C-CARD-IDENTITY-SINGLE-SOURCE. The ramp '
        + 'literal was triplicated across three files before #1609 and the place card and the '
        + 'curated card drifted apart in exactly that way.',
      );
    }
  }
  assert.equal(scanned, Object.keys(SCANNED).length, 'G1: not every scanned file was visited');
});

test('G1b the package itself DOES own the literals — the allowlist is not empty', () => {
  const pkg = readFileSync(fileURLToPath(new URL('../index.js', import.meta.url)), 'utf8');
  // If the values did not live here, G1 would pass vacuously by them living nowhere.
  for (const needle of ['rgba(0,0,0,0.42)', 'rgb(53,56,63)', 'rgba(255,255,255,0.38)', 'rgba(34,197,94,0.42)']) {
    assert.ok(pkg.includes(needle), `G1b: @mingla/card-identity no longer declares ${needle}`);
  }
});

/**
 * The style keys and elements Direction C DELETES from the card face. Each is
 * named individually rather than swept with a broad regex, because
 * SwipeableCards.tsx is a 4,500-line file that also carries empty states, error
 * states and legacy chrome — a file-wide `flexWrap` scan reports
 * `highlightsContainer`, which is not on the card face and never was. A guard
 * that cries wolf gets weakened; a guard that names its target does not.
 */
const DELETED_FROM_FACE = [
  ['<GlassBadge', 'a GlassBadge chip — five chips are five BlurViews, five shadowed lifted objects and five staggered Animated.Views in the promotion diff (#1576)'],
  ['entryIndex', 'the per-badge entryIndex stagger, the exact shape that produced #1576'],
  ['detailsBadges', 'the chip row — one of the two flexWrap containers on the face'],
  ['actionRail', 'the action rail; its controls belong on the plate'],
  ['railHint', 'the rail hint; the chevron in the plate divider replaces it'],
  ['railHintText', 'the "Details" text, which was explicitly ruled out'],
  ['details_hint', 'the "Details" i18n key'],
  ['been_here_ask', 'the "Been here?" question mark, which was explicitly ruled out'],
  ['stateBadgesRow', 'the saved/scheduled chip row; those become the top-right state discs'],
  ['ribbonNode', 'the curated stop ribbon (D-5)'],
  ['ribbonConnector', 'the curated stop ribbon (D-5)'],
];

test('G1c the deleted card furniture has not come back', () => {
  for (const [name, rel] of Object.entries(SCANNED)) {
    const code = stripComments(read(rel));
    for (const [needle, why] of DELETED_FROM_FACE) {
      assert.equal(
        code.includes(needle),
        false,
        `G1c: ${name} reintroduces ${needle} — ${why}.`,
      );
    }
  }
  // The plate module is small and wholly card-face, so it CAN be swept broadly.
  const plate = stripComments(read(SCANNED['deckCardPlate.tsx']));
  assert.equal(
    /flexWrap/.test(plate),
    false,
    'G1c: deckCardPlate.tsx uses flexWrap. Every variable-length row on the card face must be '
    + 'numberOfLines-clamped; the title is the only 2-line element, and that is what makes the '
    + 'silhouette guarantee hold.',
  );
  // Anti-vacuity: the needles must be findable SOMEWHERE, or this test passes
  // because the strings are simply misspelled.
  const history = read('app-mobile/src/components/SwipeableCards.tsx');
  assert.ok(
    history.includes('detailsBadges') && history.includes('actionRail'),
    'G1c: the deleted names appear nowhere in the file at all, not even in the comments that '
    + 'record their deletion — the needles are probably wrong and this test is vacuous.',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// G2 — the independent oracle
// ─────────────────────────────────────────────────────────────────────────────

test('T-0 the independent oracle reproduces a published reference value', () => {
  // If the oracle's own maths is wrong, every assertion below is decoration.
  // sRGB white on black is exactly 21:1, and black is L* 0, white L* 100.
  assert.ok(Math.abs(ratio(WHITE, BLACK) - 21) < 1e-9, 'oracle: white-on-black is not 21:1');
  assert.ok(Math.abs(lStar(luminance(WHITE)) - 100) < 1e-9, 'oracle: white is not L* 100');
  assert.ok(Math.abs(lStar(luminance(BLACK))) < 1e-9, 'oracle: black is not L* 0');
  // And it reproduces the design's published plate tone for the opaque path.
  const solid = parseRgba(CI.PLATE.fallbackSolid).rgb;
  const l = lStar(luminance(solid));
  assert.ok(
    Math.abs(l - CI.PLATE.targetLstar) <= 0.1,
    `oracle: PLATE.fallbackSolid measures L* ${l.toFixed(2)}, expected ~${CI.PLATE.targetLstar}`,
  );

  // plateUnderAlpha must be a real SOLVER, not a constant that happens to equal
  // S1's answer. Stubbing it would leave every S1 assertion green while S2 and S3
  // — whose scrims are half as deep — silently drew a different object. It is
  // strictly decreasing in the scrim alpha: the shallower the scrim, the more the
  // under-layer has to do.
  const shallow = CI.plateUnderAlpha(0.42);
  const deep = CI.plateUnderAlpha(0.84);
  assert.ok(
    shallow > deep + 0.05,
    `oracle: plateUnderAlpha is not responsive to its input (0.42 -> ${shallow}, 0.84 -> ${deep}). `
    + 'A constant would keep S1 green and let every other surface drift.',
  );
  assert.ok(shallow > 0 && shallow < 1 && deep > 0 && deep < 1, 'oracle: plateUnderAlpha left the unit interval');
});

test('T-1 the REAL scrimHeight() reproduces every surface height from first principles', () => {
  // Not a table of numbers copied from the design — the FUNCTION is called, and
  // its two clauses are checked to actually bind.
  for (const key of Object.keys(CI.SURFACES)) {
    const s = CI.SURFACES[key];
    const dPlate = CI.plateTopDepth(key);
    const dTitle = CI.titleTopDepth(key);
    const H = CI.surfaceScrimHeight(key);

    assert.equal(H, CI.scrimHeight(dPlate, dTitle, s.h), `T-1 ${key}: surfaceScrimHeight disagrees with scrimHeight`);
    assert.equal(H % 2, 0, `T-1 ${key}: scrim height ${H} is odd — it must round to an even point`);
    assert.ok(H <= s.h, `T-1 ${key}: scrim ${H} exceeds the card height ${s.h}`);

    // Clause 1: alpha at the plate's top edge clears the plate's material floor.
    const aPlate = CI.rampAlphaAtDepth(dPlate, H);
    assert.ok(
      aPlate >= CI.PLATE_ALPHA_FLOOR - 1e-9,
      `T-1 ${key}: scrim alpha at the plate's top edge is ${aPlate.toFixed(4)}, below the `
      + `${CI.PLATE_ALPHA_FLOOR} material floor — plateUnderAlpha would have to exceed 0.95 and `
      + 'the glass would stop being glass',
    );

    // Clause 2: alpha at the title's top edge, when the title is on the photo.
    if (!s.titleOnPlate) {
      const aTitle = CI.rampAlphaAtDepth(dTitle, H);
      assert.ok(
        aTitle >= CI.TITLE_ALPHA_FLOOR - 1e-9,
        `T-1 ${key}: scrim alpha at the title's top edge is ${aTitle.toFixed(4)}, below the `
        + `${CI.TITLE_ALPHA_FLOOR} floor back-solved from the 3:1 large-text bar`,
      );
    } else {
      assert.equal(dTitle, 0, `T-1 ${key}: title is on the plate, so dTitleTop must self-disable to 0`);
    }
  }
});

test('T-2 every plate composite lands on the SAME L*, on every surface', () => {
  // This is the entire "one object at every size" claim, and it is measured
  // rather than asserted. The backdrop is the derivation's worst case: a
  // pure-white photograph under the scrim at the plate's top edge.
  const measured = [];
  for (const key of Object.keys(CI.SURFACES)) {
    const H = CI.surfaceScrimHeight(key);
    const alpha = CI.rampAlphaAtDepth(CI.plateTopDepth(key), H);
    const under = CI.plateUnderAlpha(alpha);
    assert.ok(under > 0 && under < 0.95, `T-2 ${key}: derived under-layer alpha ${under} is out of material range`);

    const plate = plateOver(backdropAt(255, alpha), under);
    const l = lStar(luminance(plate));
    measured.push(l);
    assert.ok(
      Math.abs(l - CI.PLATE.targetLstar) <= 2.0,
      `T-2 ${key}: plate composite is L* ${l.toFixed(2)}, more than 2.0 from the `
      + `${CI.PLATE.targetLstar} target. A fixed recipe on seven different scrim depths produces `
      + 'seven different-looking objects; the recipe is derived so the RESULT is fixed.',
    );
  }
  const spread = Math.max(...measured) - Math.min(...measured);
  assert.ok(
    spread <= 0.5,
    `T-2: the plate's L* spread across all surfaces is ${spread.toFixed(2)} — the just-noticeable `
    + 'difference for a large flat field is ~2-3 L*, so the spread must be far below it',
  );
});

test('T-3 text on the plate clears its floors, on every surface', () => {
  for (const key of Object.keys(CI.SURFACES)) {
    const H = CI.surfaceScrimHeight(key);
    const alpha = CI.rampAlphaAtDepth(CI.plateTopDepth(key), H);
    const plate = plateOver(backdropAt(255, alpha), CI.plateUnderAlpha(alpha));

    const white = ratio(WHITE, plate);
    assert.ok(white >= 4.5, `T-3 ${key}: white meta on the plate measures ${white.toFixed(2)}:1, floor 4.5`);

    const dim = parseRgba(CI.META.tail.color);
    const dimSpan = composite(dim.rgb, dim.alpha, plate);
    const dimRatio = ratio(dimSpan, plate);
    assert.ok(
      dimRatio >= 4.5,
      `T-3 ${key}: the ${CI.META.tail.color} category span measures ${dimRatio.toFixed(2)}:1, floor 4.5. `
      + 'It is the sacrificial tail of the meta line, but it is still text.',
    );

    const sep = parseRgba(CI.META.separator.color);
    const sepRatio = ratio(composite(sep.rgb, sep.alpha, plate), plate);
    assert.ok(
      sepRatio >= 3.0,
      `T-3 ${key}: the meta separators measure ${sepRatio.toFixed(2)}:1, floor 3.0 (non-text structural marks)`,
    );
  }
});

test("T-4 the plate's boundary against the photograph, swept over the full luminance range", () => {
  // SC 1.4.11 is satisfied by max(fill, border), not by either alone: on a bright
  // photo the dark fill carries it, on a dark photo the light border does. The
  // border is composited over the ADJACENT backdrop, which is the conservative
  // reading and the one the design's published 3.17:1 comes from.
  for (const key of Object.keys(CI.SURFACES)) {
    const H = CI.surfaceScrimHeight(key);
    const alpha = CI.rampAlphaAtDepth(CI.plateTopDepth(key), H);
    const under = CI.plateUnderAlpha(alpha);

    let worst = Infinity;
    for (const photo of PHOTO_SWEEP) {
      const backdrop = backdropAt(photo, alpha);
      const plate = plateOver(backdrop, under);
      const border = composite(CI.PLATE.borderRgb, CI.PLATE.borderAlpha, backdrop);
      worst = Math.min(worst, Math.max(ratio(plate, backdrop), ratio(border, backdrop)));
    }

    if (heldToFloors(key)) {
      assert.ok(
        worst >= 3.0,
        `T-4 ${key}: the plate's worst-case boundary is ${worst.toFixed(2)}:1, floor 3.0 (SC 1.4.11). `
        + 'For scale, the shipped Discover bottomChip 0.14 border measures 1.55:1 and the old '
        + 'GlassBadge 0.30 border 2.46:1 — both live failures. That is why the border is 0.38.',
      );
    } else {
      const pin = KNOWN_OPEN[key];
      assert.ok(pin, `T-4 ${key}: a surface with no recorded verdict — see G3`);
      assert.ok(
        Math.abs(worst - pin.boundary) <= 0.05,
        `T-4 ${key}: boundary measured ${worst.toFixed(2)}:1 but the recorded shortfall is `
        + `${pin.boundary}:1. This is a PIN, not a waiver — if the number moved, either the fix `
        + 'landed (delete the pin and mark the surface built) or something drifted.',
      );
    }
  }
});

test('T-5 every title that sits on the photograph clears 3:1 at its TOP edge', () => {
  // The top edge is where the scrim is shallowest, so it is the only edge worth
  // measuring. 30/700 qualifies as large text (>= 18.66pt bold), floor 3.0.
  for (const key of Object.keys(CI.SURFACES)) {
    const s = CI.SURFACES[key];
    if (s.titleOnPlate) continue;
    const H = CI.surfaceScrimHeight(key);
    const aTitle = CI.rampAlphaAtDepth(CI.titleTopDepth(key), H);
    const r = ratio(WHITE, backdropAt(255, aTitle));
    assert.ok(
      r >= 3.0,
      `T-5 ${key}: the title's top edge measures ${r.toFixed(2)}:1 against a pure-white photograph, floor 3.0`,
    );
    // The title must be large enough for the 3:1 bar to be the right bar.
    assert.ok(
      s.titleSize >= 18.66 && Number(s.titleWeight) >= 700,
      `T-5 ${key}: title is ${s.titleSize}/${s.titleWeight} — below the large-text threshold, so `
      + 'the governing floor would be 4.5:1, not 3.0:1',
    );
  }
});

test('T-6 both curated slivers clear 3:1 against their OWN backdrop, at every surface', () => {
  // The design's first pass claimed the stack had "zero contrast risk (each
  // sliver carries its own fill)". That is wrong: a sliver's fill is a
  // translucent white over the SCRIM, and what matters is its ratio against the
  // scrim immediately around it — nearly the same tone. SC 1.4.11 applies because
  // the stack is the SOLE curated marker.
  for (const key of Object.keys(CI.SURFACES)) {
    const s = CI.SURFACES[key];
    const H = CI.surfaceScrimHeight(key);
    const measured = [];
    for (let i = 0; i < CI.SLIVER.offsets.length; i += 1) {
      const depth = s.bottomInset + s.plateH + CI.SLIVER.offsets[i] + s.sliver.height / 2;
      const backdrop = backdropAt(255, CI.rampAlphaAtDepth(depth, H));
      const alpha = i === 1 && s.sliver.alpha2 ? s.sliver.alpha2 : s.sliver.alpha;
      const fill = s.sliver.forcedOpaque ? WHITE : composite(WHITE, alpha, backdrop);
      measured.push(ratio(fill, backdrop));
    }

    if (heldToFloors(key)) {
      measured.forEach((r, i) => {
        assert.ok(
          r >= 3.0,
          `T-6 ${key} sliver${i + 1}: ${r.toFixed(2)}:1 against its own backdrop, floor 3.0. `
          + 'At the originally specified 0.34 / 0.22 these measure 2.85:1 and 1.98:1 and FAIL.',
        );
      });
    } else {
      const pin = KNOWN_OPEN[key];
      assert.ok(pin, `T-6 ${key}: a surface with no recorded verdict — see G3`);
      measured.forEach((r, i) => {
        assert.ok(
          Math.abs(r - pin.slivers[i]) <= 0.05,
          `T-6 ${key} sliver${i + 1}: measured ${r.toFixed(2)}:1 but the recorded value is `
          + `${pin.slivers[i]}:1 — the pin moved.`,
        );
      });
    }
  }
});

test('T-7 the Been-here control clears its floors in every state, on the plate', () => {
  const H = CI.surfaceScrimHeight('s1Single');
  const alpha = CI.rampAlphaAtDepth(CI.plateTopDepth('s1Single'), H);
  const plate = plateOver(backdropAt(255, alpha), CI.plateUnderAlpha(alpha));

  const states = Object.keys(CI.BEEN_HERE.states);
  assert.ok(states.length === 5, `T-7: expected 5 Been-here states, found ${states.length}`);

  for (const name of states) {
    const st = CI.BEEN_HERE.states[name];
    const f = parseRgba(st.fill);
    const fill = composite(f.rgb, f.alpha, plate);
    const label = ratio(WHITE, fill);
    assert.ok(label >= 4.5, `T-7 ${name}: the white label measures ${label.toFixed(2)}:1 on its fill, floor 4.5`);

    const b = parseRgba(st.border);
    const border = composite(b.rgb, b.alpha, plate);
    const edge = ratio(border, plate);
    assert.ok(
      edge >= 3.0,
      `T-7 ${name}: the border measures ${edge.toFixed(2)}:1 against the plate, floor 3.0. THE BORDER `
      + 'IS LOAD-BEARING — the control sits on the plate and its fill is the same family as the '
      + "plate's, so the boundary is carried by the border alone. The minimum white border alpha "
      + 'for 3:1 here is 0.349, which is why 0.30 would fail.',
    );

    // The Android opaque equivalents must be matched, not merely present.
    const aFill = parseRgba(st.androidFill).rgb;
    const dL = Math.abs(lStar(luminance(aFill)) - lStar(luminance(fill)));
    assert.ok(
      dL <= 3.0,
      `T-7 ${name}: the Android opaque fill is ${dL.toFixed(2)} L* from the iOS composite — beyond `
      + 'the ~2-3 L* just-noticeable difference, so the two platforms would read as different objects',
    );
  }

  // Three non-colour channels, so state never depends on colour alone.
  assert.notEqual(CI.BEEN_HERE.states.rest.fill, CI.BEEN_HERE.states.settled.fill, 'T-7: rest and settled share a fill');
  assert.ok(CI.BEEN_HERE.glyphSize.rest !== CI.BEEN_HERE.glyphSize.active, 'T-7: the glyph does not change with state');
});

test('T-8 the top and bottom scrims never overlap, so the ramp arithmetic stays exact', () => {
  for (const key of Object.keys(CI.SURFACES)) {
    const s = CI.SURFACES[key];
    if (!s.topScrim) continue;
    const total = CI.RAMP.top.heightPt + CI.surfaceScrimHeight(key);
    assert.ok(
      total <= s.h,
      `T-8 ${key}: top ${CI.RAMP.top.heightPt} + bottom ${CI.surfaceScrimHeight(key)} = ${total} > card ${s.h}. `
      + 'Overlapping scrims stack their alphas and every number in the bottom ramp derivation '
      + 'becomes fiction.',
    );
  }
  // S6 phone is the surface where it does NOT fit, and it must declare that
  // rather than silently overlapping.
  const s6 = CI.SURFACES.s6Phone;
  assert.equal(
    s6.topScrim,
    false,
    'T-8: S6 phone must omit the top scrim — 200 + 316 = 516 > 480, and a web page has no '
    + 'floating chrome over the hero to protect',
  );
});

test('T-9 the oracle REJECTS known-bad values — it is not a rubber stamp', () => {
  const H = CI.surfaceScrimHeight('s1Single');
  const alpha = CI.rampAlphaAtDepth(CI.plateTopDepth('s1Single'), H);
  const plate = plateOver(backdropAt(255, alpha), CI.plateUnderAlpha(alpha));

  // The 0.30 border the chips shipped with. The design's §3.2 said 2.54:1; this
  // oracle measures 2.4648 and #1609's tester re-derived the same 2.465 from the
  // spec's stated values alone, importing nothing from this package. 2.46 is the
  // number; the docblocks that said 2.54 have been corrected. Both are below the
  // 3.0 floor, so the border stays 0.38 and nothing downstream moves.
  let worst = Infinity;
  for (const photo of PHOTO_SWEEP) {
    const backdrop = backdropAt(photo, alpha);
    const pl = plateOver(backdrop, CI.plateUnderAlpha(alpha));
    const border = composite([255, 255, 255], 0.3, backdrop);
    worst = Math.min(worst, Math.max(ratio(pl, backdrop), ratio(border, backdrop)));
  }
  assert.ok(worst < 3.0, `T-9: the oracle ACCEPTED a 0.30 border (${worst.toFixed(2)}:1) — it does not discriminate`);

  // The sliver alphas the design first proposed.
  const depth = CI.SURFACES.s1Single.bottomInset + CI.SURFACES.s1Single.plateH + 2;
  const bd = backdropAt(255, CI.rampAlphaAtDepth(depth, H));
  assert.ok(ratio(composite(WHITE, 0.34, bd), bd) < 3.0, 'T-9: the oracle ACCEPTED the rejected 0.34 sliver');
  assert.ok(ratio(composite(WHITE, 0.22, bd), bd) < 3.0, 'T-9: the oracle ACCEPTED the rejected 0.22 sliver');

  // A white label on brand orange, which the design found fails AA.
  const accentLabel = ratio(WHITE, [235, 120, 37]);
  assert.ok(accentLabel < 4.5, `T-9: the oracle ACCEPTED white on #eb7825 (${accentLabel.toFixed(2)}:1)`);

  // And a plate whose lift drifted by 0.02 must move the L* measurably — this is
  // the second of the three fails-on-revert proofs.
  const drifted = composite([255, 255, 255], CI.PLATE.liftAlpha + 0.02,
    composite(CI.PLATE.underRgb, CI.plateUnderAlpha(alpha), backdropAt(255, alpha)));
  const dL = Math.abs(lStar(luminance(drifted)) - lStar(luminance(plate)));
  assert.ok(dL > 0.5, `T-9: a 0.02 lift drift moved L* by only ${dL.toFixed(3)} — the oracle is too blunt to catch it`);
});

// ─────────────────────────────────────────────────────────────────────────────
// G3 — a new surface cannot be added without entering the oracle
// ─────────────────────────────────────────────────────────────────────────────

test('G3 every surface descriptor is exported, complete, and has a verdict', () => {
  const keys = Object.keys(CI.SURFACES);
  assert.ok(keys.length >= 7, `G3: expected at least the seven designed surfaces, found ${keys.length}`);

  const REQUIRED = [
    'label', 'w', 'h', 'cardR', 'sideInset', 'bottomInset', 'plateW', 'plateH', 'plateR',
    'titleSize', 'titleLH', 'titleLines', 'titleWeight', 'titleInset', 'metaSize', 'gap',
    'titleOnPlate', 'controls', 'topScrim', 'curated', 'sliver',
  ];

  for (const key of keys) {
    const s = CI.SURFACES[key];
    for (const field of REQUIRED) {
      assert.ok(
        s[field] !== undefined,
        `G3: surface "${key}" is missing "${field}". A surface cannot enter the system without `
        + 'every value the oracle measures.',
      );
    }
    // The plate must actually fit inside the card, with the declared insets.
    assert.equal(
      s.plateW,
      s.w - 2 * s.sideInset,
      `G3: surface "${key}" declares plateW ${s.plateW} but w - 2*sideInset is ${s.w - 2 * s.sideInset}`,
    );
    // THE NEW-SURFACE TRAP. Every surface is either built (and held to the
    // floors) or has a recorded verdict. Adding an eighth without deciding fails.
    const verdicts = [BUILT.has(key), DESIGNED.has(key), Object.prototype.hasOwnProperty.call(KNOWN_OPEN, key)]
      .filter(Boolean).length;
    assert.equal(
      verdicts,
      1,
      `G3: surface "${key}" has ${verdicts} verdicts, expected exactly 1. Every surface MUST be `
      + 'exactly one of BUILT (a file renders it), DESIGNED (measured and clearing every floor, '
      + 'no file yet) or KNOWN_OPEN (measured and NOT clearing a floor, with the shortfall pinned). '
      + 'A new surface cannot be added without entering the oracle with a verdict — that is the '
      + 'whole mechanism this invariant exists for.',
    );
  }

  // And the pins must not outlive their surfaces.
  for (const key of Object.keys(KNOWN_OPEN)) {
    assert.ok(CI.SURFACES[key], `G3: KNOWN_OPEN records "${key}", which is no longer a surface`);
    assert.ok(!BUILT.has(key), `G3: "${key}" is BUILT but still carries a KNOWN_OPEN pin — delete the pin`);
  }
  for (const key of [...BUILT, ...DESIGNED]) {
    assert.ok(CI.SURFACES[key], `G3: "${key}" has a verdict but is no longer a surface`);
  }
});

test('G3b the plate arithmetic is a single derivation, not a typed-in number', () => {
  // 1 (border) + 40 (meta) + 1 (divider) + control + 1 (border) = plateH.
  const rows = CI.plateRows(CI.SURFACES.s1Single.plateH, true);
  const total = 2 * CI.PLATE.borderWidth + rows.meta + rows.divider + rows.control;
  assert.equal(
    total,
    CI.SURFACES.s1Single.plateH,
    `G3b: the plate's rows sum to ${total}, not ${CI.SURFACES.s1Single.plateH}. This one arithmetic `
    + 'assertion IS the silhouette.',
  );
  assert.equal(rows.meta, CI.META_ROW_H, 'G3b: the meta row is no longer a fixed height');
  assert.ok(
    rows.control >= CI.BEEN_HERE.height,
    `G3b: the control row is ${rows.control}pt, which cannot contain the ${CI.BEEN_HERE.height}pt Been-here target`,
  );

  // The ONE alternate silhouette, and it must also fit the control.
  const alt = CI.plateRows(CI.PLATE_H_NO_META, false);
  assert.equal(alt.meta, 0, 'G3b: the alternate silhouette still renders a meta row');
  assert.equal(alt.divider, 0, 'G3b: the meta row and the divider must be omitted TOGETHER');
  assert.ok(
    alt.control >= CI.BEEN_HERE.height,
    `G3b: the 54pt plate's control row is ${alt.control}pt, below the ${CI.BEEN_HERE.height}pt target`,
  );

  // The title's bottom edge follows the plate, so the two cannot disagree about
  // which silhouette is being drawn.
  assert.equal(CI.titleBottom('s1Single'), 132, 'G3b: the title no longer sits 132pt off the card bottom');
  assert.equal(CI.titleBottom('s1Single', CI.PLATE_H_NO_META), 90, 'G3b: the alternate title bottom is not 90pt');
});
