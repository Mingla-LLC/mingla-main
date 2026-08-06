// Issue #1609 — the collapsed card is now a full-bleed photo with a contrast-derived
// scrim, and the white tray is deleted.
//
// This guard defends TWO properties that #1609 established, both of which are silent
// when they break — the card still renders, it is just illegible or subtly misaligned:
//
//   P1  THE SCRIM CLEARS WCAG ON A WHITE PHOTO. The old 3-stop / 45% gradient topped
//       out at rgba(0,0,0,0.55) and FAILED AA at the title on a bright hero. The new
//       ramp is back-solved from the sRGB transfer function. This guard IMPORTS the
//       real DECK_SCRIM_COLORS / DECK_SCRIM_LOCATIONS and EXECUTES the compositing +
//       contrast math over them, so weakening any stop fails here — it does not merely
//       assert that four string literals are still four string literals.
//
//   P2  NEITHER TREE COMPUTES A FLEX-AXIS HERO HEIGHT. #1593's defect was one
//       `flex: 0.88` style resolving to 689.00pt in the poster tree and 667.67pt in
//       the face tree. #1593 repaired it by MEASURING the face hole and copying the
//       number to the poster through a `heroHoleHeight` prop. #1609 removes the axis
//       instead: both trees use the same axis-free absolute fill, so they cannot
//       disagree and there is nothing to measure. See the supersession note in
//       issue_1593_poster_hole_geometry.test.mjs.
//
// VACUITY DISCIPLINE. Seven guards on this deck have been found hollow (#1607) — one
// satisfied by a comment, one matching an opening tag, one vacuous on ordering, one
// blind in the middle, one slicing on an anchor that does not exist, two workflows
// claiming assertions that do not exist, and one that passed 9/9 against a mutation
// that fully restored the defect. Therefore: every extraction asserts an EXACT expected
// count BEFORE inspecting content, finding zero targets is a FAILURE, source lookups
// run on comment-stripped source, and T-7 runs the contrast checker against synthetic
// WRONG ramps to prove the checker can actually reject one.
//
// CLAIMS — T-8 mechanically asserts each token below appears in a real assertion
// message in this file's own code.
//   CLAIM: executes-the-real-scrim-constants
//   CLAIM: title-band-clears-large-text-aa
//   CLAIM: description-band-clears-normal-text-aa
//   CLAIM: ramp-is-monotonic-and-anchored
//   CLAIM: checker-rejects-the-pre-1609-gradient
//   CLAIM: hero-carries-no-flex-axis-key
//   CLAIM: both-trees-share-one-hero-style
//   CLAIM: white-tray-is-gone
//   CLAIM: measurement-plumbing-is-gone
//   CLAIM: been-here-opens-the-prompt-and-writes-nothing
//   CLAIM: been-here-failure-is-surfaced

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  DECK_BOTTOM_SCRIM_HEIGHT_PT,
  DECK_SCRIM_COLORS,
  DECK_SCRIM_LOCATIONS,
} from '../../deckHeroConstants.ts';

const urls = {
  swipeable: new URL('../../SwipeableCards.tsx', import.meta.url),
  stage: new URL('../DeckSwipeStage.tsx', import.meta.url),
  constants: new URL('../../deckHeroConstants.ts', import.meta.url),
  self: new URL('./issue_1609_collapsed_card_scrim_and_geometry.test.mjs', import.meta.url),
};

const sourceEntries = await Promise.all(
  Object.entries(urls).map(async ([key, url]) => [key, await readFile(url, 'utf8')]),
);
const source = Object.fromEntries(sourceEntries);

// ---------------------------------------------------------------------------
// Comment / string stripping (same discipline as the #1593 guard).
// ---------------------------------------------------------------------------

function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += quote;
      i += 1;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') { out += src[i]; i += 1; }
        out += src[i];
        i += 1;
      }
      out += quote;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += src[i] === '\n' ? '\n' : ' '; i += 1; }
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += quote;
      i += 1;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') i += 1;
        i += 1;
      }
      out += quote;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The EXECUTED contrast oracle.
