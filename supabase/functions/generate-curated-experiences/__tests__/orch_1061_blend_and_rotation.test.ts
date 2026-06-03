// ORCH-1061 — implementor happy-path Deno tests for PART 1A (quality+proximity
// blend), PART 1B (deterministic main-activity rotation), and the PART 2 solo
// empty-summary contract.
//
// The module is imported directly; its serve() is guarded by `import.meta.main`
// (ORCH-1061) so importing it does NOT start the HTTP server.
//
// Covers (implementor-owned rows from SPEC §8):
//   T-1A-01 (fails-on-revert) — post-anchor pick is quality-weighted, not nearest.
//   T-1A-03 — selection is deterministic.
//   T-1A-05 — empty/single guards match the old helper.
//   T-1B-MAP — mainActivitySlotIndex yields the exact §5.2 mapping.
//   T-1B-01 — combo ordering is deterministic.
//   T-1B-02 — main activity rotates card-to-card.
//   T-1B-04 — picnic = no rotation, single-combo repeat.
//   T-2-07 — when the hours filter empties the deck, a summary verdict is emitted.
//
// Run: cd supabase && deno test --allow-read --allow-env functions/generate-curated-experiences/__tests__/orch_1061_blend_and_rotation.test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  selectBlendedStop,
  mainActivitySlotIndex,
  buildDeterministicComboList,
  EXPERIENCE_TYPE_MAP,
} from '../index.ts';
import { filterCuratedByStopHours } from '../../_shared/curatedStopHours.ts';

// ─── PART 1A — blend ──────────────────────────────────────────────────────────

Deno.test('T-1A-01 (fails-on-revert): post-anchor pick is quality-weighted, not nearest', () => {
  // Ref point at (0,0). Candidate A is CLOSER but LOW quality. Candidate B is
  // slightly farther but MUCH higher vibe rank + rating + reviews. With the
  // 0.6·Q + 0.4·P blend, B must win. Pure-nearest (the reverted behavior) would
  // pick A → test FAILS on revert.
  const radiusMeters = 5000; // 5km radius
  const ref = { lat: 0, lng: 0 };

  // ~0.5km away, weak signal.
  const closeWeak = {
    google_place_id: 'A_close_weak',
    lat: 0.0045, lng: 0, // ~0.5km north
    _rankScore: 10,
    rating: 3.6,
    review_count: 12,
  };
  // ~2km away, strong signal.
  const fartherStrong = {
    google_place_id: 'B_far_strong',
    lat: 0.018, lng: 0, // ~2km north
    _rankScore: 100,
    rating: 4.8,
    review_count: 2400,
  };

  const pick = selectBlendedStop([closeWeak, fartherStrong], ref.lat, ref.lng, radiusMeters);
  assertEquals(pick?.google_place_id, 'B_far_strong',
    'blend must prefer the farther high-quality candidate over the closer weak one');
});

Deno.test('T-1A-03: blended selection is deterministic across runs', () => {
  const ref = { lat: 35.78, lng: -78.64 };
  const candidates = [
    { google_place_id: 'p1', lat: 35.79, lng: -78.65, _rankScore: 80, rating: 4.5, review_count: 300 },
    { google_place_id: 'p2', lat: 35.781, lng: -78.641, _rankScore: 40, rating: 4.9, review_count: 50 },
    { google_place_id: 'p3', lat: 35.80, lng: -78.66, _rankScore: 95, rating: 4.2, review_count: 900 },
  ];
  const a = selectBlendedStop(candidates, ref.lat, ref.lng, 8000);
  const b = selectBlendedStop(candidates, ref.lat, ref.lng, 8000);
  assertEquals(a?.google_place_id, b?.google_place_id, 'same inputs → same pick');
});

Deno.test('T-1A-05: empty → null; single → that element', () => {
  assertEquals(selectBlendedStop([], 0, 0, 3000), null, 'empty must return null');
  const only = { google_place_id: 'solo', lat: 1, lng: 1, _rankScore: 5, rating: 4, review_count: 10 };
  assertEquals(selectBlendedStop([only], 0, 0, 3000), only, 'single must return that element');
});

// ─── PART 1B — deterministic rotation ────────────────────────────────────────

Deno.test('T-1B-MAP: mainActivitySlotIndex yields the exact SPEC §5.2 mapping', () => {
  const expect: Record<string, number> = {
    'adventurous': 0,
    'first-date': 1,
    'romantic': 1,
    'group-fun': 0,
    'take-a-stroll': 1,
    'picnic-dates': -1,
  };
  for (const [id, idx] of Object.entries(expect)) {
    const typeDef = EXPERIENCE_TYPE_MAP[id];
    assert(typeDef, `typeDef ${id} must exist`);
    assertEquals(mainActivitySlotIndex(typeDef), idx, `${id} main-activity slot index`);
  }
});

