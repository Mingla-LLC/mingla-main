/**
 * #1609 Direction C wave 1, REWORK — the IMPLEMENTOR'S happy-path guard for the
 * plate-anchor fix (tester P1-1) and the share anchor (tester P1-2).
 *
 * Registered as ci-batch:issue-1609-card-identity in .github/ci-batch/MANIFEST.json.
 *
 * ---------------------------------------------------------------------------
 * HOW THIS DIFFERS FROM THE TESTER'S ADVERSARIAL GUARD
 *
 * `issue_1609_silhouette_anchor_drift.adversarial.test.mjs` asserts the ABSENCE
 * of the defect: that no module-load stylesheet key can serve both silhouettes,
 * and that `platePresentation` is called rather than merely imported. It is
 * written to go red on the broken branch, and it does.
 *
 * This file asserts the PRESENCE of the wiring, per render site. An anchor fix
 * is only as good as its least-wired call site: three components draw something
 * anchored to the plate's top edge (the front place face, the behind face, the
 * curated face), and every one of them has to be handed a value from the SAME
 * presentation object the plate sized itself with. A fix applied to two of three
 * sites satisfies "platePresentation is called" and still ships a stranded name
 * on the third. So the assertions below COUNT: every `<CuratedSlivers` mount
 * must pass `plateH`, every `styles.cardTitle` usage must be composed with a
 * per-render `bottom`, and the prop must be REQUIRED so a forgotten one is a
 * type error rather than an `undefined` that RN silently resolves to the top of
 * the card — which is exactly how the sliver stack shipped 112pt off-screen
 * earlier on this branch.
 *
 * The arithmetic half closes through the package's own exported `titleBottom()`
 * for BOTH silhouettes, so this guard cannot agree with a wrong number just
 * because the plate module and the guard were typed by the same hand.
 *
 * Comments are stripped before every source scan (#1607): no assertion here can
 * be satisfied, or tripped, by prose.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const CI = require_('../../../../../packages/card-identity/index.js');

const SRC = {
  swipeable: '../../SwipeableCards.tsx',
  curated: '../../CuratedExperienceSwipeCard.tsx',
  plate: '../../deckCardPlate.tsx',
};

/** Strip `//` and block comments, preserving string literals (#1607). */
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