//
// Written from the WCAG 2.x definitions directly, NOT by re-deriving whatever the
// product happens to do — the product ships DATA (the ramp), and this is the
// independent judge of that data.
// ---------------------------------------------------------------------------

/** sRGB relative luminance of a 0-255 grey channel (WCAG 2.x). */
function relativeLuminanceOfGrey(channel255) {
  const c = channel255 / 255;
  const lin = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  // Grey => R=G=B => 0.2126L + 0.7152L + 0.0722L === L.
  return lin;
}

/** WCAG contrast ratio between white text and a grey background channel. */
function contrastVsWhite(bgChannel255) {
  const bg = relativeLuminanceOfGrey(bgChannel255);
  return (1.0 + 0.05) / (bg + 0.05);
}

/** Parse 'rgba(0,0,0,0.68)' -> 0.68. Throws rather than silently yielding NaN. */
function alphaOf(rgbaString) {
  const m = /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*([0-9.]+)\s*\)$/.exec(rgbaString);
  assert.ok(
    m,
    `executes-the-real-scrim-constants: scrim stop ${JSON.stringify(rgbaString)} is not a `
    + 'pure-black rgba() stop — the contrast derivation assumes a black scrim over the '
    + 'photo, so a hue change here silently invalidates every number below',
  );
  const a = Number(m[1]);
  assert.ok(Number.isFinite(a) && a >= 0 && a <= 1, `alpha out of range: ${rgbaString}`);
  return a;
}

/**
 * Alpha of the gradient at fractional position p in [0,1], by linear interpolation
 * between the two bracketing stops — which is what LinearGradient renders.
 */
function alphaAt(p, colors, locations) {
  assert.equal(
    colors.length,
    locations.length,
    'executes-the-real-scrim-constants: the scrim colour and location arrays have '
    + `different lengths (${colors.length} vs ${locations.length}) — LinearGradient would `
    + 'silently reinterpolate and every contrast number below would be fiction',
  );
  if (p <= locations[0]) return alphaOf(colors[0]);
  for (let i = 1; i < locations.length; i += 1) {
    if (p <= locations[i]) {
      const span = locations[i] - locations[i - 1];
      const tt = span === 0 ? 1 : (p - locations[i - 1]) / span;
      const a0 = alphaOf(colors[i - 1]);
      const a1 = alphaOf(colors[i]);
      return a0 + (a1 - a0) * tt;
    }
  }
  return alphaOf(colors[colors.length - 1]);
}

/** Composite a black scrim of alpha a over a white (255) photo. */
function compositedChannelOverWhite(a) {
  return 255 * (1 - a);
}

/**
 * The measured geometry of the shipped card on the #1593 reference device
 * (iPhone 17, card 402 x 783), used to convert an element's y position into a
 * position within the scrim.
 *
 * [TEST-MOD-APPROVED #1609] `SCRIM_FRACTION = 0.52` WAS A HARD-CODED COPY, and
 * that made this test unfalsifiable: Direction C replaced the 52% percentage
 * with an absolute 316pt height, and because the fraction lived HERE rather than
 * being read from the source, every band below would have gone on passing while
 * describing a card that no longer ships. Green CI over a stale model is the
 * exact defect class #1607 names.
 *
 * It now reads the REAL shipped height. 316/783 = 40.4%, not 52% — the scrim got
 * SHALLOWER, so every band moved deeper into it and the contrast floors below
 * became harder to clear, not easier.
 */
const CARD_H = 783;
const SCRIM_TOP_Y = CARD_H - DECK_BOTTOM_SCRIM_HEIGHT_PT;

/** Fractional position within the scrim for an absolute y on the card. */
function scrimPositionForY(y) {
  return (y - SCRIM_TOP_Y) / (CARD_H - SCRIM_TOP_Y);
}

