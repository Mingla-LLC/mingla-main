/**
 * Issue #1700 — the wrapping law. ADVERSARIAL suite, a different angle.
 *
 * `issue_1700_wrapping_law.test.mjs` measures the geometry: three silhouettes,
 * rows that sum, contrast floors that hold. Every one of those numbers can be
 * perfect while the row on the device still renders `numberOfLines={1}` and cuts
 * the category off — the geometry describes a plate that nothing grows into.
 *
 * So this file attacks the WIRING, on comment-stripped source:
 *
 *   1. the row can actually wrap, and wraps by SPAN and not by word;
 *   2. the measurement cannot loop, and has exactly one writer per card;
 *   3. the plate height and the title anchor come from the SAME object — the
 *      anchor-drift failure #1609's tester already found once, which a taller
 *      plate reopens (name stranded above a plate that moved without it);
 *   4. the hooks that hold the measurement are not below a conditional return.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

/**
 * Strip COMMENTS ONLY — string bodies are preserved.
 *
 * The first cut of this helper blanked string literals too, which silently broke
 * every style assertion below: `flexDirection: 'row'` became `flexDirection: ""`
 * and four tests failed against a correct file. Strings must still be TRAVERSED
 * (a `//` inside `'https://...'` is not a comment), just not erased.
 */
function strip(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 2; continue; }
    if (c === '{' && d === '/' && src[i + 2] === '*') { // JSX comment
      i += 3; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/' && src[i + 2] === '}')) i += 1; i += 3; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += src[i]; i += 1;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') { out += src[i]; i += 1; }
        out += src[i]; i += 1;
      }
      out += src[i]; i += 1;
      continue;
    }
    out += c; i += 1;
  }
  return out;
}

/** A whole function body, by BALANCED braces. A lazy regex stops at the first `}`. */
function bodyOf(src, decl) {
  const at = src.indexOf(decl);
  if (at < 0) return null;
  const open = src.indexOf('{', src.indexOf(')', at));
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(at, i + 1); }
  }
  return null;
}

const PLATE_RAW = read('app-mobile/src/components/deckCardPlate.tsx');
const DECK_RAW = read('app-mobile/src/components/SwipeableCards.tsx');
const CURATED_RAW = read('app-mobile/src/components/CuratedExperienceSwipeCard.tsx');
const PLATE = strip(PLATE_RAW);
const DECK = strip(DECK_RAW);
const CURATED = strip(CURATED_RAW);

test('A-0 the stripper strips (guard the guard)', () => {
  assert.equal(strip('const a = 1; // numberOfLines={1}\n'), 'const a = 1; \n');
  assert.equal(strip('/* numberOfLines={1} */ const b = 2;'), ' const b = 2;');
  // Strings are PRESERVED — the style assertions below read them.
  assert.equal(strip('const c = "flexWrap";'), 'const c = "flexWrap";');
  assert.equal(strip("const u = 'https://x'; // gone"), "const u = 'https://x'; ");
  assert.ok(PLATE.length < PLATE_RAW.length, 'A-0: strip() removed nothing from deckCardPlate.tsx');
  // The old clamp is quoted in the new comments, so a raw search would find it.
  assert.ok(PLATE_RAW.includes('ellipsizeMode'), 'A-0: the deletion comment is gone, so this guard proves less than it claims');
});

test('A-1 the facts row is no longer clamped to one line', () => {
  // The literal defect. `CardMetaLine` had numberOfLines={1} + ellipsizeMode.
  const fn = [bodyOf(PLATE, 'export function CardMetaLine')];
  assert.ok(fn[0], 'A-1: CardMetaLine is gone');
  assert.equal(
    /numberOfLines=\{1\}/.test(fn[0]), false,
    'A-1: the facts row clamps to one line again — this is the exact state that shipped '
    + '"★ 4.6 · 20.9 mi · Icebrea…" to a physical device',
  );
  assert.equal(
    /ellipsizeMode/.test(fn[0]), false,
    'A-1: the facts row ellipsises again. Nothing on the card may be cut off.',
  );
});

