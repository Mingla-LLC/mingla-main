/**
 * Issue #1701 — a Details control and travel time on the deck card.
 * Implementor happy-path suite.
 *
 * Seth, 2026-08-07: "I want a button beside been there which indicates view more
 * with an eye icon" and "Travel time is missing on the cards."
 *
 * Measures the TOKENS and the DATA rule. The adversarial sibling attacks the
 * wiring — a control can be perfectly specified and mounted on no card, or wired
 * to its own expand path instead of the deck's one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
const require = createRequire(import.meta.url);
const CI = require(resolve(ROOT, 'packages/card-identity/index.js'));
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

const lin = (c8) => { const c = c8 / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); };
const over = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a));
const rgba = (s) => {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(s);
  if (hex) return { rgb: [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)), a: 1 };
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(s);
  assert.ok(m, `unparsable colour ${s}`);
  return { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] };
};
const PLATE_SOLID = rgba(CI.PLATE.fallbackSolid).rgb;

test('D-0 the oracle reproduces a published value', () => {
  assert.ok(Math.abs(ratio([255, 255, 255], [0, 0, 0]) - 21) < 1e-9);
});

test('D-1 Details is Been-here\'s geometry, not a second shape', () => {
  // The two sit side by side. A 2pt disagreement reads as a mistake, so every
  // dimension is READ from BEEN_HERE rather than retyped.
  assert.equal(CI.DETAILS.gap, CI.BEEN_HERE.gap);
  assert.equal(CI.DETAILS.paddingH, CI.BEEN_HERE.paddingHorizontal);
  assert.equal(CI.DETAILS.labelSize, CI.BEEN_HERE.labelSize);
  assert.equal(CI.DETAILS.labelWeight, CI.BEEN_HERE.labelWeight);
  assert.equal(CI.DETAILS.glyphSize, CI.BEEN_HERE.glyphSize.rest);
  assert.equal(CI.DETAILS.border, CI.BEEN_HERE.states.rest.border);
});

test('D-2 both controls fit the control row, side by side, in every silhouette', () => {
  // Two 44pt pills plus their gap plus the share disc must fit the plate's
  // width, or the row wraps and the whole silhouette guarantee goes with it.
  const s1 = CI.SURFACES.s1Single;
  // A conservative lower bound on each pill: the target height (its min width).
  const needed = 2 * CI.BEEN_HERE.height + CI.DETAILS.gapFromBeenHere
    + CI.SHARE_GLYPH.target + 2 * s1.sideInset;
  assert.ok(
    needed <= s1.plateW,
    `D-2: Been-here + Details + share need at least ${needed}pt inside a ${s1.plateW}pt plate`,
  );
  for (const lines of CI.surfaceSilhouettes('s1Single')) {
    const rows = CI.plateRows(CI.plateHeightForMetaLines('s1Single', lines), lines, 's1Single');
    assert.ok(
      rows.control >= CI.BEEN_HERE.height,
      `D-2: silhouette ${lines}'s control row cannot contain the Details pill`,
    );
  }
});

test('D-3 the Details control clears every contrast floor on the plate', () => {
  const fill = rgba(CI.DETAILS.fill);
  const composedFill = over(fill.rgb, fill.a, PLATE_SOLID);
  const label = ratio(rgba(CI.DETAILS.color).rgb, composedFill);
  assert.ok(label >= 4.5, `D-3: the Details label measures ${label.toFixed(2)}:1, under the 4.5 AA floor`);

  // SC 1.4.11 — the control's BOUNDARY against its background is the border,
  // not the fill. The fill carries the accent; giving both jobs to one colour is
  // what forces an orange border to alpha 0.70 before it reaches 3:1.
  const border = rgba(CI.DETAILS.border);
  const composedBorder = over(border.rgb, border.a, PLATE_SOLID);
  const boundary = ratio(composedBorder, PLATE_SOLID);
  assert.ok(boundary >= 3.0, `D-3: the Details border measures ${boundary.toFixed(2)}:1 against the plate, under 3.0`);

  // The Android opaque equivalents must land on the same colours, because
  // Android's plate is a solid and a translucent fill would composite over a
  // different backdrop than the ratios above were solved against.
  for (const [translucent, opaque] of [
    [CI.DETAILS.fill, CI.DETAILS.androidFill],
    [CI.DETAILS.fillPressed, CI.DETAILS.androidFillPressed],
  ]) {
    const t = rgba(translucent);
    const expected = over(t.rgb, t.a, PLATE_SOLID);
    const got = rgba(opaque).rgb;
    for (let i = 0; i < 3; i += 1) {
      assert.ok(
        Math.abs(expected[i] - got[i]) <= 1.5,
        `D-3: ${opaque} is not the opaque composite of ${translucent} over the plate `
        + `(expected ~${expected.map(Math.round).join(',')})`,
      );
    }
  }
});

test('D-4 pressed is a real state change, not the same fill twice', () => {
  assert.notEqual(CI.DETAILS.fill, CI.DETAILS.fillPressed, 'D-4: the pressed fill is identical to rest');
  assert.notEqual(CI.DETAILS.androidFill, CI.DETAILS.androidFillPressed, 'D-4: the Android pressed fill is identical to rest');
});

/** Comments removed; string bodies kept. See D-5. */
function stripComments(src) {
  let out = ''; let i = 0;
  while (i < src.length) {
    const c = src[i]; const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += src[i]; i += 1;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') { out += src[i]; i += 1; } out += src[i]; i += 1; }
      out += src[i]; i += 1; continue;
    }
    out += c; i += 1;
  }
  return out;
}