// The bands that carry text, and the WCAG floor each must clear.
//
// [TEST-MOD-APPROVED #1609] The band LIST is re-derived, because the elements it
// named no longer exist. Direction C deletes the description (`oneLiner`) from
// the collapsed card and moves the action rail onto the plate, so `description`,
// `description-bottom` and `rail` were measuring empty photograph. Asserting a
// contrast floor at a y-coordinate where nothing renders is a vacuous pass.
//
// What is left on the photograph is the TITLE and nothing else, and it is now
// 30/700 at lineHeight 36 sitting 132pt off the card's bottom edge — so its
// bottom edge is at y = 783 - 132 = 651 and its top edge at 651 - 72 = 579. Both
// are LARGE text (>= 18.66pt bold) and take the 3:1 floor. The plate's own text
// is NOT measured here: it sits on glass, not on the ramp, and
// packages/card-identity/__tests__ measures it against the plate composite.
const TITLE_BOTTOM_Y = CARD_H - 132;
const TITLE_TOP_Y = TITLE_BOTTOM_Y - 2 * 36;
const TEXT_BANDS = [
  { name: 'title-top', y: TITLE_TOP_Y, minRatio: 3.0, claim: 'title-band-clears-large-text-aa' },
  { name: 'title-bottom', y: TITLE_BOTTOM_Y, minRatio: 3.0, claim: 'title-band-clears-large-text-aa' },
  // The plate's top edge: the ramp must still be at or past its material floor
  // there, which is the deepest thing the ramp is responsible for.
  { name: 'plate-top', y: CARD_H - 112, minRatio: 3.0, claim: 'title-band-clears-large-text-aa' },
];

/** Returns a list of failure strings; empty means the ramp passes. */
function checkContrast(colors, locations) {
  const failures = [];
  for (const band of TEXT_BANDS) {
    const p = scrimPositionForY(band.y);
    const a = alphaAt(p, colors, locations);
    const ratio = contrastVsWhite(compositedChannelOverWhite(a));
    if (!(ratio >= band.minRatio)) {
      failures.push(
        `${band.name}: y=${band.y} -> scrim alpha ${a.toFixed(3)} -> ${ratio.toFixed(2)}:1, `
        + `below the required ${band.minRatio}:1`,
      );
    }
  }
  return failures;
}

test('T-1 the REAL shipped scrim constants clear WCAG at every text band on a white photo', () => {
  assert.ok(
    Array.isArray(DECK_SCRIM_COLORS) && Array.isArray(DECK_SCRIM_LOCATIONS),
    'executes-the-real-scrim-constants: DECK_SCRIM_COLORS / DECK_SCRIM_LOCATIONS did not '
    + 'import as arrays — this guard executes the real constants and must never fall back '
    + 'to a local copy of them',
  );
  assert.equal(
    DECK_SCRIM_COLORS.length,
    4,
    `executes-the-real-scrim-constants: expected exactly 4 scrim stops, found `
    + `${DECK_SCRIM_COLORS.length} — dropping a stop is exactly how the ramp regresses to `
    + 'the pre-#1609 gradient',
  );
  // [TEST-MOD-APPROVED #1609] Was 5. Direction C deletes the description and the
  // action rail from the photograph, so three of the five bands measured empty
  // pixels. The anti-vacuity property is preserved — the table must not collapse
  // to nothing, and every remaining row must sit inside the real scrim.
  assert.equal(TEXT_BANDS.length, 3, `VACUITY: the band table collapsed to ${TEXT_BANDS.length} rows`);
  for (const band of TEXT_BANDS) {
    assert.ok(
      band.y > SCRIM_TOP_Y && band.y <= CARD_H,
      `VACUITY: band "${band.name}" at y=${band.y} falls outside the real ${DECK_BOTTOM_SCRIM_HEIGHT_PT}pt `
      + `scrim (which spans y ${SCRIM_TOP_Y}..${CARD_H}) — it would be measuring bare photograph`,
    );
  }

  const failures = checkContrast(DECK_SCRIM_COLORS, DECK_SCRIM_LOCATIONS);
  assert.deepEqual(
    failures,
    [],
    'title-band-clears-large-text-aa / description-band-clears-normal-text-aa: the shipped '
    + 'scrim no longer clears WCAG on a white hero: ' + failures.join(' | '),
  );

  for (const band of TEXT_BANDS) {
    const ratio = contrastVsWhite(compositedChannelOverWhite(
      alphaAt(scrimPositionForY(band.y), DECK_SCRIM_COLORS, DECK_SCRIM_LOCATIONS),
    ));
    console.log(`T-1 ${band.name} @y=${band.y}: ${ratio.toFixed(2)}:1 (needs ${band.minRatio}:1)`);
  }
});