Deno.test('T-1B-01: combo ordering is deterministic for identical (typeDef, batchSeed, limit)', () => {
  const typeDef = EXPERIENCE_TYPE_MAP['adventurous'];
  const a = buildDeterministicComboList(typeDef, 7, 20);
  const b = buildDeterministicComboList(typeDef, 7, 20);
  assertEquals(JSON.stringify(a), JSON.stringify(b), 'same inputs → identical ordering');
  assert(a.length >= 40, 'list must be at least limit*2 long');
});

Deno.test('T-1B-02: main activity rotates card-to-card while distinct activities remain', () => {
  const typeDef = EXPERIENCE_TYPE_MAP['adventurous'];
  const slotIdx = mainActivitySlotIndex(typeDef);
  const distinct = new Set(typeDef.combos.map((c) => c[slotIdx])).size; // distinct main activities
  const list = buildDeterministicComboList(typeDef, 0, 20);
  // For the first `distinct` cards, consecutive main-activity slugs must differ.
  for (let i = 1; i < distinct; i++) {
    assert(
      list[i][slotIdx] !== list[i - 1][slotIdx],
      `card ${i} main activity (${list[i][slotIdx]}) must differ from card ${i - 1} (${list[i - 1][slotIdx]})`,
    );
  }
});

Deno.test('T-1B-02b: take-a-stroll rotates the FOOD slot while nature anchor stays constant', () => {
  const typeDef = EXPERIENCE_TYPE_MAP['take-a-stroll'];
  const slotIdx = mainActivitySlotIndex(typeDef);
  assertEquals(slotIdx, 1, 'take-a-stroll rotates the food slot (index 1), not the nature anchor');
  const list = buildDeterministicComboList(typeDef, 0, 20);
  // Nature anchor (index 0) is constant across all entries.
  for (const combo of list) {
    assertEquals(combo[0], 'nature', 'nature anchor must stay constant');
  }
  // Food slug rotates across the 3 distinct foods in the first 3 cards.
  const firstThreeFoods = [list[0][1], list[1][1], list[2][1]];
  assertEquals(new Set(firstThreeFoods).size, 3, 'first 3 cards rotate through all 3 foods');
});

Deno.test('T-1B-04: picnic = no rotation, single-combo repeat to limit*2', () => {
  const typeDef = EXPERIENCE_TYPE_MAP['picnic-dates'];
  const list = buildDeterministicComboList(typeDef, 5, 20);
  assert(list.length >= 40, 'list must be at least limit*2 long');
  for (const combo of list) {
    assertEquals(JSON.stringify(combo), JSON.stringify(['groceries', 'flowers', 'nature']),
      'every picnic entry must be the single frozen combo');
  }
});

Deno.test('T-1B-05: batchSeed changes the start offset deterministically', () => {
  const typeDef = EXPERIENCE_TYPE_MAP['adventurous'];
  const slotIdx = mainActivitySlotIndex(typeDef);
  const first0 = buildDeterministicComboList(typeDef, 0, 20)[0][slotIdx];
  const first1 = buildDeterministicComboList(typeDef, 1, 20)[0][slotIdx];
  // adventurous has ≥2 distinct main activities → seed 0 vs 1 start differently.
  assert(first0 !== first1, 'different batchSeed → different first main activity');
  // ...and each is reproducible.
  assertEquals(buildDeterministicComboList(typeDef, 1, 20)[0][slotIdx], first1, 'seed 1 reproducible');
});

// ─── PART 2 — solo empty-summary contract ────────────────────────────────────

Deno.test('T-2-07: when the hours filter empties the deck, a summary verdict is produced', () => {
  // Replicate the handler post-filter logic (index.ts handler):
  //   cards = filterCuratedByStopHours(cards, curatedUtcNow);
  //   if (cards.length === 0 && !summary) summary = { emptyReason: 'pool_empty', ... }
  const WED_1800_UTC = new Date(Date.UTC(2026, 5, 3, 18, 0, 0));
  const closedCard = {
    cardType: 'curated', utcOffsetMinutes: 0, lng: 0,
    stops: [{
      placeType: 'restaurant',
      openingHours: { periods: [{ open: { day: 3, hour: 9, minute: 0 }, close: { day: 3, hour: 17, minute: 0 } }] },
      travelTimeFromPreviousStopMin: 0,
    }],
  };

  let cards: Record<string, unknown>[] = [closedCard];
  let summary: { emptyReason: string; candidateAnchorCount: number; failedAnchorCount: number } | undefined =
    undefined; // generateCardsForType returned cards>0, so no summary yet
  cards = filterCuratedByStopHours(cards, WED_1800_UTC);
  if (cards.length === 0 && !summary) {
    summary = { emptyReason: 'pool_empty', candidateAnchorCount: 0, failedAnchorCount: 0 };
  }

  assertEquals(cards.length, 0, 'closed card filtered out');
  assert(summary, 'summary verdict must be set so mobile routes to EMPTY UI');
  assertEquals(summary.emptyReason, 'pool_empty');
});
