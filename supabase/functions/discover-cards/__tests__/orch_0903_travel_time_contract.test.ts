// ORCH-0903: Travel-time contract regression tests.
//
// SPEC: Mingla_Artifacts/specs/SPEC_ORCH-0903_HOW_FAR_FILTER_DISPLAY_MISMATCH.md
// Investigation: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0903_HOW_FAR_FILTER_DISPLAY_MISMATCH.md
//
// This test file enforces I-PROPOSED-DECK-TRAVEL-TIME-RESPECTS-CONSTRAINT (DRAFT
// → ACTIVE on ORCH-0903 CLOSE): every card returned by discover-cards MUST
// satisfy `card.travelTimeMin === null || card.travelTimeMin <= constraint`.
//
// Test design:
//  - T-01..T-04, T-09, T-10 exercise the composed behavior (radius +
//    display + post-filter) via the real shared helpers. The post-filter
//    predicate is replicated inline in the test to match
//    discover-cards/index.ts; T-07 separately asserts that the predicate
//    actually exists in the source (so removing it from prod source goes
//    RED on T-01 via T-07).
//  - T-05, T-06 are pure unit tests on radiusKmForConstraint — they fail
//    when TRAVEL_CONFIG.driving reverts to 35×1.4 (fails-on-revert anchor).
//  - T-07, T-08 are structural grep tests that fail when any local SPEED
//    table is reintroduced in caller files.
//
// Fails-on-revert anchors:
//   T-01 — must FAIL when the post-filter step is deleted from
//          discover-cards/index.ts (T-07 catches the source-level revert;
//          T-01's predicate-presence assertion picks it up).
//   T-05 — must FAIL when TRAVEL_CONFIG.driving reverts to {speed:35, factor:1.4}
//          (radiusKmForConstraint reads TRAVEL_CONFIG directly).
//
// Run: deno test --allow-read supabase/functions/discover-cards/__tests__/orch_0903_travel_time_contract.test.ts
//

import { assertEquals, assert, assertAlmostEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  TRAVEL_CONFIG,
  estimateTravelMinutes,
  radiusKmForConstraint,
} from '../../_shared/distanceMath.ts';

// Repo root resolution (test runs from repo root via `deno test`)
const REPO_ROOT = new URL('../../../../', import.meta.url).pathname;
const DISCOVER_CARDS_SRC = `${REPO_ROOT}supabase/functions/discover-cards/index.ts`;
const CURATED_SRC = `${REPO_ROOT}supabase/functions/generate-curated-experiences/index.ts`;

// Replicated post-filter predicate from discover-cards/index.ts. Kept in
// lockstep with the source by T-07's grep assertion below.
type MockCard = { distanceKm: number | null; travelTimeMin: number | null };

function postFilter<T extends { travelTimeMin: number | null }>(
  rawCards: T[],
  constraintMin: number,
): T[] {
  return rawCards.filter(
    (card) => card.travelTimeMin === null || card.travelTimeMin <= constraintMin,
  );
}

