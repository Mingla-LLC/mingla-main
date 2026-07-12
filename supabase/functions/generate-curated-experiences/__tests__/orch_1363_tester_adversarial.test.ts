// ORCH-1363 — TESTER adversarial regression tests (mingla-tester).
//
// DIFFERENT ANGLE from the implementor's orch_1363_reachable_first_stop.test.ts.
// The implementor modeled the real-London scenario (Queen Mary's out-of-gate,
// St James's in-gate), rotation, and the verdict-split expression. This file
// instead attacks the EXACT GATE BOUNDARY and the NO-FABRICATION / honesty
// contract of `pickReachableFirstStop` — the precise seam where an off-by-one
// would either fabricate an out-of-gate card or wrongly starve an in-gate park.
//
// Why the boundary matters: the helper's reachability test
//   estimateTravelMinutes(haversineKm(user,p), mode) <= travelConstraintValue*1.5
// MUST be the exact complement of the post-assembly reject
//   firstStop.travelTimeFromUserMin > travelConstraintValue*1.5   (index.ts)
// Both read the SAME rounded estimateTravelMinutes. A park at EXACTLY 45 min
// (30*1.5) must be REACHABLE (post-gate keeps `45 > 45 == false`); a park at
// 46 min must be excluded. If the helper ever drifted to `<` or an unrounded
// compare, a 45-min park would be dropped (starvation) or a 46-min park could
// slip into a fabricated card. This pins that seam.
//
// The module's serve() is `import.meta.main`-guarded, so importing starts no
// server and needs no DB (pure-helper unit tests).
//
// Run: cd supabase && deno test --allow-read --allow-env \
//   functions/generate-curated-experiences/__tests__/orch_1363_tester_adversarial.test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { pickReachableFirstStop } from '../index.ts';
import { haversineKm, estimateTravelMinutes } from '../../_shared/distanceMath.ts';

const LON_LAT = 51.5072178;
const LON_LNG = -0.1275862;
const CONSTRAINT = 30;
const GATE_MIN = CONSTRAINT * 1.5; // 45

// The exact per-place minutes the assembler (buildCardStop) and the post-gate
// compute — same function, same rounding.
const walkMin = (lat: number, lng: number) =>
  estimateTravelMinutes(haversineKm(LON_LAT, LON_LNG, lat, lng), 'walking');

// North-offset park (lng constant). haversine north ≈ 111.19 km/deg, so the
// walking minutes scale with the latitude offset. rankScore is DESCENDING in
// declaration order (available[0] = highest rank), matching the RPC contract.
const parkAt = (id: string, latOffsetDeg: number, rankScore: number) => ({
  google_place_id: id,
  lat: LON_LAT + latOffsetDeg,
  lng: LON_LNG,
  _rankScore: rankScore,
});

