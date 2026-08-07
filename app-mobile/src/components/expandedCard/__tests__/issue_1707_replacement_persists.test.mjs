/**
 * Issue #1707 — a replaced stop survives closing the sheet, and gets saved.
 *
 * Seth: "When i choose replace a stop, it works, but it does not persist. It
 * goes back to the same thing when i close it. Even when i save it as i have
 * changed it, it does not persist."
 *
 * TWO HALVES, and only one of them was ever proven broken. The issue was written
 * saying so, and the fix respects it:
 *
 *   1. THE DECK. `curatedLocalCard` is component state in `ExpandedCardModal`
 *      with four readers, all inside that one file, and NO writer anywhere else.
 *      The sheet unmounts and the edit is gone. Confirmed broken.
 *
 *   2. THE SAVE. `ActionButtons` receives `card={(planCard ?? card)}` — the
 *      EDITED plan — and hands it to `onSave`. But the deck's `onSave` handler
 *      ignores its argument on the matching-card path and calls
 *      `handleSwipe('right', currentRec)`, i.e. the deck's own copy. So the save
 *      wrote the ORIGINAL — but ONLY because the deck's copy was stale.
 *
 * Fixing half 1 therefore fixes half 2: once `applyCuratedEdit` patches the
 * deck's list, `currentRec` IS the edited plan and the existing save path writes
 * it. That is a claim about a chain, so this file asserts every link of it
 * rather than the endpoints.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

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
const DECK = strip(read('app-mobile/src/components/SwipeableCards.tsx'));
const CTX = strip(read('app-mobile/src/contexts/RecommendationsContext.tsx'));
const SAVED = strip(read('app-mobile/src/services/savedCardsService.ts'));

test('T-0 the stripper strips, and the needles are real', () => {
  assert.ok(MODAL.includes('curatedLocalCard'), 'T-0 (vacuity): the state name is wrong');
  assert.ok(CTX.includes('applyCuratedEdit'), 'T-0 (vacuity): the write-back name is wrong');
});

test('T-1 link 1 — accepting an alternative hands the edit OUT of the sheet', () => {
  // The literal defect: `setCuratedLocalCard(replaceStopInCard(...))` and nothing
  // else. State with no writer beyond the component that owns it.
  const fn = MODAL.slice(MODAL.indexOf('const handleSelectAlternative'), MODAL.indexOf('const handleSelectAlternative') + 1800);
  assert.ok(fn.length > 0, 'T-1: handleSelectAlternative is gone');
  assert.match(fn, /setCuratedLocalCard\(/, 'T-1: the sheet no longer updates its own view');
  assert.match(
    fn, /onCardEdited\?\.\(/,
    'T-1: the edit is not handed back. `curatedLocalCard` dies with the sheet, so closing it throws '
    + 'the replacement away and reopening shows the original.',
  );
});

test('T-1b the edit is keyed on the CARD, not on whatever was last opened', () => {
  const fn = MODAL.slice(MODAL.indexOf('const handleSelectAlternative'), MODAL.indexOf('const handleSelectAlternative') + 1800);
  assert.match(
    fn, /onCardEdited\?\.\(edited\.id/,
    'T-1b: the write-back is keyed on something other than the edited card\'s own id, so a sheet '
    + 'opened from Likes or the calendar would patch the wrong card',
  );
});

test('T-2 link 2 — the deck wires the callback to the write-back', () => {
  assert.match(DECK, /onCardEdited=\{/, 'T-2: the deck does not wire onCardEdited');
  assert.match(DECK, /applyCuratedEdit\(cardId, edited/, 'T-2: the deck receives the edit and drops it');
  assert.match(DECK, /^\s*applyCuratedEdit,$/m, 'T-2: applyCuratedEdit is not pulled off the context');
});

test('T-3 link 3 — the write-back patches BOTH the live list and the cache', () => {
  // Patching only the state makes the edit survive closing the sheet and die on
  // the next cold launch — the same bug one layer down.
  const fn = CTX.slice(CTX.indexOf('const applyCuratedEdit'), CTX.indexOf('const applyCuratedEdit') + 1400);
  assert.ok(fn.length > 0, 'T-3: applyCuratedEdit is gone');
  assert.match(fn, /setRecommendations\(/, 'T-3: the live deck list is not patched');
  assert.match(fn, /cardsCache\.setCachedCards\(/, 'T-3: the cache the deck restores from is not patched');
  assert.match(fn, /cardsCache\.getCachedCards\(/, 'T-3: the cache is written without being read first');
  // Merge, never replace: a stale editor must not revert fields the deck has
  // refreshed underneath it.
  assert.match(fn, /\{ \.\.\.card, \.\.\.edited \}/, 'T-3: the patch replaces the card instead of merging into it');
});

test('T-4 link 4 — Save writes the card the DECK holds, which is now the edited one', () => {
  // This is why fixing half 1 fixes half 2, and it is a claim about a chain, so
  // each link is asserted rather than the endpoints.
  //
  // ActionButtons is handed `(planCard ?? card)` — the edited plan.
  assert.match(
    MODAL, /card=\{\(planCard \?\? card\) as ExpandedCardData\}/,
    'T-4: the action band is no longer given the edited plan',
  );
  // The deck's save path reads `currentRec` — its OWN copy — which the write-back
  // has now patched. If this ever stopped reading the deck's copy, the write-back
  // would no longer be what makes the save correct.
  assert.match(
    DECK, /await handleSwipe\("right", currentRec\)/,
    'T-4: the deck\'s save path no longer saves currentRec, so the write-back is no longer what '
    + 'makes a replaced stop persist',
  );
  // And what lands in the row is the whole card object, not a rebuilt subset.
  assert.match(SAVED, /card_data: \{\s*\.\.\.card,/, 'T-4: saveCard no longer persists the card it is given');
});

test('T-5 only the fields a replacement changes are sent', () => {
  // A blanket `{...edited}` would let a sheet opened minutes ago revert fields
  // the deck has refreshed since — distance, price, photos.
  const fn = MODAL.slice(MODAL.indexOf('onCardEdited?.('), MODAL.indexOf('onCardEdited?.(') + 500);
  assert.match(fn, /stops:/, 'T-5: the replaced stops are not sent');
  assert.match(fn, /travelTime:/, 'T-5: the recomputed travel time is not sent');
  assert.equal(
    /onCardEdited\?\.\(edited\.id, edited\)/.test(MODAL), false,
    'T-5: the whole edited card is sent as the patch',
  );
});

test('T-6 the sheet still shows the edit immediately (no round trip)', () => {
  // The write-back must not REPLACE the local state — the user has to see the
  // swap the instant they pick it, not after a re-render from the deck.
  const fn = MODAL.slice(MODAL.indexOf('const handleSelectAlternative'), MODAL.indexOf('const handleSelectAlternative') + 1800);
  const setLocal = fn.indexOf('setCuratedLocalCard(');
  const handOut = fn.indexOf('onCardEdited?.(');
  assert.ok(setLocal >= 0 && handOut > setLocal, 'T-6: the local view is not updated before the edit is handed out');
  assert.match(MODAL, /const planCard = curatedLocalCard \?\? curatedCard;/, 'T-6: the sheet no longer prefers its local edit');
});