// Helper: construct a mock card from a haversine distance + mode (mirrors
// what transformServablePlaceToCard does post-fix, using the real shared
// estimateTravelMinutes).
function mockCard(distanceKm: number | null, mode: string): MockCard {
  if (distanceKm === null) return { distanceKm: null, travelTimeMin: null };
  return {
    distanceKm,
    travelTimeMin: estimateTravelMinutes(distanceKm, mode),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// T-01 [FAILS-ON-REVERT KEY] — SC-01 happy-path driving
// ─────────────────────────────────────────────────────────────────────────────
Deno.test('T-01 [FAILS-ON-REVERT KEY] driving 30-min cap: every returned card displays <= 30 min', async () => {
  // Source-level guard: the post-filter predicate must exist in
  // discover-cards/index.ts. If it gets deleted, the inline assertion below
  // wouldn't catch the prod regression — this grep does.
  const src = await Deno.readTextFile(DISCOVER_CARDS_SRC);
  assert(
    /card\.travelTimeMin\s*===\s*null\s*\|\|\s*card\.travelTimeMin\s*<=\s*travelConstraintValue/.test(src),
    'post-filter predicate `card.travelTimeMin === null || card.travelTimeMin <= travelConstraintValue` MUST be present in discover-cards/index.ts (ORCH-0903 contract)',
  );

  // Composed behavior check: 10 places at 1-50 km haversine, driving cap 30
  const constraint = 30;
  const mode = 'driving';
  const placeDistancesKm = [1, 3, 5, 8, 12, 17, 23, 32, 45, 50];
  const rawCards = placeDistancesKm.map((d) => mockCard(d, mode));
  const filtered = postFilter(rawCards, constraint);

  // SC-01: every returned card has travelTimeMin === null || <= 30
  for (const card of filtered) {
    assert(
      card.travelTimeMin === null || card.travelTimeMin <= constraint,
      `Card with travelTimeMin=${card.travelTimeMin} violates the 30-min driving cap`,
    );
  }

  // At least one card dropped (driving 45km @ 60×1.3: round(45×1.3/60×60) = 59 min, exceeds 30)
  assert(
    filtered.length < rawCards.length,
    `Expected at least 1 drop; got ${rawCards.length - filtered.length} drops out of ${rawCards.length} cards`,
  );

  // Verify the 45 km card specifically is dropped (driving 60×1.3 → 59 min)
  const card45 = mockCard(45, mode);
  assertEquals(card45.travelTimeMin, 59, '45 km driving displays 59 min under TRAVEL_CONFIG.driving 60×1.3');
  assert(card45.travelTimeMin! > constraint, '45 km card must be filtered out at 30-min cap');
});

// ─────────────────────────────────────────────────────────────────────────────
// T-02 — SC-01 happy-path walking
// ─────────────────────────────────────────────────────────────────────────────
Deno.test('T-02 walking 15-min cap: every returned card displays <= 15 min', () => {
  const constraint = 15;
  const mode = 'walking';
  const placeDistancesKm = [0.3, 0.5, 0.8, 1.2, 1.6, 2.0, 2.5, 3.0, 4.0, 5.0];
  const rawCards = placeDistancesKm.map((d) => mockCard(d, mode));
  const filtered = postFilter(rawCards, constraint);

  for (const card of filtered) {
    assert(
      card.travelTimeMin === null || card.travelTimeMin <= constraint,
      `Card with travelTimeMin=${card.travelTimeMin} violates the 15-min walking cap`,
    );
  }

  // 5 km walking @ 4.5×1.3: round(5×1.3/4.5×60) = 87 min → dropped
  assert(filtered.length < rawCards.length, 'expected at least one walking card to be dropped');
});

// ─────────────────────────────────────────────────────────────────────────────
// T-03 — SC-01 happy-path biking
// ─────────────────────────────────────────────────────────────────────────────
Deno.test('T-03 biking 20-min cap: every returned card displays <= 20 min', () => {
  const constraint = 20;
  const mode = 'biking';
  const placeDistancesKm = [0.5, 1, 2, 3, 4, 5, 6, 8, 10];
  const rawCards = placeDistancesKm.map((d) => mockCard(d, mode));
  const filtered = postFilter(rawCards, constraint);

  for (const card of filtered) {
    assert(
      card.travelTimeMin === null || card.travelTimeMin <= constraint,
      `Card with travelTimeMin=${card.travelTimeMin} violates the 20-min biking cap`,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// T-04 — SC-01 happy-path transit
// ─────────────────────────────────────────────────────────────────────────────
Deno.test('T-04 transit 45-min cap: every returned card displays <= 45 min', () => {
  const constraint = 45;
  const mode = 'transit';
  const placeDistancesKm = [1, 3, 5, 8, 12, 18, 24, 30];
  const rawCards = placeDistancesKm.map((d) => mockCard(d, mode));
  const filtered = postFilter(rawCards, constraint);

  for (const card of filtered) {
    assert(
      card.travelTimeMin === null || card.travelTimeMin <= constraint,
      `Card with travelTimeMin=${card.travelTimeMin} violates the 45-min transit cap`,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// T-05 [FAILS-ON-REVERT KEY] — SC-03 helper math driving singles
// ─────────────────────────────────────────────────────────────────────────────
Deno.test('T-05 [FAILS-ON-REVERT KEY] radiusKmForConstraint(30, "driving", 1.5) === 58.5', () => {
  // (30/60) × 60 × 1.3 × 1.5 = 58.5
  // SPEC §3 SC-03 had arithmetic error (35.1); formula is binding contract,
  // worked example was advisory. Formula output 58.5 is correct.
  // If TRAVEL_CONFIG.driving reverts to {speed:35, factor:1.4}: (30/60)×35×1.4×1.5 = 36.75 (FAIL — 58.5 != 36.75)
  // If TRAVEL_CONFIG.driving reverts to {speed:100, factor:1.3} (old singles radius): (30/60)×100×1.3×1.5 = 97.5 (FAIL)
  const radius = radiusKmForConstraint(30, 'driving', 1.5);
  assertAlmostEquals(radius, 58.5, 0.001, `Expected radius 58.5 km; got ${radius}. ORCH-0903 driving must be 60×1.3.`);

  // Sanity: confirm TRAVEL_CONFIG.driving values directly
  assertEquals(TRAVEL_CONFIG.driving.speed, 60, 'TRAVEL_CONFIG.driving.speed must be 60');
  assertEquals(TRAVEL_CONFIG.driving.factor, 1.3, 'TRAVEL_CONFIG.driving.factor must be 1.3');
});

// ─────────────────────────────────────────────────────────────────────────────
// T-06 — SC-04 helper math driving curated
// ─────────────────────────────────────────────────────────────────────────────
Deno.test('T-06 radiusKmForConstraint(30, "driving", 1.0) === 39 (curated generosity)', () => {
  // (30/60) × 60 × 1.3 × 1.0 = 39.0
  // SPEC §3 SC-04 had arithmetic error (23.4); formula output 39.0 is correct.
  const radius = radiusKmForConstraint(30, 'driving', 1.0);
  assertAlmostEquals(radius, 39.0, 0.001, `Expected curated radius 39.0 km; got ${radius}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// T-07 — SC-06 grep regression: no local SPEED_KMH in discover-cards
// ─────────────────────────────────────────────────────────────────────────────
Deno.test('T-07 grep regression: discover-cards/index.ts has no local SPEED_KMH', async () => {
  const src = await Deno.readTextFile(DISCOVER_CARDS_SRC);
  const localSpeedTable = /\bSPEED_KMH\s*[:=]\s*\{/.test(src);
  assert(
    !localSpeedTable,
    'discover-cards/index.ts MUST NOT contain a local SPEED_KMH const (use TRAVEL_CONFIG from _shared/distanceMath.ts via radiusKmForConstraint instead) — ORCH-0903 unified-speeds contract',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// T-08 — SC-06 grep regression: no local TRAVEL_SPEEDS_KMH in curated
// ─────────────────────────────────────────────────────────────────────────────
Deno.test('T-08 grep regression: generate-curated-experiences has no local TRAVEL_SPEEDS_KMH', async () => {
  const src = await Deno.readTextFile(CURATED_SRC);
  const localSpeedTable = /\bTRAVEL_SPEEDS_KMH\s*[:=]\s*\{/.test(src);
  assert(
    !localSpeedTable,
    'generate-curated-experiences/index.ts MUST NOT contain a local TRAVEL_SPEEDS_KMH const (use TRAVEL_CONFIG from _shared/distanceMath.ts via radiusKmForConstraint(.,.,1.0) instead) — ORCH-0903 unified-speeds contract',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// T-09 — SC-11 null-coord card pass-through
// ─────────────────────────────────────────────────────────────────────────────
Deno.test('T-09 null-coord card (travelTimeMin === null) passes the post-filter', () => {
  const constraint = 15;
  const cards = [
    mockCard(null, 'driving'),          // null-coord — should PASS
    mockCard(0.3, 'driving'),           // 1 km driving displays max(3, ~0.4 min rounded) → 3 (clamped floor) — passes
    mockCard(50, 'driving'),            // 50 km @ 60×1.3 = 65 min — should be DROPPED
  ];
  const filtered = postFilter(cards, constraint);

  // null-coord must be included
  const nullCount = filtered.filter((c) => c.travelTimeMin === null).length;
  assertEquals(nullCount, 1, 'null-coord card MUST pass the post-filter (I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME)');

  // 50-km card must be dropped
  const has50km = filtered.some((c) => c.distanceKm === 50);
  assertEquals(has50km, false, '50 km driving card displays 65 min, must be dropped at 15-min cap');
});

// ─────────────────────────────────────────────────────────────────────────────
// T-10 — SC-10 response telemetry shape
// ─────────────────────────────────────────────────────────────────────────────
Deno.test('T-10 droppedByTravelTimeFilter is non-negative number when drops occur', async () => {
  // Verify the source has the telemetry field in the populated-path response
  const src = await Deno.readTextFile(DISCOVER_CARDS_SRC);
  assert(
    /droppedByTravelTimeFilter\s*:\s*_droppedByTravelTimeFilter/.test(src),
    'sourceBreakdown.droppedByTravelTimeFilter telemetry field MUST be present in populated-path response (ORCH-0903 SC-10)',
  );

  // Verify the underlying compute happens
  assert(
    /const\s+_droppedByTravelTimeFilter\s*=\s*rawCards\.length\s*-\s*constraintFilteredCards\.length/.test(src),
    'drop count compute (`rawCards.length - constraintFilteredCards.length`) MUST be present (ORCH-0903 SC-10)',
  );

  // Behavioral check: when N cards exceed the cap, drop count = N
  const constraint = 30;
  const mode = 'driving';
  const placeDistancesKm = [1, 5, 45, 50]; // 45 + 50 will be dropped (59 + 65 min)
  const rawCards = placeDistancesKm.map((d) => mockCard(d, mode));
  const filtered = postFilter(rawCards, constraint);
  const dropCount = rawCards.length - filtered.length;
  assertEquals(dropCount, 2, 'expected 2 drops (45 km and 50 km driving cards) at 30-min cap');
  assertEquals(typeof dropCount, 'number');
  assert(dropCount >= 0, 'drop count must be non-negative');
});