// ─── ADV-A (fails-on-revert): gate boundary precision ─────────────────────────
// available[0] is the top-ranked park but sits 46 min out (just past the gate);
// a 45-min boundary park and a 20-min park are lower-ranked but reachable. The
// fix MUST return the 45-min boundary park (top-ranked REACHABLE). Reverting the
// helper to a bare `available[0]` returns the 46-min out-of-gate park → FAIL.
Deno.test('ADV-A (fails-on-revert): boundary — 45-min park is reachable, 46-min available[0] is skipped', () => {
  const over      = parkAt('over_46min',      0.023923, 100); // ~46 min → OUT (46 > 45)
  const boundary  = parkAt('boundary_45min',  0.023383, 90);  // ~45 min → IN  (45 <= 45)
  const inner     = parkAt('inner_20min',     0.010200, 80);  // ~20 min → IN
  const available = [over, boundary, inner];

  // Self-validating fixtures: prove the scenario really straddles the gate.
  assertEquals(walkMin(over.lat, over.lng), 46, 'available[0] must compute to exactly 46 min (out of gate)');
  assertEquals(walkMin(boundary.lat, boundary.lng), 45, 'boundary park must compute to exactly 45 min (the gate)');
  assert(walkMin(over.lat, over.lng) > GATE_MIN, 'over park must be OUT of gate');
  assert(walkMin(boundary.lat, boundary.lng) <= GATE_MIN, 'boundary park must be IN gate (45 <= 45)');

  const pick = pickReachableFirstStop(available, LON_LAT, LON_LNG, 'walking', CONSTRAINT);

  // Fix: top-ranked REACHABLE = the 45-min boundary park. Revert → 46-min over.
  assertEquals(pick?.google_place_id, 'boundary_45min',
    'must return the 45-min boundary park (top-ranked reachable), NOT the 46-min available[0]');
  assert(pick?.google_place_id !== 'over_46min', 'the 46-min out-of-gate top park must NOT be picked');
  // The chosen pick is guaranteed to survive the post-assembly gate (`> 45` == false).
  assert(!(walkMin(pick!.lat, pick!.lng) > GATE_MIN),
    'the pick must pass the identical post-assembly gate condition (travelMin > 45 must be false)');
});

// ─── ADV-B: no fabrication / honesty — all-out-of-gate never yields an in-gate lie ─
// Every candidate is strictly out-of-gate. The helper falls through to
// available[0], but that pick is ITSELF out-of-gate — the helper never
// manufactures a phantom in-gate pick. The post-assembly gate then rejects it,
// so the deck empties HONESTLY (no fabricated card). Holds fixed AND reverted;
// this pins the honesty invariant independent of the selection change.
Deno.test('ADV-B: all candidates out-of-gate → fall-through pick is itself out-of-gate (no fabricated in-gate stop)', () => {
  const a = parkAt('far_46', 0.023923, 100); // ~46 min
  const b = parkAt('far_58', 0.030000, 90);  // ~58 min
  const c = parkAt('far_77', 0.040000, 80);  // ~77 min
  const available = [a, b, c];
  for (const p of available) {
    assert(walkMin(p.lat, p.lng) > GATE_MIN, `${p.google_place_id} must be out-of-gate for this case`);
  }
  const pick = pickReachableFirstStop(available, LON_LAT, LON_LNG, 'walking', CONSTRAINT);
  assertEquals(pick?.google_place_id, 'far_46', 'fall-through returns available[0]');
  // The load-bearing honesty assertion: the returned pick is NOT secretly in-gate.
  assert(walkMin(pick!.lat, pick!.lng) > GATE_MIN,
    'the fall-through pick must remain out-of-gate so the post-assembly gate rejects it → honest empty, never a fabricated card');
});

// ─── ADV-C: driving-mode boundary — same list, mode widens reachability ───────
// The SAME geographic list that is all-out-of-gate on foot becomes reachable by
// car (the mode is a parameter, not a constant). Proves the helper honors
// travelMode: available[0] is returned because it is now in-gate for driving —
// the exact "driving builds a deck where walking cannot" contract (SC-5).
Deno.test('ADV-C: travelMode widens the gate — an on-foot-unreachable list is reachable by driving', () => {
  const a = parkAt('p_a', 0.023923, 100); // walking ~46 (out), driving ~4 (in)
  const b = parkAt('p_b', 0.030000, 90);
  const available = [a, b];
  assert(walkMin(a.lat, a.lng) > GATE_MIN, 'available[0] must be out-of-gate on foot');
  const driveMin = estimateTravelMinutes(haversineKm(LON_LAT, LON_LNG, a.lat, a.lng), 'driving');
  assert(driveMin <= GATE_MIN, 'available[0] must be in-gate by car');
  const pick = pickReachableFirstStop(available, LON_LAT, LON_LNG, 'driving', CONSTRAINT);
  assertEquals(pick?.google_place_id, 'p_a', 'driving: top-ranked available[0] is reachable → returned');
});