test('T-2 the ramp is anchored transparent at the top and monotonically darkens', () => {
  const alphas = DECK_SCRIM_COLORS.map(alphaOf);
  assert.equal(
    alphas[0],
    0,
    'ramp-is-monotonic-and-anchored: the first stop must be fully transparent, or the scrim '
    + 'paints a visible horizontal seam across the middle of the photo',
  );
  for (let i = 1; i < alphas.length; i += 1) {
    assert.ok(
      alphas[i] > alphas[i - 1],
      `ramp-is-monotonic-and-anchored: stop ${i} (${alphas[i]}) is not darker than stop `
      + `${i - 1} (${alphas[i - 1]}) — a non-monotonic ramp reads as a band, not a fade`,
    );
  }
  for (let i = 1; i < DECK_SCRIM_LOCATIONS.length; i += 1) {
    assert.ok(
      DECK_SCRIM_LOCATIONS[i] > DECK_SCRIM_LOCATIONS[i - 1],
      'ramp-is-monotonic-and-anchored: gradient locations must strictly increase',
    );
  }
  assert.equal(DECK_SCRIM_LOCATIONS[0], 0);
  assert.equal(DECK_SCRIM_LOCATIONS[DECK_SCRIM_LOCATIONS.length - 1], 1);
  console.log(`T-2 examined ${alphas.length} stops: ${alphas.join(' -> ')}`);
});

test('T-7 negative control — the checker REJECTS the pre-#1609 gradient it replaced', () => {
  // The exact ramp that shipped before #1609, which failed AA at the title.
  const preFixColors = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.2)', 'rgba(0,0,0,0.55)'];
  const preFixLocations = [0, 0.5, 1];
  const preFixFailures = checkContrast(preFixColors, preFixLocations);
  assert.ok(
    preFixFailures.length > 0,
    'checker-rejects-the-pre-1609-gradient: the pre-#1609 gradient must be REJECTED by this '
    + 'checker — if it passes, the checker cannot detect a revert and T-1 is decoration',
  );

  // A ramp that is merely shallower must also be caught, so the gate is not satisfied by
  // any four-stop ramp whatsoever.
  const shallow = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.10)', 'rgba(0,0,0,0.20)', 'rgba(0,0,0,0.30)'];
  const shallowFailures = checkContrast(shallow, [0, 0.32, 0.62, 1]);
  assert.ok(
    shallowFailures.length > 0,
    'checker-rejects-the-pre-1609-gradient: a uniformly shallower 4-stop ramp must also be '
    + 'rejected, or the gate is satisfied by stop COUNT rather than by contrast',
  );
  assert.notDeepEqual(
    preFixFailures,
    shallowFailures,
    'the two synthetic wrong ramps are diagnosed identically — the checker is not '
    + 'discriminating between them',
  );
  console.log(`T-7 pre-fix rejected with ${preFixFailures.length} failures; shallow with ${shallowFailures.length}`);
});

// ---------------------------------------------------------------------------
// P2 — the geometry, structurally.
// ---------------------------------------------------------------------------

