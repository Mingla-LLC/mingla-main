/**
 * #1609 Direction C, wave 1 — the TESTER'S ADVERSARIAL guard.
 *
 * Registered as ci-batch:issue-1609-card-identity in .github/ci-batch/MANIFEST.json.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS, AND HOW IT DIFFERS FROM THE HAPPY-PATH GUARDS
 *
 * `issue_1609_direction_c_plate.test.mjs` T-9 proves the PLATE has exactly two
 * heights and that each row set fits a 44pt target. `card_identity_single_source`
 * T-2/T-4 prove the plate's own material and boundary measure correctly. Every one
 * of those assertions is scoped to the plate ITSELF.
 *
 * Nothing anywhere asserts the property that actually makes "one alternate
 * silhouette" true: THE THINGS ANCHORED TO THE PLATE'S TOP EDGE HAVE TO MOVE WITH
 * IT. The card name sits `gap` above the plate. The two curated slivers sit on the
 * plate's top edge. Both are positioned from `S1.plateH` — the CONSTANT 96 — baked
 * into a module-load `StyleSheet.create` entry, while the plate itself switches to
 * `PLATE_H_NO_META` (64) at render time. When the meta row is vacuity-guarded away,
 * the plate shrinks by 32pt and the name and the slivers do not follow.
 *
 * (Those two numbers were 54 and 42 when this file was written, because §3.6 then
 * dropped the DIVIDER along with the facts row. Seth reversed that on 2026-08-05
 * (#1609 comment 5196932627) — the divider carries the chevron, and the chevron is
 * the card's only visible expand affordance, so the sparsest card in the pool was
 * rendering with nothing at all to say it opens. The short plate is now
 * `plateH - META_ROW_H + CHEVRON_CLEARANCE` = 64. Every behavioural assertion below
 * (A-2..A-5) was unaffected by that move, which is the point of evaluating the
 * shipped anchor expressions against BOTH silhouettes instead of against a number:
 * only A-0's and A-1's hard-coded scaffolding had to change, and it is now derived
 * rather than re-pinned so the next composition change cannot make it stale again.)
 *
 * That produces a THIRD and a FOURTH composition, which §3.6 forbids in terms
 * ("There is exactly ONE alternate silhouette in the whole system"), and it is the
 * exact drift class `platePresentation()` was exported to close — its own docblock
 * in deckCardPlate.tsx says so:
 *
 *     "Exported so BOTH card trees derive the title's position from the SAME
 *      predicate the plate uses to size itself — otherwise the title and the
 *      plate could disagree about which silhouette is being drawn."
 *
 * Neither card tree calls it. `CuratedExperienceSwipeCard.tsx` imports it and never
 * uses it; `SwipeableCards.tsx` does not import it at all.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE SAME BUG THAT ALREADY SHIPPED ONCE ON THIS BRANCH
 *
 * `CuratedSlivers` wrapped its absolutely-positioned children in an unstyled View,
 * the wrapper collapsed to 0x0, and `bottom: 112` resolved against the wrong
 * ancestor — the stack drew 112pt above the top of the card and curated rendered
 * identically to a place card. Every static guard passed; only a screenshot caught
 * it. This file is that lesson written down as an executable assertion: an anchor
 * is only correct RELATIVE TO THE THING IT IS ANCHORED TO, so the assertions below
 * evaluate the shipped anchor expressions against BOTH silhouettes rather than
 * checking that a constant is spelled the way someone expected.
 *
 * ---------------------------------------------------------------------------
 * ANGLE: cross-module invariant violation under the boundary case (the vacuous
 * meta-span set). Not a render check, not a value check, not a budget count.
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
  Object.entries(SRC).map(([k, p]) => [k, stripComments(readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8'))]),
);

const S1 = CI.SURFACES.s1Single;

/** The two silhouettes, straight from the package. */
const SILHOUETTES = [
  { name: 'full (meta present)', plateH: S1.plateH },
  { name: 'alternate (meta vacuity-guarded away)', plateH: CI.PLATE_H_NO_META },
];

/** Where the plate's TOP edge sits, measured up from the card's bottom edge. */
function plateTop(plateH) {
  return S1.bottomInset + plateH;
}