test('D-5 travel time is read from the card, and never invented', () => {
  // STRIPPED. The comment beside this code quotes the deleted
  // `travelTime || "15 min"` verbatim, so a raw scan finds the defect inside the
  // sentence that records its deletion — a guard tripped by its own prose.
  const deck = stripComments(read('app-mobile/src/components/SwipeableCards.tsx'));
  const fn = /function metaSpansForCard\([\s\S]*?\n\}/.exec(deck);
  assert.ok(fn, 'D-5: metaSpansForCard is gone');
  assert.match(fn[0], /card\.travelTime/, 'D-5: the facts line does not read travelTime');

  // Constitution 9 — no default. #1669 found and deleted a `travelTime || "15 min"`
  // that was being PERSISTED into calendar rows. It must not return here.
  assert.equal(
    /travelTime\s*\|\|/.test(fn[0]), false,
    'D-5: travelTime has a fallback default again — the fabricated "15 min" #1669 deleted',
  );
  assert.equal(
    /travelTime[^;]*\?\?\s*['"]/.test(fn[0]), false,
    'D-5: travelTime falls back to a string literal',
  );
  // Present-only, like every other span.
  assert.match(
    fn[0], /typeof card\.travelTime === 'string' && card\.travelTime\.trim\(\)\.length > 0/,
    'D-5: the travel-time span is not vacuity-guarded, so an empty string renders an orphan separator',
  );
});

test('D-6 the Details label exists in every shipped locale', () => {
  // A missing key renders the raw key string on a card face.
  const dir = resolve(ROOT, 'app-mobile/src/i18n/locales');
  const locales = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.ok(locales.length >= 25, `D-6 (vacuity): only ${locales.length} locales found`);
  const missing = [];
  for (const loc of locales) {
    const p = join(dir, loc, 'cards.json');
    if (!existsSync(p)) continue;
    const json = JSON.parse(readFileSync(p, 'utf8'));
    const v = json['swipeable.details'];
    if (typeof v !== 'string' || v.trim() === '') missing.push(loc);
  }
  assert.deepEqual(missing, [], `D-6: swipeable.details is missing from ${missing.join(', ')}`);
});
