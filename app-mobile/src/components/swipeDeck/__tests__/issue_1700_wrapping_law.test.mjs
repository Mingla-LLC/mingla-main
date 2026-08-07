/**
 * Issue #1700 — the wrapping law. Implementor happy-path suite.
 *
 * Seth, 2026-08-07, after eyeballing the deck on a physical Samsung:
 *
 *   "I want everything to take one line but when something is cut off, or bleeds
 *    out of the box, it should go to the next line so everything is visible."
 *
 * The facts line was `numberOfLines={1}` + `ellipsizeMode="tail"`, which rendered
 * "★ 4.6 · 20.9 mi · Icebrea…" — the category the card was matched on, deleted,
 * with 20pt of unused vertical slack directly above it.
 *
 * This file measures the GEOMETRY the law produces. Its sibling
 * `issue_1700_wrapping_law.adversarial.test.mjs` attacks the RENDER WIRING, which
 * is a different failure mode: every number below can be perfect while the row
 * still clamps to one line on the device.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const CI = require(resolve(ROOT, 'packages/card-identity/index.js'));

const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

// ── sRGB / CIE, re-implemented rather than imported (this is an ORACLE) ──────
function toLinear(c8) {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
const luminance = ([r, g, b]) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
const lStar = (y) => (y <= 216 / 24389 ? y * (24389 / 27) : Math.cbrt(y) * 116 - 16);
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const composite = (fg, alpha, bg) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));
const WHITE = [255, 255, 255];

test('W-0 the oracle reproduces published reference values', () => {
  // Vacuity guard. If the maths below is wrong, every assertion is decoration.
  assert.ok(Math.abs(ratio(luminance(WHITE), luminance([0, 0, 0])) - 21) < 1e-9);
  assert.ok(Math.abs(lStar(luminance(WHITE)) - 100) < 1e-9);
});

test('W-1 the facts row may reach two lines, and the ceiling is exactly two', () => {
  assert.equal(CI.META_LINES_MAX, 2, 'W-1: the line ceiling moved; a third line pushes the title off the card');
  for (const key of ['s1Single', 's1Curated', 's6Phone', 's7Expanded']) {
    assert.equal(CI.SURFACES[key].metaLines, 2, `W-1: ${key} is a control surface and must allow the wrap`);
  }
  // The static surfaces are NOT given a taller plate: they render short fact
  // sets by design and are not interactive, and growing them would move a scrim
  // nobody has measured on a surface nobody has built.
  for (const key of ['s2Grid', 's3Chat', 's4Snippet', 's5Og']) {
    assert.equal(CI.SURFACES[key].metaLines, 1, `W-1: ${key} unexpectedly grew a second facts line`);
  }
});

test('W-2 the second line costs exactly one line box, and the line box is derived', () => {
  const s1 = CI.SURFACES.s1Single;
  const lh = CI.metaLineHeight('s1Single');
  assert.equal(
    lh, 19,
    `W-2: the meta line box is ${lh}pt, not the 19pt that shipped. deckCardPlate.tsx carried a `
    + 'hardcoded `lineHeight: 19`; moving it into the package must not have changed it.',
  );
  assert.equal(
    CI.plateHeightForMetaLines('s1Single', 2) - CI.plateHeightForMetaLines('s1Single', 1),
    lh,
    'W-2: the two-line plate is not exactly one line box taller than the one-line plate',
  );
  assert.equal(CI.plateHeightForMetaLines('s1Single', 1), s1.plateH, 'W-2: the one-line plate stopped being the descriptor\'s');
  assert.equal(CI.plateHeightForMetaLines('s1Single', 0), CI.PLATE_H_NO_META, 'W-2: the no-facts plate moved');
});

test('W-3 every silhouette\'s rows sum to its own height — the whole guarantee', () => {
  for (const key of Object.keys(CI.SURFACES)) {
    for (const lines of CI.surfaceSilhouettes(key)) {
      const h = CI.plateHeightForMetaLines(key, lines);
      const r = CI.plateRows(h, lines, key);
      const sum = 2 * CI.PLATE.borderWidth + r.meta + r.clearance + r.divider + r.control;
      assert.equal(
        sum, h,
        `W-3: ${key} @${lines} line(s) — the rows sum to ${sum}pt inside a ${h}pt plate. This one `
        + 'arithmetic assertion IS the silhouette.',
      );
      assert.equal(r.divider, CI.DIVIDER_H, `W-3: ${key} @${lines} dropped the divider`);
    }
  }
});

test('W-4 nothing below the divider moves as the facts line wraps', () => {
  // The pill and the share glyph must not jump when a card's facts happen to
  // need two lines. Only the plate's TOP edge may move.
  for (const key of ['s1Single', 's1Curated', 's6Phone', 's7Expanded']) {
    const controls = CI.surfaceSilhouettes(key)
      .map((n) => CI.plateRows(CI.plateHeightForMetaLines(key, n), n, key).control);
    assert.equal(
      new Set(controls).size, 1,
      `W-4: ${key}'s control row varies across silhouettes (${controls.join(', ')}pt)`,
    );
    assert.ok(
      controls[0] >= CI.BEEN_HERE.height,
      `W-4: ${key}'s control row cannot contain the ${CI.BEEN_HERE.height}pt Been-here target`,
    );
  }
});

test('W-5 the plate holds L* 23.50 at every silhouette — it compensates, it does not lighten', () => {
  for (const key of Object.keys(CI.SURFACES)) {
    const H = CI.surfaceScrimHeight(key);
    const seen = [];
    for (const lines of CI.surfaceSilhouettes(key)) {
      const plateH = CI.plateHeightForMetaLines(key, lines);
      const u = CI.plateUnderForHeight(key, plateH);
      seen.push(u);
      const a = CI.rampAlphaAtDepth(CI.plateTopDepthForLines(key, lines), H);
      const bg = 255 * (1 - a);
      const L = lStar(luminance(composite(
        CI.PLATE.liftRgb, CI.PLATE.liftAlpha,
        composite(CI.PLATE.underRgb, u, [bg, bg, bg]),
      )));
      assert.ok(
        Math.abs(L - CI.PLATE.targetLstar) < 0.05,
        `W-5: ${key} @${lines} line(s) renders at L* ${L.toFixed(3)}, not ${CI.PLATE.targetLstar}`,
      );
    }
    // And the alphas must actually DIFFER between silhouettes on a surface that
    // has more than one, or the "re-solve" is a no-op that happens to pass.
    if (seen.length > 1 && CI.SURFACES[key].metaLines > 1) {
      assert.ok(
        new Set(seen).size > 1,
        `W-5 (vacuity): ${key}'s under-alpha is identical at every plate height, so `
        + 'plateUnderForHeight is not actually re-solving anything',
      );
    }
  }
});

test('W-6 the taller plate did not push the title below the large-text floor', () => {
  // THE REGRESSION THIS ISSUE ALMOST SHIPPED. At the pre-#1700 scrim of 316pt
  // the two-line silhouette put the 30/700 title at 2.96:1 against a white
  // photograph — under the 3.0 floor. The scrim is now solved from the TALLEST
  // silhouette, so every one clears it.
  for (const key of Object.keys(CI.SURFACES)) {
    const s = CI.SURFACES[key];
    if (s.titleOnPlate) continue;
    const H = CI.surfaceScrimHeight(key);
    for (const lines of CI.surfaceSilhouettes(key)) {
      const a = CI.rampAlphaAtDepth(CI.titleTopDepthForLines(key, lines), H);
      const bg = 255 * (1 - a);
      const cr = ratio(luminance(WHITE), luminance([bg, bg, bg]));
      assert.ok(
        cr >= 3.0,
        `W-6: ${key} @${lines} line(s) — white ${s.titleSize}/${s.titleWeight} title measures `
        + `${cr.toFixed(2)}:1 against a pure-white photograph, under the 3.0 large-text floor`,
      );
    }
  }
});

test('W-7 the scrim is ONE number per surface, solved from its tallest silhouette', () => {
  // A scrim that varied per card would make the deck's dark band jump on every
  // swipe. It is fixed — computed from the worst case rather than the canonical.
  for (const key of Object.keys(CI.SURFACES)) {
    const s = CI.SURFACES[key];
    const tallest = CI.surfaceSilhouettes(key).at(-1);
    assert.equal(
      CI.surfaceScrimHeight(key),
      CI.scrimHeight(
        CI.plateTopDepthForLines(key, tallest),
        CI.titleTopDepthForLines(key, tallest),
        s.h,
      ),
      `W-7: ${key}'s scrim is not solved from its tallest silhouette`,
    );
  }
  // S1's grew, and that growth is the point.
  const s1 = CI.SURFACES.s1Single;
  assert.ok(
    CI.surfaceScrimHeight('s1Single')
      > CI.scrimHeight(CI.plateTopDepth('s1Single'), CI.titleTopDepth('s1Single'), s1.h),
    'W-7 (vacuity): S1\'s scrim is unchanged by the wrap, so it was never solved from the tall plate',
  );
});

test('W-8 the no-facts plate is per-surface, not S1\'s constant applied everywhere', () => {
  // Found by #1700's sweep: `PLATE_H_NO_META` is 64, and s3Chat's whole plate is
  // 56 — so "the plate with no facts" was 8pt TALLER than the plate it shortens,
  // landing its top edge at a scrim alpha of 0.3043, under the 0.42 floor.
  for (const key of Object.keys(CI.SURFACES)) {
    const s = CI.SURFACES[key];
    assert.ok(
      CI.plateHeightNoMeta(key) <= s.plateH,
      `W-8: ${key}'s no-facts plate (${CI.plateHeightNoMeta(key)}pt) is TALLER than its canonical `
      + `plate (${s.plateH}pt)`,
    );
    if (!s.controls) {
      assert.equal(
        CI.plateHeightNoMeta(key), s.plateH,
        `W-8: ${key} has no controls, so it has no chevron and no alternate silhouette to derive`,
      );
    }
  }
  assert.equal(CI.plateHeightNoMeta('s1Single'), CI.PLATE_H_NO_META, 'W-8: S1\'s alternate changed value');
});

test('W-9 plateRows still accepts the booleans every pre-#1700 caller passes', () => {
  // A compatibility shim that silently reinterprets `true` is a bug wearing a
  // shim's clothes. `true` means ONE line, `false` means none.
  assert.deepEqual(CI.plateRows(96, true), CI.plateRows(96, 1, 's1Single'));
  assert.deepEqual(CI.plateRows(CI.PLATE_H_NO_META, false), CI.plateRows(CI.PLATE_H_NO_META, 0, 's1Single'));
});
