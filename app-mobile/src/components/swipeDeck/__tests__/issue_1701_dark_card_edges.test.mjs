/**
 * Issue #1701 item 8 — the dark bands down the deck card's sides.
 *
 * Seth, twice, on a physical Samsung: "The collapsed card on the deck shows a
 * somewhat black border on the sides."
 *
 * MEASURED FIRST, on `R58R54YV7JT` (SM-A725F, 1080x2400 @ 450dpi): seams at
 * x=110 and x=970 of 1080 — bands of exactly 110px, which at 450dpi is 40.0dp,
 * which is exactly `glass.card.bezelRadius`. Full photo height. The SAME
 * photograph either side of the seam, ~8% darker outside it.
 *
 * BISECTED ON THE DEVICE, because a 40dp coincidence is not a cause:
 *   1. a magenta border on `heroFill` proved the FACE tree's photo spans the
 *      full 0..1079 — so the photo is not inset and the bands are drawn OVER it;
 *   2. removing `elevation` from `styles.card` removed the bands entirely;
 *   3. restoring the shadow but taking `borderRadius` OFF that same view also
 *      removed them — with the shadow intact.
 *
 * THE CAUSE. `styles.card` carried `backgroundColor: 'white'` + `borderRadius:
 * 40` + `elevation: 8`. Android derives an elevation shadow from the view's
 * OUTLINE, and the outline comes from its background and its border radius. On
 * this renderer the rounded-rect ambient shadow is painted INSIDE the view along
 * both vertical edges, for the radius's width — 40dp.
 *
 * THE FIX IS A DELETION. `cardInner` already owns the visual clip
 * (`borderRadius` + `overflow: 'hidden'`), so the radius on the outer,
 * shadow-casting view was redundant to begin with. The shadow stays: the behind
 * card scales to 0.965 during a swipe and its shadow is what separates the two.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
const SRC = readFileSync(resolve(ROOT, 'app-mobile/src/components/SwipeableCards.tsx'), 'utf8');

// SCOPED TO THE STYLESHEET. `metaSpansForCard` takes a parameter literally named
// `card: {`, at column two, so an unscoped match captured a TYPE ANNOTATION and
// the assertions below were inspecting a function signature.
const SHEET = SRC.slice(SRC.indexOf('const styles = StyleSheet.create({'));
const cardStyle = /^  card: \{$([\s\S]*?)^  \},$/m.exec(SHEET);
const innerStyle = /^  cardInner: \{$([\s\S]*?)^  \},$/m.exec(SHEET);

test('X-0 both style blocks are found (guard the guard)', () => {
  assert.ok(cardStyle, 'X-0: the card style block is gone');
  assert.ok(innerStyle, 'X-0: the cardInner style block is gone');
  assert.ok(cardStyle[1].includes('position'), 'X-0: the wrong block was captured');
});

test('X-1 the shadow-casting view has NO border radius', () => {
  // This one line IS the bug. With it, Android paints a 40dp rounded-rect
  // ambient shadow down both inside edges of a card that fills the screen.
  assert.equal(
    /borderRadius/.test(cardStyle[1]), false,
    'X-1: styles.card declares a borderRadius again. It casts the elevation shadow, and a rounded '
    + 'outline puts a bezelRadius-wide dark band down both sides of the card on Samsung.',
  );
});

test('X-2 the shadow itself survives — the behind card needs it', () => {
  // The fix must not be "delete the shadow". The behind card scales to 0.965
  // mid-swipe and the shadow is what separates the two cards.
  assert.match(cardStyle[1], /elevation:\s*\d/, 'X-2: the card lost its elevation');
  assert.match(cardStyle[1], /shadowRadius:\s*\d/, 'X-2: the card lost its iOS shadow');
});

test('X-3 the rounded corners still exist — on the view that CLIPS', () => {
  // Taking the radius off the outer view must not square the card off. The
  // clip has always lived on cardInner; the outer radius was redundant.
  assert.match(innerStyle[1], /borderRadius: glass\.card\.bezelRadius/, 'X-3: the card is no longer rounded');
  assert.match(innerStyle[1], /overflow:\s*["']hidden["']/, 'X-3: cardInner no longer clips its children');
  assert.equal(/elevation/.test(innerStyle[1]), false, 'X-3: the clipping view gained an elevation of its own');
});
