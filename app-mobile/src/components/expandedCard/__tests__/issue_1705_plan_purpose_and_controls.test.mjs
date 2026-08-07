/**
 * Issue #1705 — a curated plan says what each stop is for, puts the supplies
 * before the route, and stops hiding Replace behind an expand.
 * Implementor happy-path suite.
 *
 * Seth, after using the plan on a device:
 *   "The supplies section should come just before the plan and indicate what
 *    it's for get supplies for a picnic."
 *   "Same with a plan that shows where to get flowers first. It should indicate
 *    get 'flowers here'."
 *   "Users should not have to expand the stops to see the replace button."
 *
 * The real plan this was built against, read out of production:
 * `Lowes Foods of Knightdale -> Knightdale Station Park`, category
 * `Picnic Dates`, stop 1 `comboCategory: 'groceries'`, stop 2 `'nature'`, with
 * the ten-item supplies list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

// `stopPurpose.ts` is TypeScript, so the pure logic is re-derived here from the
// SOURCE's own table rather than re-typed: the table is parsed out of the file,
// which keeps this honest if an entry is added or removed.
const SRC = read('app-mobile/src/components/expandedCard/stopPurpose.ts');

/** Everything from `marker` to the matching closing brace, by counting braces. */
function bodyAfter(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) return null;
  const open = at + marker.length - 1;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(open + 1, i); }
  }
  return null;
}

test('S-0b bodyAfter finds a whole body, not a signature (guard the guard)', () => {
  const sample = 'function f(x: {\n  a?: string;\n}): R | null {\n  return null;\n}\n';
  const body = bodyAfter(sample, '): R | null {');
  assert.match(body, /return null;/, 'S-0b: bodyAfter stopped before the body');
});

