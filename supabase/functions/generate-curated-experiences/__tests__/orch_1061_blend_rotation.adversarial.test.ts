// ORCH-1061 — TESTER adversarial Deno tests for PART 1A (quality+proximity blend)
// and PART 1B (deterministic main-activity rotation).
//
// These attack DIFFERENT angles than the implementor's happy-path file
// (orch_1061_blend_and_rotation.test.ts): they hunt the failure modes the
// happy-path does not exercise — a case where pure-nearest would WIN (proving
// the blend actually changed the pick), the full deterministic tie-break CHAIN
// (every rung: _rankScore → rating → review_count → smaller google_place_id),
// proof that take-a-stroll rotates the FOOD slot and NOT the nature anchor,
// batchSeed start-offset determinism across multiple seeds, and a source-grep
// asserting NO Math.random is reachable in the ordering/selection path
// (I-COLLAB-DECK-DETERMINISM).
//
// The module's serve() is guarded by `import.meta.main` (ORCH-1061) so importing
// it does NOT start the HTTP server.
//
// Run: cd supabase && deno test --allow-read --allow-env --no-check \
//   functions/generate-curated-experiences/__tests__/orch_1061_blend_rotation.adversarial.test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  selectBlendedStop,
  tieBreakWins,
  mainActivitySlotIndex,
  buildDeterministicComboList,
  EXPERIENCE_TYPE_MAP,
} from '../index.ts';

// ─── T-1A-02 (adversarial): pure-nearest would have LOST → the blend wins ──────
// Construct a case where the CLOSEST candidate is decisively the WRONG pick: it
// sits almost on top of the ref point (so pure-nearest picks it every time) but
// has the weakest quality, while a candidate near the radius edge has dominant
// vibe rank + rating + reviews. Pure-nearest (the reverted production behavior)
// returns the on-top weak one; the 0.6·Q + 0.4·P blend must return the strong one.
Deno.test('T-1A-02 (adversarial): blend overrides pure-nearest when nearest is the worst candidate', () => {
  const radiusMeters = 10000; // 10km radius
  const ref = { lat: 40.0, lng: -75.0 };

  // ~50m away (essentially at the ref point) — would ALWAYS win pure-nearest.
  const nearestWorst = {
    google_place_id: 'NEAREST_BUT_WORST',
    lat: 40.00045, lng: -75.0, // ~50m north
    _rankScore: 1,             // bottom of the pool
    rating: 3.0,
    review_count: 2,
  };
  // ~4km away — far from the ref but the clearly-best venue.
  const farButBest = {
    google_place_id: 'FAR_BUT_BEST',
    lat: 40.036, lng: -75.0, // ~4km north
    _rankScore: 100,
    rating: 4.9,
    review_count: 5000,
  };
  // A mid candidate to make the pool realistic (not a 2-element edge case).
  const midMeh = {
    google_place_id: 'MID_MEH',
    lat: 40.009, lng: -75.0, // ~1km north
    _rankScore: 30,
    rating: 4.0,
    review_count: 100,
  };

  // Sanity: confirm nearestWorst really IS the nearest (so this is a true
  // pure-nearest-would-lose scenario, not an accidental tie).
  const pool = [nearestWorst, midMeh, farButBest];
  const pick = selectBlendedStop(pool, ref.lat, ref.lng, radiusMeters);
  assertEquals(
    pick?.google_place_id,
    'FAR_BUT_BEST',
    'blend must reject the on-top weakest candidate that pure-nearest would have picked',
  );
});

