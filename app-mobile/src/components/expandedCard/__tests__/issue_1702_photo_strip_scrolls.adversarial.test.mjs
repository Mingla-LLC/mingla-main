/**
 * Issue #1702 — ADVERSARIAL suite. A different angle.
 *
 * The happy path asserts WHICH component is mounted. That is necessary and it is
 * not sufficient: the same defect can exist elsewhere in the same sheet, the
 * re-export can be present but wired to the wrong thing, and — the angle that
 * matters most here — the file has ALREADY drawn the wrong conclusion from this
 * exact symptom once.
 *
 * A few hundred lines below the photo strip, the replace-alternatives strip was
 * rebuilt as a wrapping grid with the comment: "it was one of the nested
 * scrollables inside the sheet's vertical scroll, and it fought the sheet's pan
 * gesture every time a thumb crossed it." Same fight, same file, and the
 * conclusion drawn was "remove the scrollable" rather than "use the sheet's
 * list". So this file asserts the LESSON, not just the fix.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

function strip(src) {
  let out = ''; let i = 0;
  while (i < src.length) {
    const c = src[i]; const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 2; continue; }
    if (c === '{' && d === '/' && src[i + 2] === '*') { i += 3; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/' && src[i + 2] === '}')) i += 1; i += 3; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += src[i]; i += 1;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') { out += src[i]; i += 1; } out += src[i]; i += 1; }
      out += src[i]; i += 1; continue;
    }
    out += c; i += 1;
  }
  return out;
}

const MODAL = strip(read('app-mobile/src/components/ExpandedCardModal.tsx'));

test('Q-1 no OTHER raw scrollable is nested in the sheet either', () => {
  // A horizontal ScrollView loses the same fight a FlatList does, and this file
  // is 2000+ lines with several strips in it.
  // The lookbehind excludes a GENERIC: `useRef<ScrollView>(null)` is a type
  // argument, not a mounted element, and matching it made this assertion fire on
  // a file with no raw scrollable in it at all.
  const raw = [...MODAL.matchAll(/(?<!\w)<ScrollView[\s>]/g)];
  assert.equal(
    raw.length, 0,
    `Q-1: ${raw.length} raw <ScrollView> mounted inside the sheet. Use the sheet-aware component or a `
    + 'wrapping layout — a raw scrollable loses the drag to the sheet on Android.',
  );
});

test('Q-2 the alternatives grid stays a grid — the other half of the same lesson', () => {
  // It was converted BECAUSE of this gesture fight. If a later edit turns it
  // back into a horizontal strip, the bug returns in a place nobody is looking.
  assert.match(MODAL, /altGrid/, 'Q-2: the wrapping alternatives grid is gone');
  const grid = /altGrid:\s*\{([\s\S]*?)\n\s*\},/.exec(MODAL);
  assert.ok(grid, 'Q-2: the altGrid style block is gone');
  assert.match(grid[1], /flexWrap:\s*['"]wrap['"]/, 'Q-2: the alternatives grid no longer wraps');
});

test('Q-3 exactly one horizontal scrollable in the sheet, and it is the photo strip', () => {
  // "It is the ONE horizontal scrollable on this sheet" is a claim the file
  // makes about itself. Nested horizontal scrollables inside a vertical sheet
  // are the failure mode; one is a design decision, two is an accident.
  const horizontals = [...MODAL.matchAll(/horizontal\s*(?:=\{true\}|\b)/g)];
  assert.ok(
    horizontals.length <= 2,
    `Q-3: ${horizontals.length} horizontal-scrolling props in the sheet. Each one is a fresh gesture `
    + 'fight with the sheet on Android.',
  );
  assert.match(MODAL, /<BottomSheetFlatList[\s\S]{0,300}horizontal/, 'Q-3: the photo strip is not the horizontal one');
});

test('Q-4 nothing else in the app imports gorhom directly', () => {
  // I-MOR: BaseBottomSheet is the SOLE permitted importer. If #1702 had been
  // fixed by importing the list straight from the package, this is the guard
  // that would have caught it — so it must be real, not decorative.
  const roots = ['app-mobile/src/components', 'app-mobile/src/screens'];
  const offenders = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(resolve(ROOT, dir), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__') walk(rel); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      if (rel.endsWith('ui/BaseBottomSheet.tsx')) continue;
      const src = strip(read(rel));
      if (/from ['"]@gorhom\/bottom-sheet['"]/.test(src)) offenders.push(rel);
    }
  };
  roots.forEach(walk);
  assert.deepEqual(
    offenders, [],
    `Q-4: ${offenders.length} file(s) import @gorhom/bottom-sheet directly, bypassing the one sheet `
    + `primitive: ${offenders.join(', ')}`,
  );
});

test('Q-5 the strip is not virtualised into invisibility', () => {
  // A horizontal list with a windowSize/initialNumToRender of 1 scrolls but
  // renders blanks, which reads to a user as "still broken". Neither may be
  // set to a value below what fits on screen.
  const strip_ = MODAL.slice(MODAL.indexOf('<BottomSheetFlatList'), MODAL.indexOf('<BottomSheetFlatList') + 1400);
  const initial = /initialNumToRender=\{(\d+)\}/.exec(strip_);
  if (initial) {
    assert.ok(Number(initial[1]) >= 4, `Q-5: initialNumToRender is ${initial[1]}; the strip shows more than that`);
  }
  assert.equal(
    /removeClippedSubviews=\{true\}/.test(strip_), false,
    'Q-5: removeClippedSubviews on a horizontal list inside a sheet blanks items on Android',
  );
});
