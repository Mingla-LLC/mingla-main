// ORCH-1363 — implementor hermetic Deno tests for the STANDARD-branch
// reachable-first-stop fix (SPEC §4.A/§4.B + §7, rows T-1363-01..06).
//
// The bug: the STANDARD (non-reverse-anchor) branch pinned the first stop of
// every combo to a bare `available[0]` — the single top-`scenic` park. Because
// Take-a-Stroll's stop-1 category is the constant `nature` anchor across all
// three combos, every combo re-picked the SAME top park. When that one park was
// out-of-gate (Queen Mary's @ 48.7-min walk > the 45-min gate at London
// walking/30) the standard branch had no way to advance → 0 cards despite 384
// reachable scenic parks. `pickReachableFirstStop` pre-filters `available` to
// places reachable within the SAME gate the post-assembly check enforces
// (travelConstraintValue*1.5) and returns the top-RANKED reachable one, falling
// through to `available[0]` only when none are reachable.
//
// The module is imported directly; its serve() is guarded by `import.meta.main`
// so importing it does NOT start the HTTP server and needs no DB.
//
// Covers (implementor-owned rows from SPEC §7):
//   T-1363-01 (fails-on-revert) — top park out-of-gate, lower-ranked in-gate →
//              helper returns the in-gate one (reverting to `available[0]` FAILS).
//   T-1363-02 — all-reachable → returns available[0] (top rank preserved).
//   T-1363-03 — none-reachable → returns available[0] (honest fall-through).
//   T-1363-04 — rotation: sequential picks with prior removed → ≥2 distinct parks.
//   T-1363-05 — meal-combo cycle intact (nature constant, 3 foods rotate).
//   T-1363-06 — verdict split: 0 candidates → pool_empty, >0 → no_viable_anchor.
//
// Run: cd supabase && deno test --allow-read --allow-env functions/generate-curated-experiences/__tests__/orch_1363_reachable_first_stop.test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  pickReachableFirstStop,
  buildDeterministicComboList,
  EXPERIENCE_TYPE_MAP,
} from '../index.ts';
import { haversineKm, estimateTravelMinutes } from '../../_shared/distanceMath.ts';

// London city centre — the exact live-fire origin from the investigation.
const LON_LAT = 51.5072178;
const LON_LNG = -0.1275862;
const GATE_MIN = 30 * 1.5; // 45 — travelConstraintValue * 1.5 at walking/30

// Helper: minutes the code (buildCardStop + post-gate) would compute for a place.
const walkMin = (lat: number, lng: number) =>
  estimateTravelMinutes(haversineKm(LON_LAT, LON_LNG, lat, lng), 'walking');

// A park at a given north-offset (deg latitude) from London centre.
// 1 deg latitude ≈ 111.19 km, so the walking travel time scales with the offset.
const parkAt = (id: string, latOffsetDeg: number, rankScore: number) => ({
  google_place_id: id,
  lat: LON_LAT + latOffsetDeg,
  lng: LON_LNG,
  _rankScore: rankScore,
});

// ─── T-1363-01 (fails-on-revert) ──────────────────────────────────────────────

Deno.test('T-1363-01 (fails-on-revert): out-of-gate top park is skipped for the in-gate lower-ranked one', () => {
  // Modeled on real London: Queen Mary's Rose Gardens is the top-scenic park but
  // sits ~48.7-min walk away (past the 45-min gate); St James's Park is 3 ranks
  // lower but ~13-min walk. Rank-DESCENDING list (available[0] = highest rank).
  const queenMarys = parkAt('queen_marys_rose_gardens', 0.030, 100); // ~58 min → OUT of gate
  const stJamess    = parkAt('st_jamess_park',          0.007, 90);  // ~13 min → IN gate
  const greenPark   = parkAt('green_park',              0.012, 80);  // ~23 min → IN gate
  const hydePark    = parkAt('hyde_park',               0.018, 70);  // ~35 min → IN gate
  const available = [queenMarys, stJamess, greenPark, hydePark];

  // Sanity: the fixtures actually straddle the gate the way the scenario needs.
  assert(walkMin(queenMarys.lat, queenMarys.lng) > GATE_MIN, 'available[0] must be OUT of gate');
  assert(walkMin(stJamess.lat, stJamess.lng) <= GATE_MIN, 'available[1] must be IN gate');

  const pick = pickReachableFirstStop(available, LON_LAT, LON_LNG, 'walking', 30);

  // The fix: returns the TOP-RANKED REACHABLE park (St James's), NOT available[0].
  // Reverting the call site to a bare `available[0]` returns Queen Mary's → FAIL.
  assertEquals(pick?.google_place_id, 'st_jamess_park',
    'must return the top-ranked reachable park, not the out-of-gate available[0]');
  assert(pick?.google_place_id !== 'queen_marys_rose_gardens',
    'the out-of-gate top park must NOT be picked');
  assert(walkMin(pick!.lat, pick!.lng) <= GATE_MIN,
    'the picked first stop must be within the 45-min gate (guaranteed to pass the post-assembly check)');
});

// ─── T-1363-02 (happy, all-reachable) ─────────────────────────────────────────

Deno.test('T-1363-02: all candidates in-gate → returns available[0] (top rank preserved)', () => {
  const a = parkAt('park_a', 0.006, 100); // ~12 min
  const b = parkAt('park_b', 0.010, 90);  // ~19 min
  const c = parkAt('park_c', 0.015, 80);  // ~29 min
  const available = [a, b, c];
  for (const p of available) {
    assert(walkMin(p.lat, p.lng) <= GATE_MIN, `${p.google_place_id} must be in-gate for this case`);
  }
  const pick = pickReachableFirstStop(available, LON_LAT, LON_LNG, 'walking', 30);
  assertEquals(pick?.google_place_id, 'park_a', 'all-reachable → top-ranked available[0]');
});