test('A-2 it wraps by SPAN, not by word', () => {
  // A single <Text numberOfLines={2}> would satisfy A-1 and break "34 min drive"
  // across two lines mid-phrase. The row must be a flex container of atomic
  // children, and each child must refuse to shrink.
  const wrap = /metaWrap:\s*\{([\s\S]*?)\n\s*\},/.exec(PLATE);
  assert.ok(wrap, 'A-2: the metaWrap row style is gone');
  assert.match(wrap[1], /flexDirection:\s*'row'/, 'A-2: the facts row is not a row');
  assert.match(wrap[1], /flexWrap:\s*'wrap'/, 'A-2: the facts row cannot wrap');

  const chip = /metaChip:\s*\{([\s\S]*?)\n\s*\},/.exec(PLATE);
  assert.ok(chip, 'A-2: the per-fact chip style is gone — spans are wrapping individually again');
  assert.match(
    chip[1], /flexShrink:\s*0/,
    'A-2: a fact chip may shrink, so RN will wrap its Text internally at a word boundary '
    + '("34 min" / "drive") instead of moving the whole fact to the next line',
  );
});

test('A-3 a separator can never be stranded at the end of a line', () => {
  // Separators rendered as their own flex items wrap independently, leaving
  // "★ 4.6 · 20.9 mi ·" dangling. They must be INSIDE the chip they introduce.
  const fn = bodyOf(PLATE, 'export function CardMetaLine');
  const chipOpen = fn.indexOf('styles.metaChip');
  assert.ok(chipOpen > 0, 'A-3: the render no longer groups spans into chips');
  const sepAt = fn.indexOf('META.separator.text');
  assert.ok(sepAt > chipOpen, 'A-3: the separator is rendered outside the chip and can strand at a line end');
});

