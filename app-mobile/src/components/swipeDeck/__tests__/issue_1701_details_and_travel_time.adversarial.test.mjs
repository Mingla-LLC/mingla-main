/**
 * Issue #1701 — ADVERSARIAL suite. A different angle from the happy path.
 *
 * The sibling file measures tokens and the no-fabrication rule. Every one of
 * those can hold while the control is mounted on nothing, or opens a SECOND
 * expand path, or renders on the behind face where it cannot be pressed.
 *
 * The deck's expand path is the thing most worth protecting here.
 * I-PROPOSED-1579-GESTURE-LEASE-RELEASE-COMPLETENESS exists because a second
 * gesture owner on the card face is how the deck's swipe lease leaks. Details is
 * a NEW pressable on that face, so it gets its own guard.
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

const PLATE_RAW = read('app-mobile/src/components/deckCardPlate.tsx');
const DECK_RAW = read('app-mobile/src/components/SwipeableCards.tsx');
const PLATE = strip(PLATE_RAW);
const DECK = strip(DECK_RAW);
const CURATED = strip(read('app-mobile/src/components/CuratedExperienceSwipeCard.tsx'));

test('E-0 the stripper strips, and the needles are real', () => {
  assert.equal(strip('x; // requestTapExpand\n'), 'x; \n');
  assert.ok(PLATE.length < PLATE_RAW.length);
  assert.ok(DECK_RAW.includes('requestTapExpand'), 'E-0 (vacuity): the expand path name is wrong');
});

test('E-1 Details renders on every card face a user can actually open', () => {
  // Single place, curated plan and brand experience are three trees. A control
  // added to one of them is the drift this deck has produced before.
  // Counted by WIRING, not by matching a JSX element: a lazy `<X[\s\S]*?/>` stops
  // at the first self-closing tag NESTED inside the mount, so it reports one
  // element where there are three and the assertion silently under-counts.
  const wired = [...DECK.matchAll(/onDetailsPress=/g)];
  assert.ok(
    wired.length >= 3,
    `E-1: only ${wired.length} card faces mount Details. The single place, the curated plan and the `
    + 'brand experience are three separate trees and all three open.',
  );
  // And the curated tree must actually accept and forward it, or two of those
  // three are passing a prop into a component that drops it on the floor.
  assert.match(CURATED, /onDetailsPress\?:/, 'E-1: CuratedExperienceSwipeCard does not declare onDetailsPress');
  assert.match(CURATED, /onDetailsPress=\{onDetailsPress\}/, 'E-1: the curated card accepts onDetailsPress and never forwards it');
});

test('E-2 Details does NOT own an expand path — it reuses the deck\'s one', () => {
  // The whole card face is already the tap target and routes through
  // `requestTapExpand`. A second path is a second place for the deck's gesture
  // lease to leak, and a second place for the two to disagree.
  const handlers = [...DECK.matchAll(/onDetailsPress=\{([^}]*)\}/g)].map((m) => m[1].trim());
  assert.ok(handlers.length > 0, 'E-2: nothing wires Details in the deck');
  for (const h of handlers) {
    assert.match(
      h, /deckSwipe\.requestTapExpand\(\)/,
      `E-2: a Details handler is "${h}", not the deck's own requestTapExpand`,
    );
  }
});

test('E-3 the plate itself never decides what Details does', () => {
  // deckCardPlate.tsx must not import a router, a modal or a store to open
  // anything. It renders a Pressable and hands the tap back.
  const body = PLATE.slice(PLATE.indexOf('onDetailsPress ?'), PLATE.indexOf('onDetailsPress ?') + 900);
  assert.ok(body.length > 0, 'E-3: the Details control is gone from the plate');
  assert.match(body, /onPress=\{onDetailsPress\}/, 'E-3: the plate wraps the handler instead of calling it');
  for (const forbidden of ['router.', 'useRouter', 'setExpanded', 'navigation.']) {
    assert.equal(
      PLATE.includes(forbidden), false,
      `E-3: deckCardPlate.tsx references ${forbidden} — the plate is a leaf and must not navigate`,
    );
  }
});

test('E-4 no Details on a face that cannot be pressed', () => {
  // The behind preview is pointerEvents="none". A control there is a lie about
  // affordance (rule L1) and it is also a second, unpressable measurement site.
  const behind = /<DeckCardPlate\s+spans=\{nextSpans\}[\s\S]*?\/>/.exec(DECK);
  assert.ok(behind, 'E-4: the behind face no longer mounts a plate');
  assert.equal(
    /onDetailsPress=/.test(behind[0]), false,
    'E-4: the behind (pointerEvents="none") face mounts Details, which can never be pressed',
  );
  // And the plate must RENDER NOTHING rather than a disabled control when no
  // handler is supplied — a greyed button is still a dead tap.
  assert.match(
    PLATE, /\{onDetailsPress \?\s*\(/,
    'E-4: the Details control is not gated on having a handler',
  );
});

test('E-5 the chevron survives — Details is an addition, not a replacement', () => {
  // Seth kept the chevron explicitly at #1609 (comment 5196932627). The word
  // "Details" was rejected THERE in favour of a view affordance; this adds the
  // word back BESIDE it, and removing the chevron would invert that decision.
  assert.match(PLATE, /name="chevron-up"/, 'E-5: the chevron is gone');
  assert.match(PLATE, /dividerRow/, 'E-5: the divider that carries the chevron is gone');
});

test('E-6 travel time is a span like any other, in the same order everywhere', () => {
  // The span order is truncation priority turned into wrap priority (#1700):
  // rating, distance, travel time, price, category. If two card trees ordered
  // them differently the same place would read differently on two screens.
  const fn = /function metaSpansForCard\([\s\S]*?\n\}/.exec(DECK)[0];
  const order = [...fn.matchAll(/spans\.push\(\{ kind: '(\w+)', text: ([^}]+)\}/g)]
    .map((m) => m[2].trim());
  const idx = (needle) => order.findIndex((t) => t.includes(needle));
  assert.ok(idx('rating') < idx('d') || idx('★') >= 0, 'E-6: the rating is no longer first');
  assert.ok(
    idx('travelTime') > idx('d,'),
    'E-6: travel time is not placed after distance — the two are read together',
  );
  assert.ok(
    idx('travelTime') < idx('priceRange'),
    'E-6: travel time is placed after price, so it is sacrificed to the wrap before price is',
  );
  // ONE producer. The curated card must not build its own facts line.
  assert.equal(
    /function \w*[mM]etaSpans/.test(CURATED), false,
    'E-6: CuratedExperienceSwipeCard grew its own span builder — one card, two facts lines',
  );
});