/**
 * Pull a single `key: <expression>,` out of a `StyleSheet.create` entry and
 * evaluate it with `S1` and the package constants in scope. Returns `null` when
 * the key is absent — which is the SHAPE A CORRECT FIX TAKES, because a
 * silhouette-dependent offset cannot live in a module-load stylesheet at all.
 */
function staticStyleValue(src, styleName, key) {
  const block = new RegExp(`\\b${styleName}:\\s*\\{([\\s\\S]*?)\\n\\s*\\},`).exec(src);
  if (!block) return { found: false, reason: `style block \`${styleName}\` not found` };
  const m = new RegExp(`(?:^|[\\s{,])${key}:\\s*([^,\\n]+)`).exec(block[1]);
  if (!m) return { found: false, reason: `\`${key}\` is not a static key of \`${styleName}\`` };
  const expr = m[1].trim();
  // eslint-disable-next-line no-new-func
  const value = Function('S1', 'PLATE_H_NO_META', 'SLIVER', `"use strict"; return (${expr});`)(
    S1, CI.PLATE_H_NO_META, CI.SLIVER,
  );
  return { found: true, expr, value };
}

test('A-0 VACUITY the three sources were really read, stripped, and are parseable', () => {
  for (const [name, src] of Object.entries(code)) {
    assert.ok(src.length > 2000, `A-0: ${name} read as ${src.length} chars — the file moved or is empty`);
    assert.equal(/\/\*\*/.test(src), false, `A-0: ${name} still contains block comments, so stripComments is inert`);
  }
  // The extractor must be able to find something it is expected to find, or every
  // assertion below would pass by silently returning `found:false`.
  const probe = staticStyleValue(code.plate, 'plate', 'borderRadius');
  assert.equal(probe.found, true, `A-0: the style extractor is broken — ${probe.reason}`);
  assert.equal(probe.value, S1.plateR, 'A-0: the style extractor evaluated a known key to the wrong value');
  // And the two silhouettes must genuinely differ, or the whole file is vacuous.
  assert.notEqual(S1.plateH, CI.PLATE_H_NO_META, 'A-0: the package no longer has two silhouettes');
  // The delta was pinned at the literal 42 while the short plate was 54pt. It went
  // stale the moment Seth's decision (#1609 comment 5196932627) kept the divider and
  // the chevron and moved the short plate to 64 — so it is now DERIVED.
  //
  // Deliberately NOT `S1.plateH - CI.PLATE_H_NO_META`. `plateTop(h)` is
  // `S1.bottomInset + h`, so that form reduces to `a - b === a - b` and can never
  // fail for any value of anything — a literal replaced by an unfalsifiable
  // tautology is the SAME defect one line lower, not a fix for it.
  //
  // The package builds the short plate as `plateH - META_ROW_H + CHEVRON_CLEARANCE`,
  // so the delta between the silhouettes is the facts row MINUS the chevron's
  // reserved clearance. Re-deriving it from those two independent exports keeps the
  // assertion falsifiable: a short plate typed in as a fourth number, a dropped
  // `CHEVRON_CLEARANCE` term, a resized facts row and a resized chevron all fire it.
  assert.equal(
    plateTop(S1.plateH) - plateTop(CI.PLATE_H_NO_META),
    CI.META_ROW_H - CI.CHEVRON_CLEARANCE,
    'A-0: the silhouette delta is no longer the facts row minus the chevron clearance. '
    + `Measured ${plateTop(S1.plateH) - plateTop(CI.PLATE_H_NO_META)}pt against a derived `
    + `${CI.META_ROW_H} - ${CI.CHEVRON_CLEARANCE} = ${CI.META_ROW_H - CI.CHEVRON_CLEARANCE}pt. `
    + 'PLATE_H_NO_META must stay `plateH - META_ROW_H + CHEVRON_CLEARANCE` — re-derive this file.',
  );
});