function parsePurposeTable() {
  const body = /const PURPOSES[^=]*=\s*\{([\s\S]*?)\n\};/.exec(SRC);
  assert.ok(body, 'the PURPOSES table is gone');
  const out = {};
  for (const m of body[1].matchAll(/^\s*([a-z_]+):\s*\{\s*key:\s*'([^']+)'[^}]*icon:\s*'([^']+)'/gm)) {
    out[m[1]] = { key: m[2], icon: m[3] };
  }
  return out;
}

test('S-0 the table parses, and is not empty (guard the guard)', () => {
  const table = parsePurposeTable();
  assert.ok(Object.keys(table).length >= 15, `S-0: parsed only ${Object.keys(table).length} purposes`);
});

test('S-1 the real picnic plan resolves the purposes Seth asked for', () => {
  const table = parsePurposeTable();
  // Stop 1 of the plan he reviewed on.
  assert.equal(table.groceries?.key, 'expanded.purpose_groceries', 'S-1: groceries has no purpose');
  // Stop 2.
  assert.equal(table.nature?.key, 'expanded.purpose_nature', 'S-1: nature has no purpose');
  // The one he named explicitly.
  assert.equal(table.florist?.key, 'expanded.purpose_flowers', 'S-1: a florist stop does not say "get flowers here"');
});

test('S-2 comboCategory wins over placeType, and neither is guessed at', () => {
  // The slot's role in THIS plan is a stronger statement than what the venue
  // happens to be, so it must be consulted first.
  // BODY ONLY. A lazy `/export function stopPurpose\([\s\S]*?\n\}/` stops at the
  // `}` that closes this function's INLINE PARAMETER TYPE — which sits at column
  // zero — so the match never reached the return statement and the null-fallback
  // assertion was testing a signature.
  const fn = bodyAfter(SRC, '): StopPurpose | null {');
  assert.ok(fn, 'S-2: stopPurpose is gone');
  const combo = fn.indexOf('comboCategory');
  const type = fn.indexOf('placeType');
  assert.ok(combo >= 0 && type > combo, 'S-2: placeType is consulted before comboCategory');
  // And the fallback chain must END in null, never in a default purpose.
  assert.match(fn, /\?\?\s*null;/, 'S-2: an unmatched stop falls back to something other than null');
});

test('S-3 the supplies line degrades rather than inventing an occasion', () => {
  const fn = bodyAfter(SRC, '): { key: string; defaultValue: string } | null {');
  assert.ok(fn, 'S-3: occasionFromCategory is gone');
  assert.match(fn, /return null;\s*$/, 'S-3: an unrecognised category gets a default occasion');
  assert.match(fn, /picnic/, 'S-3: the picnic occasion is gone — the plan Seth reviewed on has no line');
});

test('S-4 supplies renders BEFORE the plan', () => {
  const modal = read('app-mobile/src/components/ExpandedCardModal.tsx');
  const supplies = modal.indexOf('<SuppliesList');
  const plan = modal.indexOf('<StopList');
  assert.ok(supplies > 0, 'S-4: the supplies list is gone');
  assert.ok(plan > 0, 'S-4: the plan is gone');
  assert.ok(
    supplies < plan,
    'S-4: supplies still renders after the plan. You buy before you go, so the list is the first '
    + 'thing the plan asks of you.',
  );
  assert.match(modal, /purposeLine=\{suppliesPurposeLine\}/, 'S-4: the supplies list has no occasion line');
});

test('S-5 the stop controls are OUTSIDE the expanded block', () => {
  const list = read('app-mobile/src/components/expandedCard/StopList.tsx');
  const controls = list.indexOf('<View style={styles.controls}>');
  const expandedBlock = list.indexOf('{expanded ? (');
  assert.ok(controls > 0, 'S-5: the controls row is gone');
  assert.ok(expandedBlock > 0, 'S-5 (vacuity): there is no expanded block, so this proves nothing');
  assert.ok(
    controls < expandedBlock,
    'S-5: the controls still render inside {expanded ? ...}. Replace is the only way to change a '
    + 'plan you did not like and it was two taps behind a chevron.',
  );
});

test('S-6 the row can grow for the purpose line instead of clipping it', () => {
  const list = read('app-mobile/src/components/expandedCard/StopList.tsx');
  const row = /^  row: \{([\s\S]*?)\n  \},/m.exec(list);
  assert.ok(row, 'S-6: the row style is gone');
  assert.match(row[1], /minHeight: STOP_ROW\.height/, 'S-6: the row has a fixed height and will clip the purpose line');
  assert.equal(/^\s*height: STOP_ROW\.height,/m.test(row[1]), false, 'S-6: a fixed height came back');
});

test('S-7 every purpose and occasion string exists in every locale', () => {
  const keys = [
    ...new Set([...SRC.matchAll(/key: '(expanded\.(?:purpose|occasion)_[a-z_]+)'/g)].map((m) => m[1])),
    'expanded.occasion_picnic', 'expanded.occasion_stroll', 'expanded.occasion_beach',
    'expanded.occasion_camping', 'expanded.occasion_roadtrip',
    'expanded.supplies_for', 'expanded.supplies_for_at_stop',
  ];
  assert.ok(keys.length >= 12, `S-7 (vacuity): only ${keys.length} keys found in the source`);
  const dir = resolve(ROOT, 'app-mobile/src/i18n/locales');
  const locales = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const missing = [];
  for (const loc of locales) {
    const p = join(dir, loc, 'cards.json');
    if (!existsSync(p)) continue;
    const json = JSON.parse(readFileSync(p, 'utf8'));
    for (const k of keys) {
      if (typeof json[k] !== 'string' || json[k].trim() === '') missing.push(`${loc}/${k}`);
    }
  }
  assert.deepEqual(missing.slice(0, 8), [], `S-7: ${missing.length} missing strings, e.g. ${missing.slice(0, 8).join(', ')}`);
});

test('S-8 no hook is declared below the sheet\'s early returns', () => {
  // FOUND ON THE DEVICE, by Seth: tapping a card threw "Rendered more hooks than
  // during the previous render."
  //
  // `ExpandedCardModal` returns early twice — once for the business-event branch
  // and once for `!card`. I added two `useMemo`s BELOW both, so on any render
  // that took an early path the hooks were skipped and the count changed. It is
  // the same mistake I caught and fixed in SwipeableCards two commits earlier,
  // repeated in a second file, and neither value needed to be a hook at all.
  const src = read('app-mobile/src/components/ExpandedCardModal.tsx');
  const guard = src.indexOf('  if (!card) {');
  assert.ok(guard > 0, 'S-8 (vacuity): the !card early return is gone');
  const below = src.slice(guard);
  const hooks = [...below.matchAll(/\b(useMemo|useState|useEffect|useCallback|useRef)\s*\(/g)]
    .map((m) => m[1]);
  assert.deepEqual(
    hooks, [],
    `S-8: ${hooks.length} hook(s) declared below \`if (!card) return null\` (${[...new Set(hooks)].join(', ')}). `
    + 'Every render that takes an early return skips them, so React sees a different hook count and throws.',
  );
});

test('S-9 the busyness value is never the thing that shrinks', () => {
  // Seth, on a device: "Estiated should take another line. Also the text usually..
  // is not shown fully on android." He was reading "Usually stea…".
  //
  // The cause was NOT the deck plate's wrapping law — it was this row: `value`
  // carried flexShrink 1 and `estimated` carried flexShrink 0, so Android clipped
  // the FACT to preserve the CAVEAT.
  const src = read('app-mobile/src/components/expandedCard/ConditionsSection.tsx');
  const value = /^  value: \{([^}]*)\},/m.exec(src);
  assert.ok(value, 'S-9: the busyness value style is gone');
  assert.equal(
    /flexShrink:\s*1/.test(value[1]), false,
    'S-9: the busyness value can shrink again, so Android will clip "Usually steady" to make room '
    + 'for the disclosure beside it',
  );
  // And the value must not be clamped to one line either.
  const row = src.slice(src.indexOf('<Text style={styles.value}'), src.indexOf('<Text style={styles.value}') + 120);
  assert.equal(/numberOfLines=\{1\}/.test(row), false, 'S-9: the busyness value is clamped to one line');
  // The disclosure is a sibling of the value's ROW, not a sibling of the value.
  assert.match(src, /busyTop:/, 'S-9: the value and sparkline are no longer their own line');
  assert.match(
    src, /flexDirection: "column"/,
    'S-9: the busyness body is a row again, which is what made the value shrink',
  );
});