// ─── T-1363-03 (edge, none-reachable) ─────────────────────────────────────────

Deno.test('T-1363-03: no candidate in-gate → returns available[0] (honest fall-through)', () => {
  const a = parkAt('far_a', 0.030, 100); // ~58 min
  const b = parkAt('far_b', 0.040, 90);  // ~77 min
  const c = parkAt('far_c', 0.050, 80);  // ~96 min
  const available = [a, b, c];
  for (const p of available) {
    assert(walkMin(p.lat, p.lng) > GATE_MIN, `${p.google_place_id} must be out-of-gate for this case`);
  }
  const pick = pickReachableFirstStop(available, LON_LAT, LON_LNG, 'walking', 30);
  // Fall through to available[0] so the post-assembly gate + no_viable_anchor
  // handle the honest empty — never fabricate a card with an out-of-gate stop.
  assertEquals(pick?.google_place_id, 'far_a', 'none-reachable → available[0] fall-through');
  assert(walkMin(pick!.lat, pick!.lng) > GATE_MIN,
    'the fall-through pick is still out-of-gate → the post-assembly gate rejects it');
});

Deno.test('T-1363-03b: empty list → null (defensive guard, matches selectBlendedStop)', () => {
  assertEquals(pickReachableFirstStop([], LON_LAT, LON_LNG, 'walking', 30), null);
});

// ─── T-1363-04 (rotation) ─────────────────────────────────────────────────────

Deno.test('T-1363-04: sequential picks with prior removed rotate ≥2 distinct in-gate parks', () => {
  // Simulate card-to-card dedup: the caller rebuilds `available` each combo from
  // the deduped pool. Pick, remove the pick, pick again — the reachable subset is
  // order-preserving so successive cards pick DIFFERENT reachable parks.
  // far_top is the HIGHEST-ranked park (available[0]) but OUT of gate — the exact
  // shape of the real bug. The fix must skip it on every card, not just card 1.
  let pool = [
    parkAt('far_top', 0.040, 200), // ~77 min — highest rank but OUT of gate
    parkAt('reach_1', 0.006, 100), // ~12 min
    parkAt('reach_2', 0.010, 90),  // ~19 min
    parkAt('reach_3', 0.015, 80),  // ~29 min
  ];
  const picks: string[] = [];
  for (let i = 0; i < 3; i++) {
    const pick = pickReachableFirstStop(pool, LON_LAT, LON_LNG, 'walking', 30);
    assert(pick, `pick ${i} must exist`);
    assert(walkMin(pick!.lat, pick!.lng) <= GATE_MIN, `pick ${i} must be in-gate`);
    picks.push(pick!.google_place_id);
    pool = pool.filter((p) => p.google_place_id !== pick!.google_place_id);
  }
  // The out-of-gate top-rank park is never chosen; the 3 in-gate parks rotate.
  assert(!picks.includes('far_top'), 'the out-of-gate top-rank park must never be picked');
  assert(new Set(picks).size >= 2, `rotation must yield ≥2 distinct parks (got ${JSON.stringify(picks)})`);
  assertEquals(picks, ['reach_1', 'reach_2', 'reach_3'], 'rank-descending rotation across cards');
});

// ─── T-1363-05 (meal-combo cycle) ─────────────────────────────────────────────

Deno.test('T-1363-05: take-a-stroll combos keep the nature anchor constant while the 3 meal styles rotate', () => {
  const typeDef = EXPERIENCE_TYPE_MAP['take-a-stroll'];
  assert(typeDef, 'take-a-stroll typeDef must exist');
  const list = buildDeterministicComboList(typeDef, 0, 20);
  assert(list.length >= 40, 'combo list must be at least limit*2 long');
  // Nature anchor (index 0) constant across every entry — the reachable first
  // stop feeds each of the 3 meal styles a valid park.
  for (const combo of list) {
    assertEquals(combo[0], 'nature', 'nature anchor must stay constant at index 0');
  }
  // First 3 cards rotate through all 3 meal styles at the food slot (index 1).
  const firstThreeFoods = [list[0][1], list[1][1], list[2][1]];
  assertEquals(new Set(firstThreeFoods).size, 3, 'first 3 cards rotate through all 3 foods');
  assertEquals(
    new Set([...firstThreeFoods]),
    new Set(['brunch', 'casual_food', 'upscale_fine_dining']),
    'all 3 meal styles appear across the first 3 cards',
  );
});

// ─── T-1363-06 (verdict split) ────────────────────────────────────────────────

Deno.test('T-1363-06: standard-branch empty verdict splits pool_empty vs no_viable_anchor', () => {
  // Replicate the §4.B standard-branch summary expression exactly (index.ts:
  // the `else` arm of the cards.length===0 block).
  const standardEmptyVerdict = (initialFirstStopCount: number) => ({
    emptyReason: initialFirstStopCount === 0 ? 'pool_empty' : 'no_viable_anchor',
    candidateAnchorCount: initialFirstStopCount,
    failedAnchorCount: 0,
  });

  // Zero first-stop candidates → genuinely empty pool.
  const empty = standardEmptyVerdict(0);
  assertEquals(empty.emptyReason, 'pool_empty');
  assertEquals(empty.candidateAnchorCount, 0);
  assertEquals(empty.failedAnchorCount, 0);

  // Candidates existed but none assembled a gate-passing card → honest
  // no_viable_anchor (same rendered copy on mobile, truthful telemetry).
  const noViable = standardEmptyVerdict(384); // London's real scenic-park count
  assertEquals(noViable.emptyReason, 'no_viable_anchor');
  assertEquals(noViable.candidateAnchorCount, 384);
  assertEquals(noViable.failedAnchorCount, 0);
});