const code = Object.fromEntries(
  Object.entries(SRC).map(([k, p]) => [
    k,
    stripComments(readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')),
  ]),
);

const S1 = CI.SURFACES.s1Single;
const SILHOUETTES = [
  { name: 'full (meta present)', plateH: S1.plateH },
  { name: 'alternate (meta vacuity-guarded away)', plateH: CI.PLATE_H_NO_META },
];

const count = (hay, re) => [...hay.matchAll(re)].length;

/** The trees that DRAW something anchored to the plate's top edge. */
const ANCHORING_TREES = ['swipeable', 'curated'];

test('H-0 VACUITY the three sources were read, stripped, and still contain what is scanned', () => {
  for (const [name, src] of Object.entries(code)) {
    assert.ok(src.length > 2000, `H-0: ${name} read as ${src.length} chars — the file moved or is empty`);
    assert.equal(/\/\*\*/.test(src), false, `H-0: ${name} still contains block comments; stripComments is inert`);
  }
  // Each scan below is meaningless if its subject is absent, so prove the
  // subjects exist before asserting anything about their shape.
  assert.ok(count(code.plate, /export function CuratedSlivers\(/g) === 1, 'H-0: CuratedSlivers is gone');
  assert.ok(count(code.plate, /export function platePresentation\(/g) === 1, 'H-0: platePresentation is gone');
  for (const tree of ANCHORING_TREES) {
    assert.ok(count(code[tree], /styles\.cardTitle\b/g) > 0, `H-0: ${tree} no longer draws the name`);
  }
  assert.notEqual(S1.plateH, CI.PLATE_H_NO_META, 'H-0: the package no longer has two silhouettes');
});

test('H-1 the title anchor closes the `gap` invariant through the PACKAGE, in both silhouettes', () => {
  for (const s of SILHOUETTES) {
    const plateTop = S1.bottomInset + s.plateH;
    const anchor = CI.titleBottom('s1Single', s.plateH);
    assert.equal(
      anchor - plateTop, S1.gap,
      `H-1: silhouette "${s.name}" puts the name ${anchor - plateTop}pt above the plate, not ${S1.gap}pt`,
    );
  }
  // And the plate module must READ that helper rather than re-typing the sum. A
  // second copy of `bottomInset + plateH + gap` is a second source of truth for
  // the one number the whole silhouette hangs off (G3b, applied to the anchor).
  // NOT `[\s\S]*?\n\}` — the function's own return-type annotation closes with a
  // column-0 `}` before the body even opens, so that slice would stop at the
  // signature and this assertion would pass on an empty string. Slice to the next
  // top-level `export` instead, and prove the slice is real.
  const at = code.plate.indexOf('export function platePresentation(');
  const presentation = code.plate.slice(at, code.plate.indexOf('\nexport ', at + 1));
  assert.ok(
    presentation.length > 200 && presentation.includes('withMeta'),
    `H-1: platePresentation's body extracted as ${presentation.length} chars — the slicer is broken`,
  );
  assert.match(
    presentation,
    /titleBottom:\s*surfaceTitleBottom\('s1Single',\s*plateH\)/,
    'H-1: platePresentation re-types the title arithmetic instead of calling the package\'s '
    + 'titleBottom(). Two copies of the same sum is how the plate and the name came to disagree.',
  );
});

test('H-2 EVERY CuratedSlivers mount site passes the rendered plate height', () => {
  let mounts = 0;
  let wired = 0;
  for (const tree of ANCHORING_TREES) {
    const here = count(code[tree], /<CuratedSlivers\b/g);
    mounts += here;
    wired += count(code[tree], /<CuratedSlivers\s+plateH=\{[^}]+\}/g);
  }
  assert.ok(mounts > 0, 'H-2: nothing mounts the curated sliver stack any more');
  assert.equal(
    wired, mounts,
    `H-2: ${mounts - wired} of ${mounts} CuratedSlivers mount sites do not pass plateH. The offsets `
    + 'are measured UP FROM THE PLATE\'S TOP EDGE, so a site that omits it draws the stack against '
    + 'a plate height that is not the one being rendered — 42pt of empty scrim in the alternate '
    + 'silhouette. Pass platePresentation(spans).plateH, the same value the plate sizes itself with.',
  );
});

test('H-3 plateH is a REQUIRED prop, so a forgotten one is a type error and not an undefined offset', () => {
  const sig = /export function CuratedSlivers\(([^)]*)\)/.exec(code.plate);
  assert.ok(sig, 'H-3: could not read the CuratedSlivers signature');
  assert.match(
    sig[1], /\{\s*plateH\s*\}\s*:\s*\{\s*plateH:\s*number\s*\}/,
    'H-3: CuratedSlivers no longer takes a required `plateH: number`.',
  );
  assert.equal(
    /plateH\?:/.test(sig[1]), false,
    'H-3: plateH is optional. An omitted one makes `bottom` NaN/undefined, and RN resolves an '
    + 'unresolved offset against the nearest positioned ancestor — the failure mode that already '
    + 'drew this stack 112pt off the top of the card once on this branch.',
  );
  // The anchor inside must use the PARAMETER, never the module constant.
  const bodyStart = code.plate.indexOf('export function CuratedSlivers(');
  const body = code.plate.slice(bodyStart, code.plate.indexOf('\nexport ', bodyStart + 1));
  assert.ok(body.length > 200, 'H-3: could not delimit the CuratedSlivers body');
  assert.match(body, /bottom:\s*S1\.bottomInset\s*\+\s*plateH\s*\+\s*offset/,
    'H-3: the sliver offset no longer resolves against the passed plate height');
  assert.equal(
    /S1\.plateH/.test(body), false,
    'H-3: CuratedSlivers reads the module constant S1.plateH again. That constant is only correct '
    + 'for the 96pt silhouette.',
  );
});

test('H-4 EVERY name render site composes a per-render bottom from a presentation object', () => {
  for (const tree of ANCHORING_TREES) {
    const usages = count(code[tree], /styles\.cardTitle\b/g);
    const composed = [...code[tree].matchAll(
      /style=\{\[\s*styles\.cardTitle\s*,\s*\{\s*bottom:\s*([A-Za-z_$][\w$]*)\.titleBottom\s*\}\s*\]\}/g,
    )];
    assert.equal(
      composed.length, usages,
      `H-4: ${tree} has ${usages} styles.cardTitle usages but ${composed.length} carry a per-render `
      + 'bottom. Every face that draws the name must anchor it to the plate height being rendered — '
      + 'a face that misses it strands the name over dead scrim in the alternate silhouette.',
    );
    // The object they read must be the plate's own predicate, not a local guess.
    for (const m of composed) {
      const ident = m[1];
      assert.match(
        code[tree], new RegExp(`const ${ident}\\s*=\\s*platePresentation\\(`),
        `H-4: ${tree} anchors the name to \`${ident}\`, which is not assigned from platePresentation().`,
      );
    }
  }
});

test('H-5 the share disc anchors itself, and the control row keeps no zero-width pretend placeholder', () => {
  const shareBlock = /shareButtonPlate:\s*\{([\s\S]*?)\n\s{2}\},/.exec(code.plate);
  assert.ok(shareBlock, 'H-5: the shareButtonPlate style block is gone');
  assert.match(
    shareBlock[1], /marginLeft:\s*'auto'/,
    'H-5: the share button no longer right-anchors itself. The control row is space-between and '
    + 'BeenHereControl returns null while the visited query is pending and whenever the user is '
    + 'signed out, so with one laid-out child the glyph lands at flex-start — hard against the '
    + "plate's LEFT edge, then snapping right when the query resolves (#1609 tester P1-2).",
  );
  assert.equal(
    /\{beenHere\s*\?\?\s*<View\s*\/>\}/.test(code.plate), false,
    'H-5: the `beenHere ?? <View />` pseudo-placeholder is back. It never fired — `beenHere` is '
    + 'always supplied and a supplied element is truthy; the thing that renders nothing is '
    + "BeenHereControl's own `return null` — and an unstyled <View /> reserves no width anyway. "
    + 'It reads as a reserved slot and is not one.',
  );
});

test('H-6 no module-load stylesheet on any face still bakes in a plate-relative offset', () => {
  // The positive-wiring mirror of the tester's A-2/A-4: it is not enough that the
  // render sites are wired, the OLD constants must be gone, or a later edit can
  // quietly re-select them.
  for (const tree of ANCHORING_TREES) {
    const block = /\bcardTitle:\s*\{([\s\S]*?)\n\s*\},/.exec(code[tree]);
    assert.ok(block, `H-6: ${tree}'s cardTitle style block is gone`);
    assert.equal(
      /(?:^|[\s{,])bottom:/.test(block[1]), false,
      `H-6: ${tree}'s cardTitle style carries a static \`bottom\` again. StyleSheet.create is `
      + 'evaluated once per module; this value is per render.',
    );
  }
  const sliver = /\bsliver:\s*\{([\s\S]*?)\n\s*\},/.exec(code.plate);
  assert.ok(sliver, 'H-6: the sliver style block is gone');
  assert.equal(
    /(?:^|[\s{,])bottom:/.test(sliver[1]), false,
    'H-6: the sliver style carries a static `bottom` again.',
  );
});
