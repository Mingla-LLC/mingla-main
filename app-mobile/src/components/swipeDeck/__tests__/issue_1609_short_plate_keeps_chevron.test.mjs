/**
 * #1609 — the short plate keeps the chevron. IMPLEMENTOR happy-path guard.
 *
 * Registered in .github/workflows/issue-1609-card-identity.yml.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DEFENDS
 *
 * Seth's decision on #1609 (comment 5196932627, 2026-08-05):
 *
 *     "Keep the chevron on the 54pt plate. A place with no rating, no price, no
 *      distance and no category gets the short silhouette. §3.6 omits the facts
 *      row AND the divider together — which takes the chevron with it and leaves
 *      that card with no visible expand affordance at all. The chevron stays."
 *
 * The chevron exists BECAUSE the word "Details" was rejected in favour of a view
 * affordance. Dropping it on the sparsest card in the pool inverts that decision
 * at precisely the moment the user has least to go on, and the tester confirmed
 * on device that such a card renders with nothing that says it opens (P3-1).
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS A SEPARATE FILE FROM THE ROW ARITHMETIC IN G3b
 *
 * G3b (packages/card-identity/__tests__/card_identity_single_source.test.mjs)
 * proves the PACKAGE derives the right rows. That is necessary and not
 * sufficient: the previous P1 on this branch was a package that derived the
 * right number and a card tree that never asked for it. So this file asserts the
 * RENDER SITE — that `deckCardPlate.tsx` mounts the divider row unconditionally,
 * outside the `withMeta` ternary that gates the facts row — and it asserts the
 * geometry that makes the chevron actually visible rather than clipped by the
 * plate's own `overflow:'hidden'`.
 *
 * Every scan strips comments first (#1607: a guard a comment can satisfy is not
 * a guard), and every scan is preceded by a vacuity assertion, so a moved file or
 * a mistyped needle fails loudly instead of passing silently.
 */

/**
 * MODIFIED under #1700 — [TEST-MOD-APPROVED #1700].
 *
 * C-5 matched `plateWithMeta:` / `plateNoMeta:` by name, which is a shape assertion. Replaced
 * with the property it protected: the control row is IDENTICAL across every silhouette, so
 * the pill and the share glyph cannot move as a card's facts line wraps.
 *
 * Recorded here, in the file, so the next reader finds the reason beside the
 * assertion rather than in a commit message they will not go looking for.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const CI = require_('../../../../../packages/card-identity/index.js');

const PLATE_SRC = '../../deckCardPlate.tsx';
const PKG_SRC = '../../../../../packages/card-identity/index.js';

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

/**
 * JSX comments are `{/* ... *\/}` — the braces survive `stripComments`, which
 * leaves a bare `{}` behind. Harmless for every needle below, but the leftover
 * would make a naive "count the ternaries" assertion wrong, so it is removed too.
 */
function stripJsxCommentBraces(src) {
  return src.replace(/\{\s*\}/g, '');
}