test('A-1 platePresentation returns a DIFFERENT title anchor per silhouette, so a constant cannot serve both', () => {
  // deckCardPlate.tsx is TSX and cannot be required here, so the anchor is
  // re-derived from the package with the same arithmetic platePresentation() uses:
  //     titleBottom = bottomInset + plateH + gap
  const full = S1.bottomInset + S1.plateH + S1.gap;
  const alt = S1.bottomInset + CI.PLATE_H_NO_META + S1.gap;
  // These were pinned at the literals 132 and 90. 90 was a SECOND COPY of a value the
  // package already derives, and it went stale the moment the short plate moved
  // 54 -> 64pt — exactly the duplicate-derived-value defect this whole branch exists
  // to remove, so neither is re-pinned.
  //
  // Note that re-pinning them as `plateTop(...) + S1.gap` would be no better: this
  // block's `full`/`alt` ARE that expression, so the assertion would restate itself
  // and never fail. What is worth asserting is that this file's hand-arithmetic still
  // agrees with the package function `platePresentation()` actually calls
  // (`deckCardPlate.tsx` -> `surfaceTitleBottom('s1Single', plateH)` -> CI.titleBottom).
  // That is a cross-implementation check, and it fires on the precise anchor-drift
  // class this file was written for: a `titleBottom()` that ignores its `plateH`
  // argument and falls back to the descriptor's constant 96 breaks the second
  // assertion immediately.
  assert.equal(full, CI.titleBottom('s1Single', S1.plateH),
    'A-1: the full silhouette no longer anchors the name where the package\'s titleBottom() puts it');
  assert.equal(alt, CI.titleBottom('s1Single', CI.PLATE_H_NO_META),
    'A-1: the alternate silhouette no longer anchors the name where the package\'s titleBottom() puts '
    + `it — this file derives ${alt}pt, CI.titleBottom() returns `
    + `${CI.titleBottom('s1Single', CI.PLATE_H_NO_META)}pt. If titleBottom() has stopped honouring its `
    + 'plateH argument, the name is anchored to the 96pt plate on a card that draws the short one.');
  assert.notEqual(full, alt,
    'A-1: the two silhouettes imply the same title anchor, which would make this whole file moot');
  assert.equal(full - alt, S1.plateH - CI.PLATE_H_NO_META,
    'A-1: the anchors no longer differ by exactly the plate-height delta');
});