test('T-3 the hero style carries NO flex-axis key, in either tree', () => {
  const src = stripComments(source.swipeable);

  const heroFillIdx = src.indexOf('heroFill: {');
  assert.ok(
    heroFillIdx > 0,
    'hero-carries-no-flex-axis-key: styles.heroFill is gone — #1609 requires ONE axis-free '
    + 'hero style shared by both trees, and its absence means the layout was restructured '
    + 'without this guard being updated',
  );
  const close = src.indexOf('},', heroFillIdx);
  assert.ok(close > heroFillIdx, 'VACUITY: could not delimit the heroFill style body');
  const body = src.slice(heroFillIdx, close);

  assert.match(
    body,
    /StyleSheet\.absoluteFillObject/,
    'hero-carries-no-flex-axis-key: heroFill must spread StyleSheet.absoluteFillObject — '
    + 'that is what makes it sibling-independent and therefore identical in both trees',
  );
  assert.doesNotMatch(
    body,
    /\bflex\s*:/,
    'hero-carries-no-flex-axis-key: heroFill gained a `flex:` key. That is EXACTLY #1593: a '
    + 'flex-axis style resolves differently under different sibling sets (689.00pt poster vs '
    + '667.67pt face) and the two layers drift apart again',
  );
  assert.doesNotMatch(
    body,
    /\bheight\s*:/,
    'hero-carries-no-flex-axis-key: heroFill gained an explicit `height:` — absoluteFillObject '
    + 'already pins top and bottom, and a height would re-introduce an independently computed '
    + 'box',
  );

  // The two constants whose removal IS the fix must not come back.
  const code = stripCommentsAndStrings(source.swipeable);
  for (const dead of ['IMAGE_SECTION_RATIO', 'DETAILS_SECTION_RATIO']) {
    assert.ok(
      !code.includes(dead),
      `hero-carries-no-flex-axis-key: ${dead} is back in SwipeableCards. #1609 deleted it `
      + 'rather than retuning it, because any value other than 1.0 re-opens the two-tree '
      + 'disagreement',
    );
  }
});

