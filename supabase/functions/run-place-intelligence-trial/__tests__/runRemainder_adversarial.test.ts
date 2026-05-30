// ORCH-1008 adversarial tests — runRemainder + handleIntelligenceCoverage
// edge fn semantics under hostile inputs.
//
// Attack angles:
//   - city with ZERO servable places → returns "No servable places in city"
//     (existing 400 from line 1036), NOT "no_remainder" — predicate ordering
//     matters for SPEC §4 Phase 3b acceptance.
//   - duplicate completed rows for same place_pool_id (race, double-write)
//     must collapse to ONE excluded place in remainder set
//   - cross-city completed leak: row with same place_pool_id but different
//     city_id MUST NOT exclude the place from a different city's remainder
//   - intelligence_coverage clamps coverage_pct ≤ 100% even when stale
//     matview gives evaluated > servable
//   - intelligence_coverage filters out cities with zero servable (no
//     phantom rows surfaced to the operator)
//
// Fails-on-revert verified at: 72f164536 (remainder branch didn't exist;
// intelligence_coverage handler didn't exist).

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Inline mirror of edge fn lines 1052-1062 — the remainder filter.
function computeSampledIdsForRemainder(
  servable: { id: string }[],
  completedRows: { place_pool_id: string; city_id?: string }[],
  cityIdFilter?: string,
): string[] {
  // Edge fn pre-filters completedRows server-side via .eq("city_id", cityId);
  // simulate that here.
  const filtered = cityIdFilter
    ? completedRows.filter((r) => r.city_id === cityIdFilter)
    : completedRows;
  const evaluatedSet = new Set(filtered.map((r) => r.place_pool_id));
  return servable.map((p) => p.id).filter((id) => !evaluatedSet.has(id));
}

// Inline mirror of edge fn lines 2276-2300 — intelligence_coverage join math.
function computeCoverageRow(
  city: { id: string; name: string; country: string | null },
  servableByCity: Map<string, number>,
  evaluatedByCity: Map<string, Set<string>>,
) {
  const servable = servableByCity.get(city.id) || 0;
  const evaluated = (evaluatedByCity.get(city.id) || new Set()).size;
  const coveragePct = servable === 0
    ? 0
    : Math.min(100, +((evaluated / servable) * 100).toFixed(1));
  return {
    city_id: city.id,
    city_name: city.name,
    country: city.country,
    servable_count: servable,
    evaluated_count: Math.min(evaluated, servable),
    remaining_count: Math.max(0, servable - evaluated),
    coverage_pct: coveragePct,
  };
}

Deno.test("remainder: duplicate completed rows for same place_pool_id collapse to 1 exclusion", () => {
  const servable = Array.from({ length: 10 }, (_, i) => ({ id: `p-${i}` }));
  // place p-3 appears 5 times in completedRows (race / replay scenario)
  const completed = [
    { place_pool_id: "p-3" },
    { place_pool_id: "p-3" },
    { place_pool_id: "p-3" },
    { place_pool_id: "p-3" },
    { place_pool_id: "p-3" },
    { place_pool_id: "p-7" },
  ];
  const sampled = computeSampledIdsForRemainder(servable, completed);
  assertEquals(sampled.length, 8, "duplicates must collapse — 10 - 2 unique = 8");
  assert(!sampled.includes("p-3"));
  assert(!sampled.includes("p-7"));
});

Deno.test("remainder: cross-city completed row MUST NOT exclude the same place_pool_id in city B", () => {
  // Simulates the edge fn calling .eq("city_id", cityId) on the completed
  // rows query. If a future refactor removes the city_id filter, this test
  // catches the cross-city leak.
  const cityA = "city-A";
  const cityB = "city-B";
  const servableInB = [
    { id: "shared-place-1" },
    { id: "shared-place-2" },
  ];
  // Both places were completed in city A (rare but possible — same place_pool
  // row was moved between cities or briefly mis-assigned)
  const completed = [
    { place_pool_id: "shared-place-1", city_id: cityA },
    { place_pool_id: "shared-place-2", city_id: cityA },
  ];
  const sampledForB = computeSampledIdsForRemainder(
    servableInB,
    completed,
    cityB,
  );
  assertEquals(
    sampledForB.length,
    2,
    "city B remainder must include BOTH places — cross-city completion in city A is not authoritative",
  );
});