test('A-2 the card NAME keeps its `gap` to the plate in BOTH silhouettes, in BOTH card trees', () => {
  // The name is the ONLY thing Direction C leaves on the photograph, and §4.1 fixes
  // it `gap` (20pt) above the plate's top edge. If its offset is a module-load
  // constant it can only be correct for whichever silhouette it was written for.
  for (const tree of ['swipeable', 'curated']) {
    const got = staticStyleValue(code[tree], 'cardTitle', 'bottom');
    if (!got.found) {
      // A correct fix REMOVES the static key and applies the offset per render.
      assert.match(
        code[tree],
        /platePresentation\s*\(/,
        `A-2: ${tree} has no static cardTitle.bottom but also never calls platePresentation() — `
        + 'the name is then positioned by something this guard cannot see. Anchor it to the '
        + 'presented plate height explicitly.',
      );
      continue;
    }
    // A static base value is fine PROVIDED the render site overrides it per
    // silhouette. What is never fine is a constant with no override.
    const overridesPerRender = /bottom:\s*platePresentation\([\s\S]{0,200}?\)\.titleBottom/.test(code[tree]);
    if (overridesPerRender) continue;

    for (const s of SILHOUETTES) {
      const measuredGap = got.value - plateTop(s.plateH);
      assert.equal(
        measuredGap, S1.gap,
        `A-2: in ${tree}, silhouette "${s.name}" leaves ${measuredGap}pt between the name and the `
        + `plate's top edge, not ${S1.gap}pt.\n`
        + `      cardTitle.bottom is the module-load constant \`${got.expr}\` = ${got.value}, but the `
        + `plate's top edge is at ${plateTop(s.plateH)} in this silhouette.\n`
        + '      §3.6 allows exactly ONE alternate silhouette; a name that does not follow the plate '
        + 'creates another one. Derive the offset from platePresentation(spans).titleBottom at render '
        + 'time instead of baking S1.plateH into StyleSheet.create.',
      );
    }
  }
});

test('A-3 platePresentation() is CALLED by every tree that draws the name, not merely imported', () => {
  // A dead import is the signature of an invariant that was designed and then not
  // wired. `platePresentation` exists for exactly one purpose and its own docblock
  // says both trees must use it.
  for (const tree of ['swipeable', 'curated']) {
    const imported = /\bplatePresentation\b/.test(code[tree]);
    const called = /\bplatePresentation\s*\(/.test(code[tree]);
    assert.equal(
      called, true,
      `A-3: ${tree} ${imported ? 'imports platePresentation but never calls it' : 'never references platePresentation'}. `
      + 'deckCardPlate.tsx exports it so BOTH card trees derive the name\'s position from the SAME '
      + 'predicate the plate uses to size itself; while it is unused the two disagree about which '
      + 'silhouette is being drawn.',
    );
  }
});

test('A-4 the curated slivers sit on the plate\'s top edge in BOTH silhouettes', () => {
  // The sliver stack is the ENTIRE curated identity. Its offsets are measured UP
  // from the plate's top edge, so its anchor is meaningless unless it tracks the
  // plate height actually being rendered.
  const got = staticStyleValue(code.plate, 'sliver', 'bottom');
  const anchorsToConstantPlateH = /bottom:\s*S1\.bottomInset\s*\+\s*S1\.plateH\s*\+/.test(code.plate);
  const sliversTakePlateHeight = /export function CuratedSlivers\(\s*\{[^}]/.test(code.plate)
    || /export function CuratedSlivers\(\s*[A-Za-z_$]/.test(code.plate);

  assert.equal(
    got.found, false,
    'A-4: the sliver offset is a static stylesheet key. It must be applied per render from the '
    + 'presented plate height.',
  );

  if (anchorsToConstantPlateH) {
    assert.equal(
      sliversTakePlateHeight, true,
      'A-4: CuratedSlivers() takes no arguments yet anchors its slivers to the CONSTANT S1.plateH '
      + `(${S1.plateH}). In the alternate silhouette the plate's top edge drops to `
      + `${plateTop(CI.PLATE_H_NO_META)}pt while the slivers stay at `
      + `${plateTop(S1.plateH) + CI.SLIVER.offsets[0]}pt and `
      + `${plateTop(S1.plateH) + CI.SLIVER.offsets[1]}pt — `
      + `${plateTop(S1.plateH) - plateTop(CI.PLATE_H_NO_META)}pt of empty scrim opens between the stack `
      + 'and the plate it is supposed to be stacked on, and the mark reads as two stray lines across '
      + 'the photograph. Pass the presented plate height in, exactly as the plate itself derives it.',
    );
  }

  // Whatever mechanism is used, the arithmetic must hold for both silhouettes.
  for (const s of SILHOUETTES) {
    for (let i = 0; i < CI.SLIVER.offsets.length; i += 1) {
      const expected = plateTop(s.plateH) + CI.SLIVER.offsets[i];
      assert.ok(
        expected > plateTop(s.plateH) - 1,
        `A-4: sliver ${i} would be drawn below the plate's top edge in silhouette "${s.name}"`,
      );
    }
  }
});

test('A-5 the share control is right-anchored even when the Been-here slot renders nothing', () => {
  // `BeenHereControl` returns null while the visited query is pending (every card
  // promotion) and whenever the user is signed out. The control row is
  // `justifyContent: 'space-between'` with the Been-here slot as its first child,
  // so with one laid-out child the share glyph is placed at FLEX-START — it renders
  // hard against the plate's left edge and then snaps right when the query lands.
  // §3.7 and §4.1 both specify the share disc as right-anchored, unconditionally.
  const rowIsSpaceBetween = /controlRow:\s*\{[\s\S]*?justifyContent:\s*'space-between'/.test(code.plate);
  if (!rowIsSpaceBetween) return; // a different layout mechanism is fine

  const shareSelfAnchors = /shareButtonPlate:\s*\{[\s\S]*?marginLeft:\s*'auto'/.test(code.plate);
  const slotAlwaysOccupies = /\{beenHere\s*\?\?\s*<View\s+style=/.test(code.plate);
  assert.ok(
    shareSelfAnchors || slotAlwaysOccupies,
    'A-5: the control row is space-between and the Been-here slot can render nothing, so the share '
    + 'glyph left-anchors whenever the visited query is pending or the user is signed out. Give the '
    + "share button `marginLeft: 'auto'`, or render a placeholder that actually occupies space "
    + '(`<View />` with no style contributes no width).',
  );
});