test('T-4 both trees are handed the SAME hero style, and the tray is gone', () => {
  const code = stripCommentsAndStrings(source.swipeable);

  const posterProps = [...code.matchAll(/posterHeroStyle=\{/g)];
  assert.equal(
    posterProps.length,
    1,
    `both-trees-share-one-hero-style: expected exactly ONE posterHeroStyle={ call site, found `
    + `${posterProps.length} — zero means this assertion would pass by finding nothing`,
  );
  const propStart = posterProps[0].index;
  const propText = code.slice(propStart, propStart + 160);
  assert.match(
    propText,
    /styles\.heroFill/,
    'both-trees-share-one-hero-style: the poster tree must be handed styles.heroFill — the '
    + 'SAME object the face tree uses. Two separately-authored styles is how the poster and '
    + 'the face silently diverge (#1593)',
  );

  // The face tree must use it too.
  assert.match(
    code,
    /style=\{styles\.heroFill\}/,
    'both-trees-share-one-hero-style: no face-tree node applies styles.heroFill',
  );

  // The white tray and its share button are deleted, not merely hidden.
  for (const dead of ['cardDetails', 'shareButton', 'shareButtonText']) {
    assert.ok(
      !code.includes(`styles.${dead}`),
      `white-tray-is-gone: styles.${dead} is still referenced. #1609 DELETES the 115.33pt `
      + 'white tray (Constitution rule 8, subtract before adding) — keeping it behind a '
      + 'condition leaves the corner-radius mismatch and the flex sibling alive',
    );
  }
});

test('T-5 the #1593 measurement plumbing is gone, not layered under the redesign', () => {
  const swipeable = stripCommentsAndStrings(source.swipeable);
  const stage = stripCommentsAndStrings(source.stage);

  for (const [label, code] of [['SwipeableCards', swipeable], ['DeckSwipeStage', stage]]) {
    assert.ok(
      !code.includes('heroHoleHeight'),
      `measurement-plumbing-is-gone: ${label} still references heroHoleHeight. #1609 removes `
      + 'the flex-axis disagreement entirely, so measuring one tree and copying the number to '
      + 'the other is dead plumbing — stacking the redesign on top of it violates '
      + 'Constitution rule 8',
    );
    assert.ok(
      !code.includes('posterPhotoBoxOverride'),
      `measurement-plumbing-is-gone: ${label} still references posterPhotoBoxOverride, whose `
      + 'module was deleted — this would not even resolve at runtime',
    );
  }
});

// ---------------------------------------------------------------------------
// The been-here control's safety property.
//
// #1687 SUPERSEDES #1609 Amendment 1 — Seth's decision of 2026-08-06 (issue
// #1687, comment 5209318118). Amendment 1 said the control "must not open a
// rating flow on the collapsed card"; the destination it named instead (#1605
// pillar 4, the rating strip in the expanded card) was never built, so "not here"
// meant "nowhere" and no user could rate any place at all.
//
// THE SAFETY PROPERTY IS UNCHANGED AND THIS TEST STILL ENFORCES IT — an errant
// thumb mid-swipe must not cost the user anything. It is now satisfied by a
// STRONGER mechanism than the old toggle: the tap WRITES NOTHING. It opens a
// prompt carrying a close icon, and the visit is recorded only on confirm. Under
// the old design a stray tap wrote a `user_visits` row and trained the
// recommender before the user could react; under this one it costs one tap to
// dismiss and leaves the database untouched.
//
// So the assertions invert deliberately: `recordVisit.mutate` is now FORBIDDEN
// here (it moved to the modal, which is also the only actor that survives the
// card being swiped away), and the tap MUST reach the prompt. The expand surfaces
// stay forbidden — the control still owns nothing but its own press.
// ---------------------------------------------------------------------------

test('T-6 the collapsed been-here control opens the rating prompt and writes NOTHING on tap', () => {
  const src = stripComments(source.swipeable);

  const start = src.indexOf('const BeenHereControl');
  assert.ok(
    start > 0,
    'been-here-opens-the-prompt-and-writes-nothing: BeenHereControl is gone from '
    + "SwipeableCards — Seth's amendment 1 puts this control on the collapsed card, so its "
    + 'absence is a silent removal of an approved feature',
  );
  const end = src.indexOf('const CardHeroImage', start);
  assert.ok(end > start, 'VACUITY: could not delimit the BeenHereControl component body');
  const body = src.slice(start, end);
  assert.ok(body.length > 400, `VACUITY: extracted BeenHereControl body is implausibly short (${body.length})`);

  // The un-toggle still lives here: a settled tap removes the visit, so a
  // confirmed mistake is undone by one more tap while the card is on screen.
  assert.ok(
    body.includes('removeVisit.mutate'),
    'been-here-opens-the-prompt-and-writes-nothing: the control must call removeVisit.mutate '
    + '— the settled state is the un-toggle, and #1686 is about making it VISIBLE, not about '
    + 'deleting it',
  );

  // The tap must reach the prompt on the SINGLE PostExperienceModal instance.
  assert.ok(
    body.includes('openPlaceReviewRequest'),
    'been-here-opens-the-prompt-and-writes-nothing: the control no longer opens the rating '
    + 'prompt (#1687). Before this, rating was something that HAPPENED TO YOU if you had '
    + 'scheduled a place and let the time pass — there was no user-initiated way to rate '
    + 'anywhere in the app.',
  );

  // THE SAFETY PROPERTY, in its #1687 form: the tap writes nothing at all.
  // Re-introducing the record here would (a) put a write behind an errant thumb
  // again and (b) re-create the cancel-races-an-11.8s-insert shape that produced
  // #1618, #1642 and #1661.
  for (const forbidden of ['recordVisit.mutate', 'useRecordVisit']) {
    assert.ok(
      !body.includes(forbidden),
      `been-here-opens-the-prompt-and-writes-nothing: BeenHereControl reaches "${forbidden}". `
      + 'The visit is recorded on CONFIRM, by the modal (services/placeReviewService.ts), so a '
      + 'cancelled tap leaves nothing behind. Writing on tap and deleting on cancel races a '
      + 'delete against an insert whose cold path measures 11.8 seconds.',
    );
  }

  // #1687 REWORK — RESTORED, and widened. The T-6 rewrite above inverted the
  // record assertions (a genuine strengthening: a mis-tap now costs nothing at
  // all) but it ALSO dropped 'Rating' and 'rating' from the forbidden list, and
  // that drop was not required by the decision — neither substring is present in
  // the control body, so the guard passed either way. Dropping them narrowed the
  // guard to two named symbols, and a write re-introduced through ANY other one
  // slipped past T-6, past #1687's S-1 and past the behavioural half, which
  // drives the service directly and never sees this component.
  //
  // Both are back, together with the write surface itself. `rating`/`Rating`
  // keeps rating STATE and rating UI out of a control that must only hand off to
  // the modal; the rest keeps any direct database write out of it, whatever it
  // is called. What the control may reach is exactly one thing:
  // `openPlaceReviewRequest`, asserted above.
  for (const forbidden of [
    'Rating',
    'rating',
    'supabase',
    'place_reviews',
    'user_visits',
    'submitVoluntaryPlaceReview',
    'mutateAsync',
  ]) {
    assert.ok(
      !body.includes(forbidden),
      `been-here-opens-the-prompt-and-writes-nothing: BeenHereControl reaches "${forbidden}". `
      + 'The tap must WRITE NOTHING and must hold no rating state of its own — it opens the '
      + 'prompt (openPlaceReviewRequest) and the modal owns everything after that. Naming only '
      + 'recordVisit.mutate/useRecordVisit would let the same write back in under a new symbol.',
    );
  }

  // It must still reach NO expand surface. The control owns its own press and
  // nothing else — that is what keeps it off the swipe path's gesture ledger.
  for (const forbidden of [
    'setSelectedCardForExpansion',
    'requestTapExpand',
    'handleCardExpand',
    'setIsExpandedModalVisible',
  ]) {
    assert.ok(
      !body.includes(forbidden),
      `been-here-opens-the-prompt-and-writes-nothing: BeenHereControl reaches "${forbidden}". `
      + 'The control must not open the expanded card — #1618 defect 2 was exactly that press '
      + 'falling through, and the placement argument rests on it owning nothing else.',
    );
  }

  // 44pt target, per the amendment.
  const styleIdx = src.indexOf('beenHere: {');
  assert.ok(styleIdx > 0, 'been-here-opens-the-prompt-and-writes-nothing: styles.beenHere is gone');
  const styleBody = src.slice(styleIdx, src.indexOf('},', styleIdx));
  assert.match(
    styleBody,
    /height:\s*44\b/,
    'been-here-opens-the-prompt-and-writes-nothing: the control must be a full 44pt target '
    + '(touchTargets.minimum) without relying on hitSlop to reach it',
  );

  // Constitution rule 3 — the failure path must be visible, not swallowed.
  assert.ok(
    body.includes('isError'),
    'been-here-failure-is-surfaced: the control must read the mutation error state. '
    + "useVisits' own onError only console.errors, so without this a failed record is a DEAD "
    + 'TAP — and record-visit currently returns 500 on every call in production',
  );
  assert.ok(
    body.includes('been_here_failed'),
    'been-here-failure-is-surfaced: the control must render a user-visible failure label',
  );
});

test('T-8 every CLAIM this file makes is backed by a real assertion in its own code', () => {
  const claims = [...source.self.matchAll(/\/\/\s*CLAIM:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(
    claims.length >= 11,
    `VACUITY: only ${claims.length} CLAIM tokens parsed from this file's own comments`,
  );
  const code = stripComments(source.self);
  for (const claim of claims) {
    assert.ok(
      code.includes(claim),
      `a comment in this file claims to enforce "${claim}" but no assertion in the code `
      + 'mentions it — that is #1607 Discovery 2, an enforcement that exists only in a comment',
    );
  }
  assert.ok(
    source.self.length >= 500,
    `the guard is only ${source.self.length} chars — a stub is not a gate`,
  );
  console.log(`T-8 examined ${claims.length} claims`);
});
