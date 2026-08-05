/**
 * #1609 Direction C, wave 1 — the HAPPY-PATH regression guard.
 *
 * Registered in .github/workflows/issue-1609-card-identity.yml.
 *
 * The sibling guard `packages/card-identity/__tests__/card_identity_single_source.test.mjs`
 * proves the VALUES are single-sourced and measure correctly. This file proves the
 * BEHAVIOURS Direction C wave 1 shipped are actually present in the two card trees,
 * and that the specific defects it closed cannot come back:
 *
 *   - the collapsed card is one plate, on BOTH card types, from one composition
 *   - the visited state is the green success pill, not the orange tint
 *   - the resting label is "Been here", with no question mark
 *   - "Details" is gone, replaced by the chevron that breaks the plate's divider
 *   - #1618: the press is CONSUMED rather than falling through and opening the card,
 *     something visual binds to `inFlight`, and the write is bounded at the operation
 *
 * Every source read strips comments first, so no assertion here can be satisfied by
 * prose — that is the #1607 defect class, and it is the reason this file exists at
 * all rather than a grep.
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
  constants: '../../deckHeroConstants.ts',
  visits: '../../../services/visitService.ts',
  copy: '../../../i18n/locales/en/cards.json',
};

function readSrc(key) {
  return readFileSync(fileURLToPath(new URL(SRC[key], import.meta.url)), 'utf8');
}

/**
 * Remove `//` and `/* *\/` comments while preserving string literals. A guard
 * whose assertion can be satisfied by a comment is not a guard (#1607).
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

const code = {
  swipeable: stripComments(readSrc('swipeable')),
  curated: stripComments(readSrc('curated')),
  plate: stripComments(readSrc('plate')),
  constants: stripComments(readSrc('constants')),
  visits: stripComments(readSrc('visits')),
};

test('VACUITY every source under test was actually read and stripped', () => {
  // Without this, a renamed or moved file would make every assertion below pass
  // by reading an empty string.
  for (const [name, src] of Object.entries(code)) {
    assert.ok(src.length > 400, `VACUITY: ${name} stripped to ${src.length} chars — it was not read`);
    assert.ok(
      readSrc(name).length > src.length,
      `VACUITY: stripComments removed nothing from ${name}, so it is not actually stripping`,
    );
  }
});

test('T-1 BOTH card trees mount the ONE plate — curated is not a second composition', () => {
  for (const name of ['swipeable', 'curated']) {
    assert.ok(
      /<DeckCardPlate\b/.test(code[name]),
      `T-1: ${name} does not mount DeckCardPlate. Direction C's whole claim is that every fact `
      + 'and every control lives on one piece of glass, on both card types.',
    );
  }
  // The curated card must render the sliver stack, and it must be the ONLY thing
  // that distinguishes it. If curated grew its own plate or its own geometry, the
  // "same rectangle plus two 4pt views" claim would be false.
  assert.ok(/<CuratedSlivers\b/.test(code.curated), 'T-1: the curated card no longer renders the sliver stack');
  assert.equal(
    /isCurated/.test(code.plate),
    false,
    'T-1: the plate branches on isCurated. Curated must NOT be a different composition — the '
    + '52%/62% branch is exactly how the place card and the curated card drifted apart.',
  );
});

test('T-2 the scrims are absolute points from the package, with no percentage anywhere', () => {
  for (const name of ['swipeable', 'curated']) {
    const blocks = [...code[name].matchAll(/\bheroScrim:\s*\{([\s\S]*?)\n\s*\},/g)];
    assert.equal(blocks.length, 1, `T-2: expected exactly one heroScrim block in ${name}, found ${blocks.length}`);
    const body = blocks[0][1];
    assert.equal(
      /height:\s*['"][\d.]+%['"]/.test(body),
      false,
      `T-2: ${name}'s heroScrim still declares a PERCENTAGE height. A percentage makes the entire `
      + 'contrast table valid only on the device it was computed on.',
    );
    assert.match(
      body,
      /height:\s*DECK_BOTTOM_SCRIM_HEIGHT_PT/,
      `T-2: ${name}'s heroScrim must take its height from DECK_BOTTOM_SCRIM_HEIGHT_PT`,
    );
    assert.equal(/\bflex\s*:/.test(body), false, `T-2: ${name}'s heroScrim carries a flex-axis key (#1593)`);
  }
  // And the constant must be PRODUCED by the package's function, not typed in.
  assert.match(
    code.constants,
    /DECK_BOTTOM_SCRIM_HEIGHT_PT[^=]*=\s*surfaceScrimHeight\(/,
    'T-2: DECK_BOTTOM_SCRIM_HEIGHT_PT is no longer produced by the package\'s scrimHeight()',
  );
  assert.equal(CI.surfaceScrimHeight('s1Single'), 316, 'T-2: S1\'s scrim is no longer 316pt');
  // Both card types must resolve to the SAME height — that is the deleted branch.
  assert.equal(
    CI.surfaceScrimHeight('s1Single'),
    CI.surfaceScrimHeight('s1Curated'),
    'T-2: the single and curated scrims disagree again',
  );
});

test('T-3 the visited state is the GREEN success pill, not the orange tint', () => {
  // Verified on this branch as a live violation: styles.beenHereActive used
  // glass.chrome.active.tint, which is rgba(235,120,37,0.28) — brand orange.
  assert.equal(
    /glass\.chrome\.active\.tint/.test(code.swipeable),
    false,
    'T-3: the Been-here control is tinted with glass.chrome.active.tint (brand orange) again. '
    + 'The settled state is the green success pill.',
  );
  assert.equal(
    /beenHereActive/.test(code.swipeable),
    false,
    'T-3: styles.beenHereActive is back — per-state fills come from beenHereStateStyle()',
  );
  assert.match(
    code.swipeable,
    /beenHereStateStyle\(/,
    'T-3: the control no longer reads its per-state fill from the package',
  );
  // The package's settled fill must be green, and it must differ from rest in
  // three independent channels (fill, glyph, copy) so colour is never alone.
  const settled = CI.BEEN_HERE.states.settled.fill;
  assert.match(settled, /^rgba\(34,197,94,/, `T-3: the settled fill is ${settled}, not the green success pill`);
  assert.notEqual(settled, CI.BEEN_HERE.states.rest.fill, 'T-3: rest and settled share a fill');
});

test('T-4 the resting label has no question mark, and "Details" is gone', () => {
  const copy = JSON.parse(readSrc('copy'));

  assert.equal(
    copy['swipeable.been_here_ask'],
    undefined,
    'T-4: the "Been here?" string is back. The question mark was explicitly ruled out.',
  );
  assert.equal(copy['swipeable.been_here'], 'Been here', 'T-4: the resting label is no longer "Been here"');
  for (const [key, expected] of [
    ['swipeable.been_here_thanks', 'Thank you'],
    ['swipeable.been_here_settled', "You've been here"],
    ['swipeable.been_here_failed', "Couldn't save"],
  ]) {
    assert.equal(copy[key], expected, `T-4: ${key} should be "${expected}", found "${copy[key]}"`);
  }
  for (const value of Object.values(copy)) {
    assert.equal(
      typeof value === 'string' && /been here\?/i.test(value),
      false,
      `T-4: a question-mark Been-here string is back: "${value}"`,
    );
  }

  assert.equal(
    copy['swipeable.details_hint'],
    undefined,
    'T-4: the "Details" i18n key is back. It is replaced by the chevron in the plate divider.',
  );
  for (const name of ['swipeable', 'curated']) {
    assert.equal(
      /details_hint|railHintText/.test(code[name]),
      false,
      `T-4: ${name} renders the "Details" text again`,
    );
  }

  // The chevron that replaces it must exist, be inside the divider, and own no
  // gesture — the affordance is part of the object's construction, not a sticker.
  assert.match(code.plate, /name="chevron-up"/, 'T-4: the plate no longer renders the chevron');
  assert.match(
    code.plate,
    /dividerRow[\s\S]{0,400}pointerEvents="none"/,
    'T-4: the divider row that carries the chevron is not pointerEvents="none" — it must own zero '
    + 'gesture owners',
  );
  assert.ok(CI.DIVIDER.gap > 0, 'T-4: the divider gap the chevron sits in is gone');
});

test('T-5 #1618 the press is CONSUMED, not passed through to the card', () => {
  const start = code.swipeable.indexOf('const BeenHereControl');
  assert.ok(start > 0, 'T-5: BeenHereControl is gone from SwipeableCards');
  const end = code.swipeable.indexOf('const CardHeroImage', start);
  assert.ok(end > start, 'T-5: could not delimit the BeenHereControl body');
  const body = code.swipeable.slice(start, end);

  // THE DEFECT: `disabled` on an RN Pressable means it does not claim the touch,
  // so a deliberate, accurate press fell THROUGH to the card's expand handler
  // while the write was in flight — the exact accident the control's placement
  // was engineered to prevent, triggered by correct use.
  assert.equal(
    /disabled=\{/.test(body),
    false,
    'T-5: the Been-here Pressable is `disabled` again. A disabled RN Pressable does not claim the '
    + 'touch, so the press falls through and OPENS THE EXPANDED CARD (#1618).',
  );
  // It must still refuse to act while in flight — consumed, but inert.
  assert.match(
    body,
    /if\s*\(\s*inFlight\s*\)\s*return\s*;/,
    'T-5: the press no longer no-ops while in flight, so a double tap can double-write',
  );
  // And it must never open the rating flow (the safety property the placement rests on).
  for (const f of ['requestTapExpand', 'handleCardExpand', 'setIsExpandedModalVisible']) {
    assert.equal(body.includes(f), false, `T-5: BeenHereControl references ${f} — it must only toggle the visit`);
  }
});

test('T-6 #1618 something VISUAL binds to inFlight, and the write is bounded', () => {
  const start = code.swipeable.indexOf('const BeenHereControl');
  const body = code.swipeable.slice(start, code.swipeable.indexOf('const CardHeroImage', start));

  // THE DEFECT: `inFlight` was computed and nothing rendered from it, so the
  // control looked EXACTLY as it had before the tap — for a measured 75 seconds.
  assert.match(body, /inFlight/, 'T-6: inFlight is gone entirely');
  assert.match(
    body,
    /showSpinner=\{[^}]*inFlight/,
    'T-6: nothing VISUAL binds to inFlight. The control must not look identical while it works.',
  );
  assert.match(
    code.plate,
    /showSpinner\s*\?\s*\(?\s*<ActivityIndicator/,
    'T-6: the spinner that renders the in-flight state is gone from BeenHereBody',
  );
  assert.ok(
    CI.BEEN_HERE.inFlightAfterMs > 0 && CI.BEEN_HERE.inFlightAfterMs <= 8000,
    `T-6: the in-flight threshold is ${CI.BEEN_HERE.inFlightAfterMs}ms — it must be a real, short bound`,
  );

  // THE OTHER HALF: the 20s cap in services/supabase.ts is PER-REQUEST and sits
  // BELOW the auth preamble (fetchWithAuth awaits getAccessToken(), which can run
  // a refresh-token retry ladder), so it never fired. The bound has to be at the
  // operation.
  assert.match(
    code.visits,
    /VISIT_WRITE_TIMEOUT_MS\s*=\s*\d+/,
    'T-6: visitService no longer declares an operation-level write timeout (#1618)',
  );
  assert.match(code.visits, /Promise\.race/, 'T-6: the operation bound no longer races a timer');
  assert.match(code.visits, /clearTimeout/, 'T-6: the bound leaks its timer');
  // Both WRITES must be bounded; the reads are deliberately left to React Query,
  // which already retries them and whose failure is invisible either way.
  assert.match(
    code.visits,
    /async function boundVisitWrite/,
    'T-6: the operation-level bound helper is gone from visitService',
  );
  const calls = [...code.visits.matchAll(/boundVisitWrite\(/g)].length;
  assert.equal(
    calls,
    2,
    `T-6: boundVisitWrite is called ${calls} times — expected exactly 2, one for recordVisit and `
    + 'one for removeVisit. A bounded record with an unbounded remove still hangs.',
  );
  // Each write function must be the one wrapping it, not just some caller.
  for (const fn of ['recordVisit', 'removeVisit']) {
    const at = code.visits.indexOf(`export async function ${fn}(`);
    assert.ok(at > 0, `T-6: ${fn} is gone from visitService`);
    const body = code.visits.slice(at, code.visits.indexOf('\n}', at));
    assert.match(body, /boundVisitWrite\(/, `T-6: ${fn} is not bounded at the operation (#1618)`);
  }
});

test('T-7 the swipe-path budget actually dropped', () => {
  // These are the numbers Direction C claims, and they are the reason the
  // deletions are load-bearing rather than cosmetic.
  for (const name of ['swipeable', 'curated']) {
    assert.equal(
      [...code[name].matchAll(/<GlassBadge\b/g)].length,
      0,
      `T-7: ${name} still mounts GlassBadge chips on the card face. Five chips are five BlurViews, `
      + 'five shadowed lifted objects and five staggered Animated.Views in the promotion diff — '
      + 'the exact shape that produced #1576.',
    );
    assert.equal(
      [...code[name].matchAll(/entryIndex/g)].length,
      0,
      `T-7: ${name} still staggers per-badge entry motion inside the promotion diff (#1576)`,
    );
  }
  // ── Blur layers per card face ──────────────────────────────────────────────
  //
  // THIS USED TO COUNT `<BlurView` OCCURRENCES IN THE PLATE MODULE'S TEXT AND
  // REPORT THE RESULT AS A MOUNT COUNT ("expected exactly 1"). It is 1 — the
  // string appears once — but `PlateMaterial()` is MOUNTED at three sites, so a
  // saved-and-scheduled card carries THREE blur layers, not one. An assertion
  // adjacent to its claim rather than on it is the #1607 defect class, and it
  // went into a guard written the same week #1607 was raised (#1609 tester P2-1).
  //
  // So count MOUNT SITES over the module graph instead: how many BlurViews one
  // PlateMaterial constructs, times how many PlateMaterials each component
  // mounts, summed over what is actually on a face in a given saved/scheduled
  // state. The numbers asserted below are the real per-face budget.
  //
  // Slicing a declaration's body: NOT `indexOf('\n}')`. Every one of these
  // components destructures its props, so the first column-0 `}` is the end of
  // the PARAMETER LIST (`}: DeckCardPlateProps): React.ReactElement {`) and the
  // slice would be the signature alone — every count below would then be 0 and
  // every assertion would pass vacuously. Slice from a declaration to the NEXT
  // top-level declaration instead, and prove the slice is real before trusting it.
  const topLevelStarts = (src) =>
    [...src.matchAll(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|class|type|interface|enum)\b/gm)]
      .map((m) => m.index);
  const componentBody = (src, name) => {
    const at = src.search(new RegExp(`^(?:export\\s+)?function ${name}\\b`, 'm'));
    assert.ok(at >= 0, `T-7: ${name} is gone from the plate module`);
    const next = topLevelStarts(src).find((i) => i > at);
    const body = src.slice(at, next ?? src.length);
    assert.ok(
      body.length > 40 && body.length < src.length,
      `T-7: ${name}'s extracted body is ${body.length} chars of a ${src.length}-char file — the `
      + 'slicer is broken, so every count below would be meaningless.',
    );
    return body;
  };
  const count = (hay, re) => [...hay.matchAll(re)].length;

  const plateMaterialBody = componentBody(code.plate, 'PlateMaterial');
  const blursPerMaterial = count(plateMaterialBody, /<BlurView\b/g);
  assert.equal(
    blursPerMaterial, 1,
    `T-7: PlateMaterial constructs ${blursPerMaterial} BlurViews — the per-face arithmetic below `
    + 'assumes one, so re-derive it before changing this.',
  );
  // The Android path must return BEFORE the BlurView is ever constructed
  // (ANDROID_GLASS_USES_OPAQUE_FALLBACK), so the Android face budget is 0.
  const androidGuardAt = plateMaterialBody.indexOf('ANDROID_GLASS_USES_OPAQUE_FALLBACK');
  assert.ok(
    androidGuardAt > 0 && androidGuardAt < plateMaterialBody.indexOf('<BlurView'),
    'T-7: PlateMaterial no longer short-circuits to the opaque solid before constructing a '
    + 'BlurView — Android would now mount blur layers it cannot render (ANDROID_GLASS_USES_OPAQUE_FALLBACK).',
  );

  // Where PlateMaterial is mounted, by component.
  const materialMounts = {
    DeckCardPlate: count(componentBody(code.plate, 'DeckCardPlate'), /<PlateMaterial\b/g),
    CardStateDiscs: count(componentBody(code.plate, 'CardStateDiscs'), /<PlateMaterial\b/g),
  };
  assert.equal(
    materialMounts.DeckCardPlate, 1,
    `T-7: the plate itself mounts ${materialMounts.DeckCardPlate} PlateMaterials, expected 1`,
  );
  assert.equal(
    materialMounts.CardStateDiscs, 2,
    `T-7: CardStateDiscs mounts ${materialMounts.CardStateDiscs} PlateMaterials, expected 2 — one `
    + 'for the saved disc and one for the scheduled disc, each gated on its own flag.',
  );
  // Nothing else in the module graph may mount either node, or the arithmetic
  // below stops being the whole count.
  assert.equal(
    count(code.plate, /<PlateMaterial\b/g), 3,
    'T-7: the plate module mounts PlateMaterial somewhere other than the plate and the two state '
    + 'discs — the per-face blur budget below no longer accounts for every layer.',
  );
  assert.equal(
    count(code.plate, /<BlurView\b/g), blursPerMaterial,
    'T-7: the plate module constructs a BlurView outside PlateMaterial',
  );
  assert.equal(
    count(code.swipeable, /<PlateMaterial\b/g) + count(code.curated, /<PlateMaterial\b/g), 0,
    'T-7: a card tree mounts PlateMaterial directly instead of going through the plate',
  );
  assert.equal(
    count(code.swipeable, /<BlurView\b/g) + count(code.curated, /<BlurView\b/g),
    1,
    'T-7: a card tree mounts a BlurView outside the plate (the curated BrandChip is the one '
    + 'permitted exception and it is not on the collapsed face budget)',
  );

  // The claim, stated as the thing it claims: blur layers on ONE card face, by
  // state. main shipped 5 on every face regardless of state.
  const blurLayersOnFace = (saved, scheduled) =>
    blursPerMaterial * (materialMounts.DeckCardPlate + (saved ? 1 : 0) + (scheduled ? 1 : 0));
  assert.equal(blurLayersOnFace(false, false), 1, 'T-7: a plain card face is not 1 blur layer');
  assert.equal(blurLayersOnFace(true, false), 2, 'T-7: a saved card face is not 2 blur layers');
  assert.equal(blurLayersOnFace(false, true), 2, 'T-7: a scheduled card face is not 2 blur layers');
  assert.equal(
    blurLayersOnFace(true, true), 3,
    'T-7: a saved AND scheduled card face is not 3 blur layers. If this number moved, change the '
    + "table in deckCardPlate.tsx's header too — the two must never disagree again.",
  );

  // Gesture owners on the face: the card's expand target, Been-here, and Share.
  // The curated onSeePlan CTA that called handleCardExpand DIRECTLY — bypassing
  // requestTapExpand and therefore the deck's gesture lease — must stay dead.
  assert.equal(
    /onSeePlan/.test(code.curated) || /onSeePlan/.test(code.swipeable),
    false,
    'T-7: the curated onSeePlan CTA is back. It bypassed requestTapExpand and the gesture lease '
    + 'entirely (I-PROPOSED-1579 corollary); every expand path must route through requestTapExpand.',
  );
});

test('T-8 the curated card no longer draws a second shell inside the deck bezel', () => {
  const block = /\bcard:\s*\{([\s\S]*?)\n\s*\},/.exec(code.curated);
  assert.ok(block, 'T-8: the curated styles.card block is gone');
  const body = block[1];
  assert.equal(
    /borderRadius/.test(body),
    false,
    'T-8: the curated card declares its own borderRadius again. It renders INSIDE SwipeableCards\' '
    + 'cardInner, which already clips at glass.card.bezelRadius (40) — a second, smaller radius '
    + 'draws a 20pt corner inside a 40pt one, i.e. two silhouettes for one object.',
  );
  assert.equal(
    /backgroundColor/.test(body),
    false,
    'T-8: the curated card paints an opaque slab behind a full-bleed hero again',
  );
});

test('T-9 the plate is a fixed rectangle with exactly one alternate silhouette', () => {
  // The silhouette guarantee: a 1-line meta and an absent meta occupy the same
  // box, and the ONE exception is a discrete constant rather than a measurement.
  const full = CI.plateRows(CI.SURFACES.s1Single.plateH, true);
  const alt = CI.plateRows(CI.PLATE_H_NO_META, false);
  assert.equal(alt.meta, 0, 'T-9: the alternate silhouette still renders a meta row');
  assert.equal(alt.divider, 0, 'T-9: the meta row and the divider must be omitted TOGETHER');
  assert.ok(full.control >= CI.BEEN_HERE.height, 'T-9: the control row cannot contain the 44pt target');
  assert.ok(alt.control >= CI.BEEN_HERE.height, 'T-9: the 54pt plate cannot contain the 44pt target');

  // The plate's own left/right/bottom edges never move between the two.
  assert.match(
    code.plate,
    /plateWithMeta:\s*\{\s*height:\s*S1\.plateH\s*\}/,
    'T-9: the full plate height is no longer the descriptor\'s plateH',
  );
  assert.match(
    code.plate,
    /plateNoMeta:\s*\{\s*height:\s*PLATE_H_NO_META\s*\}/,
    'T-9: the alternate silhouette height is no longer the package constant',
  );
  // Only the HEIGHT may differ; a second inset or radius would be a second object.
  const plateBlock = /\bplate:\s*\{([\s\S]*?)\n\s*\},/.exec(code.plate);
  assert.ok(plateBlock, 'T-9: the plate style block is gone');
  assert.match(plateBlock[1], /left:\s*S1\.sideInset/, 'T-9: the plate no longer reads its inset from the package');
  assert.match(plateBlock[1], /borderRadius:\s*S1\.plateR/, 'T-9: the plate no longer reads its radius from the package');
});

test('T-10 missing data is hidden, never faked (Constitution 9)', () => {
  // Separators must render BETWEEN PRESENT SPANS ONLY — never leading, never
  // trailing. A card with no rating begins at distance with no orphaned "·".
  assert.match(
    code.plate,
    /spans\.filter\(/,
    'T-10: CardMetaLine no longer filters absent spans, so an empty span can render a separator',
  );
  assert.match(
    code.plate,
    /i\s*>\s*0\s*\?/,
    'T-10: the separator is no longer gated on position, so it can render leading',
  );
  // And an entirely empty meta must collapse the plate rather than render blank.
  assert.match(
    code.plate,
    /if\s*\(present\.length\s*===\s*0\)\s*return null/,
    'T-10: an empty meta line renders an empty Text instead of collapsing the plate',
  );
});