// ─── T-1A-04 (adversarial): the FULL deterministic tie-break chain ────────────
// Exercise EVERY rung of tieBreakWins (the arbiter invoked when blended scores
// are within 1e-9): _rankScore → rating → review_count → lexicographically
// smaller google_place_id. Plus an end-to-end selectBlendedStop tie where two
// candidates are byte-identical except google_place_id, forcing the lexicographic
// final arbiter through the real selection loop.
Deno.test('T-1A-04 (adversarial): deterministic tie-break chain _rankScore→rating→review_count→id', () => {
  const base = { google_place_id: 'zzz', _rankScore: 50, rating: 4.0, review_count: 100 };

  // Rung 1 — _rankScore dominates everything below it.
  assert(
    tieBreakWins({ ...base, _rankScore: 51 }, { ...base, rating: 5.0, review_count: 99999 }),
    'higher _rankScore wins even against higher rating + reviews',
  );
  assert(
    !tieBreakWins({ ...base, _rankScore: 49 }, base),
    'lower _rankScore loses',
  );

  // Rung 2 — equal _rankScore → higher rating wins (despite fewer reviews).
  assert(
    tieBreakWins({ ...base, rating: 4.7, review_count: 1 }, { ...base, rating: 4.6, review_count: 99999 }),
    'with equal _rankScore, higher rating wins regardless of review_count',
  );

  // Rung 3 — equal _rankScore + rating → higher review_count wins.
  assert(
    tieBreakWins({ ...base, review_count: 500 }, { ...base, review_count: 499 }),
    'with equal _rankScore + rating, higher review_count wins',
  );

  // Rung 4 — equal _rankScore + rating + review_count → smaller google_place_id wins.
  assert(
    tieBreakWins({ ...base, google_place_id: 'aaa' }, { ...base, google_place_id: 'bbb' }),
    'all else equal, lexicographically smaller google_place_id wins',
  );
  assert(
    !tieBreakWins({ ...base, google_place_id: 'ccc' }, { ...base, google_place_id: 'bbb' }),
    'all else equal, lexicographically larger google_place_id loses',
  );
  // Total tie (identical id) → tieBreakWins returns false (no displacement).
  assert(
    !tieBreakWins({ ...base }, { ...base }),
    'a total tie does not displace the incumbent (stable)',
  );

  // End-to-end: two candidates identical in EVERY blend input (same coords, same
  // rating/reviews/rank) differing only in id → selectBlendedStop must return the
  // lexicographically smaller id, deterministically, regardless of array order.
  const same = { lat: 1.234, lng: 5.678, _rankScore: 70, rating: 4.4, review_count: 800 };
  const alpha = { ...same, google_place_id: 'alpha' };
  const omega = { ...same, google_place_id: 'omega' };
  assertEquals(
    selectBlendedStop([omega, alpha], 0, 0, 3000)?.google_place_id,
    'alpha',
    'tied score → smaller id wins (array order [omega, alpha])',
  );
  assertEquals(
    selectBlendedStop([alpha, omega], 0, 0, 3000)?.google_place_id,
    'alpha',
    'tied score → smaller id wins (array order [alpha, omega]) — order-independent',
  );
});

// ─── T-1B-03 (adversarial): take-a-stroll rotates FOOD, never the nature anchor ─
// The happy-path proves the food slot rotates; this adversarial version ATTACKS
// the opposite failure: that a sloppy implementation rotated the ANCHOR (index 0)
// instead of the food slot. It pins (a) the resolved slot is the food slot, NOT
// index 0; (b) the index-0 nature anchor is provably CONSTANT across the entire
// generated list; (c) the food slug genuinely cycles (adjacent cards differ)
// across multiple seeds.
Deno.test('T-1B-03 (adversarial): take-a-stroll rotates the FOOD slot, anchor stays nature', () => {
  const typeDef = EXPERIENCE_TYPE_MAP['take-a-stroll'];
  const slotIdx = mainActivitySlotIndex(typeDef);

  // It must NOT be rotating the anchor (index 0).
  assert(slotIdx !== 0, 'must not rotate the nature anchor (index 0)');
  assertEquals(slotIdx, 1, 'rotation slot is the food slot (index 1)');

  for (const seed of [0, 1, 2, 7, 13]) {
    const list = buildDeterministicComboList(typeDef, seed, 20);
    assert(list.length >= 40, `seed ${seed}: list >= limit*2`);

    // (a) anchor is constant across EVERY entry.
    const anchorSlugs = new Set(list.map((c) => c[0]));
    assertEquals(anchorSlugs.size, 1, `seed ${seed}: nature anchor must be constant`);
    assertEquals([...anchorSlugs][0], 'nature', `seed ${seed}: anchor must be 'nature'`);

    // (b) the food slot genuinely uses ALL three distinct foods.
    const foods = new Set(list.map((c) => c[1]));
    assertEquals(foods.size, 3, `seed ${seed}: all 3 foods must appear in the food slot`);
    assert(foods.has('brunch') && foods.has('casual_food') && foods.has('upscale_fine_dining'),
      `seed ${seed}: foods must be the exact stroll set`);

    // (c) adjacent cards rotate (food differs) for the first 3 cards.
    assert(list[0][1] !== list[1][1], `seed ${seed}: card1 vs card0 food must differ`);
    assert(list[1][1] !== list[2][1], `seed ${seed}: card2 vs card1 food must differ`);
  }
});