test('A-4 the measurement cannot loop, and is clamped', () => {
  const fn = bodyOf(PLATE, 'export function CardMetaLine');
  assert.match(fn, /onLayout=/, 'A-4: nothing measures the row, so the plate cannot know to grow');
  assert.match(
    fn, /lastReported/,
    'A-4: the measurement has no previous-value guard — onLayout -> setState -> layout is a loop',
  );
  assert.match(fn, /Math\.min\(\s*META_LINES_MAX/, 'A-4: the measured line count is not clamped to the ceiling');
  assert.match(fn, /if\s*\(measured === lastReported\.current\)\s*return;/, 'A-4: it emits on every layout, not only on change');
});

test('A-5 exactly ONE writer per card — the behind face reads, it never reports', () => {
  // The deck renders the same spans twice: the front card and the behind
  // preview. Two measurers writing the same key would fight on every promotion.
  const plates = [...DECK.matchAll(/<DeckCardPlate[\s\S]*?\/>/g)];
  assert.equal(plates.length, 2, `A-5: expected 2 DeckCardPlate mounts in the deck, found ${plates.length}`);
  const reporting = plates.filter((m) => /onMetaLinesChange=/.test(m[0]));
  assert.equal(
    reporting.length, 1,
    `A-5: ${reporting.length} of the deck's plates report their measurement. The behind face is `
    + 'pointerEvents="none" and renders the NEXT card\'s spans; it must read only.',
  );
  // Both must still be SIZED by a measurement, or the behind face keeps a stale
  // silhouette and the plate visibly jumps at the moment of promotion.
  for (const m of plates) {
    assert.match(m[0], /metaLines=\{/, 'A-5: a deck plate is not sized from the measured line count');
  }
});

test('A-6 the plate height and the title anchor come from ONE object', () => {
  // #1609's tester found exactly this: a module-load stylesheet cannot express a
  // per-render value, so the name stayed where a 96pt plate had been while the
  // plate moved. A third silhouette reopens it. Both anchors must read the same
  // `platePresentation` result — never two independent calls, never a literal.
  for (const [name, code] of [['SwipeableCards', DECK], ['CuratedExperienceSwipeCard', CURATED]]) {
    const calls = [...code.matchAll(/platePresentation\(/g)];
    assert.ok(calls.length > 0, `A-6: ${name} no longer resolves a presentation`);
    // Every title anchor reads a presentation object's titleBottom.
    const titleAnchors = [...code.matchAll(/bottom:\s*(\w+)\.titleBottom/g)].map((m) => m[1]);
    assert.ok(titleAnchors.length > 0, `A-6: ${name} has no title anchored to a presentation`);
    for (const holder of titleAnchors) {
      assert.match(
        code, new RegExp(`const ${holder}\\s*=\\s*platePresentation\\(`),
        `A-6: ${name} anchors its title off "${holder}", which is not a platePresentation result`,
      );
    }
  }
  // And the plate itself must be sized from the SAME line count it reports.
  assert.match(
    PLATE, /const \{ withMeta, metaLines: lines \} = platePresentation\(spans, metaLines\)/,
    'A-6: DeckCardPlate no longer resolves its silhouette through platePresentation, so the plate '
    + 'and the caller\'s title anchor can disagree about which silhouette is drawn',
  );
});

test('A-7 the measurement state is not stranded below a conditional return', () => {
  // Placement, not logic: the deck has `if (!currentRec) return null` partway
  // down, and hooks declared after it are SKIPPED on an empty deck, shifting the
  // index of every hook after them. React's rules of hooks, broken silently.
  const stateAt = DECK.indexOf('const [metaLinesByCard');
  assert.ok(stateAt > 0, 'A-7: the deck no longer holds a per-card measurement');
  const guardAt = DECK.indexOf('if (!currentRec) {');
  assert.ok(guardAt > 0, 'A-7 (vacuity): the empty-deck guard is gone, so this test proves nothing');
  assert.ok(
    stateAt < guardAt,
    'A-7: the measurement hooks are declared BELOW `if (!currentRec) return null`. On an empty deck '
    + 'they are skipped and every later hook shifts index.',
  );
});

test('A-8 no plate dimension is a literal, and only the plate module sizes the plate', () => {
  // SCOPED, DELIBERATELY. The first cut of this test scanned all three files for
  // `height: 64|96|115` and went red on SwipeableCards' `brandMark` — a 64x64
  // logo circle with nothing to do with the plate. An assertion that fires on
  // an unrelated coincidence is the #1607 defect class pointing the other way:
  // it does not prove what it claims, and the next person deletes it.
  //
  // The real property has two halves.

  // (a) The plate module itself never types a silhouette height.
  const plateStyles = /const styles = StyleSheet\.create\(\{[\s\S]*$/.exec(PLATE);
  assert.ok(plateStyles, 'A-8: deckCardPlate.tsx has no stylesheet');
  for (const n of [64, 96, 115]) {
    assert.equal(
      new RegExp(`height:\\s*${n}\\b`).test(plateStyles[0]), false,
      `A-8: deckCardPlate.tsx hardcodes ${n}pt as a height. Every silhouette height must be `
      + 'produced by @mingla/card-identity.',
    );
  }
  assert.match(
    PLATE, /plateHeightForMetaLines\(\s*'s1Single'/,
    'A-8: the plate heights are no longer produced by the package',
  );

  // (b) The two CARD files never size the plate at all — they pass a line count
  // and read the resolved height back. A card file that set a height would be a
  // second source for the one number the whole silhouette hangs off.
  for (const [name, code] of [['SwipeableCards.tsx', DECK], ['CuratedExperienceSwipeCard.tsx', CURATED]]) {
    const mounts = [...code.matchAll(/<DeckCardPlate[\s\S]*?\/>/g)];
    assert.ok(mounts.length > 0, `A-8 (vacuity): ${name} does not mount the plate, so this proves nothing`);
    for (const m of mounts) {
      assert.equal(
        /\bheight[=:]/.test(m[0]), false,
        `A-8: ${name} passes a height to DeckCardPlate. The plate resolves its own silhouette.`,
      );
    }
    assert.equal(
      /plateH\s*[:=]\s*\d/.test(code), false,
      `A-8: ${name} assigns a numeric plateH`,
    );
  }
});