Deno.test("intelligence_coverage: clamps coverage_pct ≤ 100% when evaluated > servable (stale matview)", () => {
  // ATTACK: place_pool drops places to is_servable=false (e.g. retirement),
  // but old completed rows for those place_pool_ids stick around. The
  // evaluatedSet for city X might end up larger than servable_count.
  const cityRow = { id: "c", name: "Stale City", country: "US" };
  const servable = new Map<string, number>([["c", 100]]);
  // 150 distinct completed place_pool_ids — exceeds servable
  const evalSet = new Set(Array.from({ length: 150 }, (_, i) => `p-${i}`));
  const evaluated = new Map<string, Set<string>>([["c", evalSet]]);

  const row = computeCoverageRow(cityRow, servable, evaluated);
  assertEquals(row.coverage_pct, 100, "coverage_pct must clamp to 100");
  assertEquals(row.evaluated_count, 100, "evaluated_count must clamp to servable");
  assertEquals(
    row.remaining_count,
    0,
    "remaining_count must floor at 0 (no negative remainders)",
  );
});

Deno.test("intelligence_coverage: zero-servable city row is downstream-filtered", () => {
  // The handler at edge fn line 2299 does `.filter((r) => r.servable_count > 0)`.
  // This simulator confirms our coverage row builder produces servable=0 for a
  // dry city; the caller must filter, which we assert by re-applying the
  // same filter contract.
  const cityRow = { id: "dry", name: "Dry City", country: "US" };
  const servable = new Map<string, number>(); // no entry → 0
  const evaluated = new Map<string, Set<string>>();

  const row = computeCoverageRow(cityRow, servable, evaluated);
  assertEquals(row.servable_count, 0);
  assertEquals(row.coverage_pct, 0, "zero servable → 0% (not NaN, not divide-by-zero)");

  // Apply the SUT-side filter explicitly
  const rows = [row].filter((r) => r.servable_count > 0);
  assertEquals(rows.length, 0, "zero-servable city must be filtered out of the response");
});

Deno.test("intelligence_coverage: floating-point precision — 11_344 evaluated / 11_345 servable rounds to 1dp", () => {
  // ATTACK: 11344 / 11345 = 0.99991185... — toFixed(1) → '100.0' which would
  // be SURPRISING (operator sees 100% but 1 place is still remaining). The
  // toFixed(1) + Math.min(100, ...) sequence in the handler may not be the
  // tightest UX, but it's consistent. Document the behavior.
  const cityRow = { id: "tight", name: "Tight City", country: "US" };
  const servable = new Map<string, number>([["tight", 11345]]);
  const evalSet = new Set(Array.from({ length: 11344 }, (_, i) => `p-${i}`));
  const evaluated = new Map<string, Set<string>>([["tight", evalSet]]);

  const row = computeCoverageRow(cityRow, servable, evaluated);
  // 11344/11345 * 100 = 99.99118... → toFixed(1) = '100.0' → 100
  assertEquals(row.coverage_pct, 100);
  // remaining_count must still be 1 — that's the truthful counter
  assertEquals(row.remaining_count, 1, "remaining_count must not lie even if coverage_pct rounds to 100");
});

Deno.test("remainder: empty servable pool returns empty remainder (consistent with empty result)", () => {
  // Edge fn returns 400 'No servable places in city' BEFORE the remainder
  // branch runs (line 1036). So this only tests the JS-side filter contract:
  // empty servable → empty sampled.
  const sampled = computeSampledIdsForRemainder([], [{ place_pool_id: "x" }]);
  assertEquals(sampled.length, 0);
});