const read = (rel) => stripJsxCommentBraces(
  stripComments(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')),
);

const plate = read(PLATE_SRC);
const pkg = read(PKG_SRC);

const S1 = CI.SURFACES.s1Single;
const FULL = CI.plateRows(S1.plateH, true);
const SHORT = CI.plateRows(CI.PLATE_H_NO_META, false);

const count = (hay, re) => [...hay.matchAll(re)].length;

test('C-0 VACUITY both sources were read, stripped, and still contain what is scanned', () => {
  assert.ok(plate.length > 4000, `C-0: deckCardPlate.tsx read as ${plate.length} chars — it moved or is empty`);
  assert.ok(pkg.length > 4000, `C-0: card-identity/index.js read as ${pkg.length} chars — it moved or is empty`);
  for (const [name, src] of [['plate', plate], ['package', pkg]]) {
    assert.equal(/\/\*\*/.test(src), false, `C-0: ${name} still contains block comments; stripComments is inert`);
  }
  // Each assertion below is meaningless if its subject is absent.
  assert.equal(count(plate, /styles\.dividerRow\b/g), 1, 'C-0: the divider row is gone from the plate');
  assert.equal(count(plate, /name="chevron-up"/g), 1, 'C-0: the chevron is gone from the plate');
  assert.equal(count(plate, /styles\.metaRow\b/g), 1, 'C-0: the facts row is gone from the plate');
  assert.ok(count(pkg, /function plateRows\(/g) === 1, 'C-0: plateRows is gone from the package');
  // And the two silhouettes must genuinely differ, or the whole file is vacuous.
  assert.notEqual(S1.plateH, CI.PLATE_H_NO_META, 'C-0: the package no longer has two silhouettes');
});

test('C-1 the DIVIDER is not omitted with the facts row, in either silhouette', () => {
  assert.equal(
    FULL.divider, CI.DIVIDER_H,
    'C-1: the full plate lost its divider',
  );
  assert.equal(
    SHORT.divider, CI.DIVIDER_H,
    'C-1: the short plate omits the divider. That takes the chevron with it, and the chevron is the '
    + 'ONLY thing on a card with no rating, no price, no distance and no category that says it '
    + 'opens. Seth reversed this on #1609 (comment 5196932627); the divider is a constant row of '
    + 'this object and only the FACTS row is data-dependent.',
  );
  // And it must be structural, not a coincidence of the current heights: the
  // package must not branch the divider on `withMeta` at all.
  const body = /function plateRows\([\s\S]*?\n\}/.exec(pkg);
  assert.ok(body, 'C-1: plateRows\' body could not be extracted — the slicer is broken');
  assert.equal(
    /divider\s*=\s*withMeta\s*\?/.test(body[0]),
    false,
    'C-1: plateRows branches the divider on withMeta again. The divider is unconditional; the '
    + 'clearance above it is what varies.',
  );
});

test('C-2 the RENDER SITE mounts the divider outside the facts-row ternary', () => {
  // The previous P1 on this branch was a package that derived the right number
  // and a card tree that never asked for it, so deriving the row is not enough —
  // the chevron has to actually be mounted on the short plate.
  //
  // `{withMeta ? ( ... ) : null}` is the shape that gates the facts row. Anything
  // matching that shape and containing the divider row means the chevron is
  // conditional again.
  const gated = /\{withMeta\s*\?\s*\(([\s\S]*?)\)\s*:\s*null\}/g;
  const blocks = [...plate.matchAll(gated)].map((m) => m[1]);
  assert.ok(
    blocks.length > 0,
    'C-2: nothing in the plate is gated on withMeta any more — the facts row must still be',
  );
  for (const block of blocks) {
    assert.equal(
      /styles\.dividerRow\b/.test(block),
      false,
      'C-2: the divider row is inside a `withMeta ? ... : null` gate, so the chevron disappears on '
      + 'exactly the card that needs it most. Mount it unconditionally and let `rows.clearance` '
      + 'carry the difference between the silhouettes.',
    );
    assert.equal(
      /name="chevron-up"/.test(block),
      false,
      'C-2: the chevron itself is inside a `withMeta ? ... : null` gate',
    );
  }
  // The facts row, by contrast, MUST still be gated — otherwise there is no
  // alternate silhouette at all and this whole change is moot.
  assert.ok(
    blocks.some((b) => /styles\.metaRow\b/.test(b)),
    'C-2: the facts row is no longer gated on withMeta, so the plate has one silhouette, not two',
  );
});

test('C-3 the clearance that makes the chevron visible is READ from the row set, not typed', () => {
  assert.match(
    plate,
    /marginTop:\s*rows\.clearance/,
    'C-3: the divider row no longer applies the package\'s reserved clearance. Without it the '
    + 'divider lands on the plate\'s 1pt top highlight on the short plate and the chevron is sliced '
    + 'in half by the plate\'s own overflow:hidden.',
  );
  // And nobody may retype the number next to it.
  assert.equal(
    /marginTop:\s*\d/.test(plate),
    false,
    'C-3: a numeric marginTop appeared in the plate. Every plate-anchored value is derived from '
    + '@mingla/card-identity (I-PROPOSED-C-CARD-IDENTITY-SINGLE-SOURCE).',
  );
});

test('C-4 the chevron is drawn WHOLE on the short plate, not clipped by the plate', () => {
  // The plate is `overflow:'hidden'`, and the chevron's box is centred on the
  // divider LINE. Its top edge inside the plate's content box is therefore
  // `clearance + DIVIDER_H/2 - CHEVRON.size/2`. Negative means the icon is sliced.
  const chevronTop = SHORT.clearance + CI.DIVIDER_H / 2 - CI.CHEVRON.size / 2;
  assert.ok(
    chevronTop >= 0,
    `C-4: the chevron's top edge sits ${chevronTop}pt inside the short plate's content box, so `
    + `${-chevronTop}pt of it is clipped away by the plate. CHEVRON_CLEARANCE (${CI.CHEVRON_CLEARANCE}) `
    + `must be at least ${(CI.CHEVRON.size - CI.DIVIDER_H) / 2}.`,
  );
  const contentH = CI.PLATE_H_NO_META - 2 * CI.PLATE.borderWidth;
  assert.ok(
    SHORT.clearance + CI.DIVIDER_H / 2 + CI.CHEVRON.size / 2 <= contentH,
    'C-4: the chevron overruns the short plate\'s bottom edge',
  );
  // On the full plate the clearance is unnecessary — the facts row's own vertical
  // slack absorbs the overhang — and reserving it there would move the meta line.
  assert.equal(FULL.clearance, 0, 'C-4: the full plate reserves clearance it does not need');
});

test('C-5 nothing below the divider moves between the silhouettes', () => {
  // "The chevron sits in it exactly as it does on the 96pt plate" (Seth) is an
  // arithmetic claim: the control row is the same height in both, so the
  // Been-here pill and the share glyph sit in the same place relative to the
  // plate's bottom edge whichever silhouette is drawn.
  assert.equal(
    SHORT.control, FULL.control,
    `C-5: the control row is ${SHORT.control}pt on the short plate and ${FULL.control}pt on the full `
    + 'one, so the Been-here pill and the share glyph jump when a card has no facts.',
  );
  assert.ok(
    SHORT.control >= CI.BEEN_HERE.height,
    `C-5: the short plate's control row cannot contain the ${CI.BEEN_HERE.height}pt Been-here target`,
  );
  // #1700 — and it must hold across ALL THREE silhouettes, not just these two.
  // The wrapping law added a two-line plate; if its control row differed, the
  // pill would jump every time a card's facts happened to wrap.
  const everyControl = CI.surfaceSilhouettes('s1Single')
    .map((n) => CI.plateRows(CI.plateHeightForMetaLines('s1Single', n), n, 's1Single').control);
  assert.equal(
    new Set(everyControl).size, 1,
    `C-5: the control row differs across silhouettes (${everyControl.join(', ')}pt), so the pill and `
    + 'the share glyph move as a card\'s facts line wraps',
  );

  // The plate's own bottom/left/right edges are shared style keys, so only the
  // HEIGHT may differ between silhouettes — and the height now arrives inline
  // from the derived SILHOUETTES table rather than from two named entries.
  // (This asserted `plateWithMeta` / `plateNoMeta` by name until #1700, which
  // made it a shape assertion that a correct third silhouette turned red.)
  assert.equal(
    /plateWithMeta:|plateNoMeta:/.test(plate), false,
    'C-5: a named per-silhouette height style is back; heights must come from SILHOUETTES',
  );
  assert.match(
    plate, /const SILHOUETTES\s*=[\s\S]{0,400}?plateHeightForMetaLines\(/,
    'C-5: the silhouette heights are no longer produced by the package',
  );
});

test('C-6 the short plate height is DERIVED, and no card file carries it as a literal', () => {
  assert.equal(
    CI.PLATE_H_NO_META,
    S1.plateH - CI.META_ROW_H + CI.CHEVRON_CLEARANCE,
    'C-6: PLATE_H_NO_META is no longer the full plate with the facts row swapped for the chevron '
    + 'clearance. It is a derivation, not a number somebody picked.',
  );
  assert.equal(
    CI.CHEVRON_CLEARANCE,
    Math.ceil((CI.CHEVRON.size - CI.DIVIDER_H) / 2),
    'C-6: CHEVRON_CLEARANCE is no longer derived from the chevron it exists to clear',
  );
  // The package must not declare it as a bare number, or the derivation is
  // decorative and the next chevron-size change silently clips the icon again.
  assert.equal(
    /const\s+PLATE_H_NO_META\s*=\s*[\d.]+\s*;/.test(pkg),
    false,
    'C-6: PLATE_H_NO_META is a typed-in literal in the package again',
  );
  // And it may not be retyped in the card file (I-PROPOSED-C-CARD-IDENTITY-SINGLE-SOURCE).
  assert.equal(
    new RegExp(`\\b${CI.PLATE_H_NO_META}\\b`).test(plate.replace(/PLATE_H_NO_META/g, '')),
    false,
    `C-6: the number ${CI.PLATE_H_NO_META} appears in deckCardPlate.tsx. Read PLATE_H_NO_META from `
    + 'the package instead.',
  );
});