// ─── T-1B-05 (adversarial): batchSeed changes the start offset deterministically ─
// The happy-path checks seed 0 vs 1. This attacks determinism harder: across many
// seeds (a) every run for a given seed is byte-identical (reproducible), and
// (b) seed N and seed N+1 start on a DIFFERENT main-activity group offset, with
// the start offset following the locked modulo formula (seed % groupCount).
Deno.test('T-1B-05 (adversarial): batchSeed start-offset is deterministic + follows the modulo formula', () => {
  const typeDef = EXPERIENCE_TYPE_MAP['adventurous'];
  const slotIdx = mainActivitySlotIndex(typeDef);

  // Build the group order the production code derives (first-appearance distinct
  // main-activity slugs) to predict the start offset independently.
  const groupOrder: string[] = [];
  for (const c of typeDef.combos) {
    const slug = c[slotIdx];
    if (!groupOrder.includes(slug)) groupOrder.push(slug);
  }
  const groupCount = groupOrder.length;
  assert(groupCount >= 2, 'adventurous must have >=2 distinct main activities for this test');

  for (const seed of [0, 1, 2, 3, 5, 8, 100]) {
    const a = buildDeterministicComboList(typeDef, seed, 20);
    const b = buildDeterministicComboList(typeDef, seed, 20);
    assertEquals(JSON.stringify(a), JSON.stringify(b), `seed ${seed}: reproducible`);

    // Predicted first main activity = groupOrder[seed % groupCount].
    const predicted = groupOrder[seed % groupCount];
    assertEquals(a[0][slotIdx], predicted,
      `seed ${seed}: first main activity must equal groupOrder[seed % ${groupCount}]`);
  }

  // Adjacent seeds start on different offsets (until they wrap at groupCount).
  for (let seed = 0; seed < groupCount - 1; seed++) {
    const s0 = buildDeterministicComboList(typeDef, seed, 20)[0][slotIdx];
    const s1 = buildDeterministicComboList(typeDef, seed + 1, 20)[0][slotIdx];
    assert(s0 !== s1, `seed ${seed} vs ${seed + 1}: first main activity must differ`);
  }

  // Negative / non-finite seeds are coerced (Math.floor(Math.abs)) — must not throw
  // and must stay deterministic (defensive against collab agg / bad client values).
  const neg = buildDeterministicComboList(typeDef, -3, 20);
  assertEquals(JSON.stringify(neg), JSON.stringify(buildDeterministicComboList(typeDef, 3, 20)),
    'negative seed -3 coerces to abs(3) deterministically');
  const nan = buildDeterministicComboList(typeDef, Number.NaN, 20);
  assertEquals(JSON.stringify(nan), JSON.stringify(buildDeterministicComboList(typeDef, 0, 20)),
    'NaN seed coerces to 0 deterministically');
});

// ─── T-1B-06 (adversarial source-grep): NO Math.random in the ordering path ────
// I-COLLAB-DECK-DETERMINISM: the combo-ordering + stop-selection helpers must be
// pure (no request-time randomness), else collab decks diverge between
// participants. This greps the SOURCE of the actual production functions —
// buildDeterministicComboList, mainActivitySlotIndex, selectBlendedStop,
// tieBreakWins — and asserts none contains `Math.random`. It also asserts the old
// `shuffle(` (the deleted Math.random combo shuffle) is no longer called in the
// ordering path.
Deno.test('T-1B-06 (adversarial source-grep): ordering/selection path has no Math.random', async () => {
  const src = await Deno.readTextFile(new URL('../index.ts', import.meta.url));

  // Helper: extract a function/const body by name up to a heuristic end marker.
  function slice(from: string): string {
    const i = src.indexOf(from);
    assert(i >= 0, `must find '${from}' in source`);
    // Grab a generous window (the largest of these functions is well under 4k chars).
    return src.slice(i, i + 4000);
  }

  // Strip line + block comments so the assertion targets executable code only —
  // the production functions carry comments that literally say "NO Math.random",
  // which is documentation, not a call.
  function stripComments(s: string): string {
    return s
      .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
      .replace(/\/\/[^\n]*/g, '');         // line comments
  }

  for (const fnStart of [
    'export function buildDeterministicComboList(',
    'export function mainActivitySlotIndex(',
    'export function selectBlendedStop(',
    'export function tieBreakWins(',
  ]) {
    const rawBody = slice(fnStart).split('\nexport function')[0].split('\nfunction')[0];
    const codeOnly = stripComments(rawBody);
    // Assert no EXECUTABLE Math.random call (the call form `Math.random(`); the
    // ordering/selection path must be pure for collab determinism.
    assert(
      !/Math\.random\s*\(/.test(codeOnly),
      `${fnStart} body must not call Math.random`,
    );
  }

  // The combo ordering must be driven by the deterministic builder, not a shuffle.
  assert(
    /const comboList: string\[\]\[\] = buildDeterministicComboList\(/.test(src),
    'comboList must be built by buildDeterministicComboList',
  );
  // The old Math.random shuffle() function must be deleted (no definition left).
  assert(
    !/function shuffle\s*<|function shuffle\s*\(/.test(src),
    'the Math.random shuffle() helper must be deleted',
  );
});