Deno.test("remainder: very large servable pool (50_000 places) handles in <100ms", () => {
  // Cary already has ~2400; future cities might exceed 50k. The Set-diff
  // approach is O(N+M). Ensure no quadratic blowup snuck in.
  const N = 50_000;
  const M = 12_345;
  const servable = Array.from({ length: N }, (_, i) => ({ id: `place-${i}` }));
  const completed = Array.from({ length: M }, (_, i) => ({
    place_pool_id: `place-${i * 3}`, // sparse
  }));
  const t0 = performance.now();
  const sampled = computeSampledIdsForRemainder(servable, completed);
  const elapsed = performance.now() - t0;
  assert(
    elapsed < 100,
    `Set-diff scaled poorly at 50k places: ${elapsed.toFixed(1)}ms > 100ms`,
  );
  // M places excluded only if their id is in [0..N); count overlap
  const overlap = completed.filter((r) =>
    Number(r.place_pool_id.split("-")[1]) < N
  ).length;
  assertEquals(sampled.length, N - overlap);
});

Deno.test("edge fn source: handleIntelligenceCoverage uses Math.min(100, …) clamp AND Math.max(0, …) floor", () => {
  // Source-inspect for the safety clamps. If a future refactor drops these,
  // the operator could see >100% coverage or negative remainder.
  const source = Deno.readTextFileSync(
    new URL("../index.ts", import.meta.url).pathname,
  );
  assert(
    source.includes("Math.min(100, +((evaluated / servable) * 100).toFixed(1))"),
    "coverage_pct must clamp at 100 via Math.min(100, ...)",
  );
  assert(
    source.includes("Math.max(0, servable - evaluated)"),
    "remaining_count must floor at 0 via Math.max(0, ...)",
  );
  assert(
    source.includes("Math.min(evaluated, servable)"),
    "evaluated_count must clamp at servable via Math.min(evaluated, servable)",
  );
});

Deno.test("edge fn source: intelligence_coverage filters out servable_count === 0 BEFORE response", () => {
  const source = Deno.readTextFileSync(
    new URL("../index.ts", import.meta.url).pathname,
  );
  assert(
    source.includes(".filter((r) => r.servable_count > 0)"),
    "zero-servable cities must be filtered before sending the response",
  );
});

Deno.test("edge fn source: completed rows query for remainder is scoped to city_id (no cross-city leak)", () => {
  const source = Deno.readTextFileSync(
    new URL("../index.ts", import.meta.url).pathname,
  );
  // The query at lines 1053-1057 chains .eq("city_id", cityId).eq("status", "completed").
  // Match a flexible pattern.
  const remainderBlock = source.slice(
    source.indexOf('mode === "remainder"'),
    source.indexOf('mode === "remainder"') + 1500,
  );
  assert(
    remainderBlock.includes('.eq("city_id", cityId)'),
    "remainder mode completed-rows query must filter by city_id (cross-city leak guard)",
  );
  assert(
    remainderBlock.includes('.eq("status", "completed")'),
    "remainder mode completed-rows query must filter by status=completed",
  );
});

Deno.test("edge fn source: remainder mode is gated by the same cost_above_guard contract as full_city", () => {
  const source = Deno.readTextFileSync(
    new URL("../index.ts", import.meta.url).pathname,
  );
  // The guard at lines 1110-1122: both 'full_city' and 'remainder' require
  // confirm_high_cost; only 'sample' is hard-rejected above the guard.
  assert(
    /mode\s*===\s*"full_city"\s*\|\|\s*mode\s*===\s*"remainder"/.test(source),
    "cost guard above $5 must check (full_city || remainder), not full_city alone",
  );
  assert(
    source.includes("body.confirm_high_cost !== true"),
    "confirm_high_cost must be required for full_city + remainder above $5",
  );
});
