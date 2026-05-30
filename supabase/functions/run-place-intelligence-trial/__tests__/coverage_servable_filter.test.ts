// ORCH-1013 Finding A regression test — handleIntelligenceCoverage MUST only
// count `(city_id, place_pool_id)` evaluation pairs where the joined
// place_pool.is_servable = true at query time. The pre-fix bug counted every
// completed trial-run row regardless of pool state, then masked the over-count
// with Math.min(evaluated, servable); the resulting `remaining_count` lied.
//
// Verified live 2026-05-30 against Cary: 6 drifted (re-classified non-servable)
// trial-run rows over-counted the evaluated set; the clamp produced
// evaluated=761/servable=761/remaining=0, masking 1 truly-un-evaluated servable
// place. The fix swaps the completedRes query to use a !inner join on
// place_pool filtered by is_servable=true, restoring evaluated=760/remaining=1.
//
// This file pins both behaviors:
//   1. Pure function reproduction of the JS-side aggregation given the corrected
//      query result shape — asserts evaluated_count and remaining_count match
//      live truth.
//   2. Source-inspect — asserts the edge-fn source contains the !inner+is_servable
//      filter so any future revert of the join (or the .eq filter) is caught.
//
// Together these form a two-key revert detector mirroring the runRemainder
// test pattern in this same directory.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// Pure mirror of the per-city aggregation at index.ts ~L2276-L2300.
// Reads the CORRECTED completedRes shape (only currently-servable places).
function aggregateCityCoverage(
  cityId: string,
  servableRows: { city_id: string }[],
  completedRowsServableOnly: { city_id: string; place_pool_id: string }[],
): {
  servable_count: number;
  evaluated_count: number;
  remaining_count: number;
  coverage_pct: number;
} {
  const servable = servableRows.filter((r) => r.city_id === cityId).length;
  const evaluatedSet = new Set<string>();
  for (const r of completedRowsServableOnly) {
    if (r.city_id === cityId && r.place_pool_id) {
      evaluatedSet.add(r.place_pool_id);
    }
  }
  const evaluated = evaluatedSet.size;
  return {
    servable_count: servable,
    evaluated_count: Math.min(evaluated, servable),
    remaining_count: Math.max(0, servable - evaluated),
    coverage_pct: servable === 0
      ? 0
      : Math.min(100, +((evaluated / servable) * 100).toFixed(1)),
  };
}

Deno.test("Finding A — Cary drift fixture: 760/761 evaluated, 1 remaining", () => {
  // Live Cary truth, 2026-05-30. servable=761, evaluated-and-still-servable=760
  // (6 drift rows are excluded by the fixed query), un-evaluated=1.
  const CITY = "cary";
  const servable = Array.from({ length: 761 }, (_v, i) => ({
    city_id: CITY,
  }));
  // Only the 760 still-servable evaluation rows surface from the fixed query.
  const completedServableOnly = Array.from({ length: 760 }, (_v, i) => ({
    city_id: CITY,
    place_pool_id: `pool-${i}`,
  }));

  const agg = aggregateCityCoverage(CITY, servable, completedServableOnly);
  assertEquals(agg.servable_count, 761);
  assertEquals(agg.evaluated_count, 760);
  assertEquals(agg.remaining_count, 1);
  assertEquals(agg.coverage_pct, 99.9);
});

Deno.test("Finding A — pre-fix bug fixture (drifted rows counted): would FAIL the contract", () => {
  // BEFORE-fix: completed-rows include 6 drifted (non-servable) ids. The pre-fix
  // code dedup'd via Set, producing evaluatedSet.size = 766. Then clamp:
  //   evaluated_count = min(766, 761) = 761
  //   remaining_count = max(0, 761 - 766) = 0
  // This test demonstrates that aggregation against the UNFILTERED completedRes
  // shape returns the WRONG numbers — proving the bug lives in the query, not
  // the aggregation. The fixed query strips the 6 drift rows, restoring truth.
  const CITY = "cary";
  const servable = Array.from({ length: 761 }, () => ({ city_id: CITY }));
  const completedUnfiltered = [
    ...Array.from({ length: 760 }, (_v, i) => ({
      city_id: CITY,
      place_pool_id: `pool-${i}`,
    })),
    // 6 drift rows that the broken query would also include
    ...Array.from({ length: 6 }, (_v, i) => ({
      city_id: CITY,
      place_pool_id: `drift-${i}`,
    })),
  ];
  const agg = aggregateCityCoverage(CITY, servable, completedUnfiltered);
  // Aggregation behaviour is unchanged; the clamp produces the bug shape.
  assertEquals(agg.servable_count, 761);
  assertEquals(agg.evaluated_count, 761); // wrongly clamped from 766
  assertEquals(agg.remaining_count, 0); // wrongly says fully covered
  // Therefore: the fix MUST live in the query (filter drift rows out), not
  // the aggregation. The next test asserts the query has the !inner filter.
});

Deno.test("Finding A — Raleigh genuinely-100% case: 1540/1540/0", () => {
  const CITY = "raleigh";
  const servable = Array.from({ length: 1540 }, () => ({ city_id: CITY }));
  const completedServableOnly = Array.from({ length: 1540 }, (_v, i) => ({
    city_id: CITY,
    place_pool_id: `pool-${i}`,
  }));
  const agg = aggregateCityCoverage(CITY, servable, completedServableOnly);
  assertEquals(agg.servable_count, 1540);
  assertEquals(agg.evaluated_count, 1540);
  assertEquals(agg.remaining_count, 0);
  assertEquals(agg.coverage_pct, 100.0);
});

Deno.test("Finding A — empty city (0 servable, N evaluated) returns 0/0/0", () => {
  const CITY = "empty";
  const agg = aggregateCityCoverage(CITY, [], []);
  assertEquals(agg.servable_count, 0);
  assertEquals(agg.evaluated_count, 0);
  assertEquals(agg.remaining_count, 0);
  assertEquals(agg.coverage_pct, 0);
});

// ── Source-inspect (ORCH-1017): the aggregation moved from JS into the
//    pg_intelligence_coverage() RPC to fix the Edge WORKER_LIMIT / HTTP 546.
//    The two-key revert detector is repointed at the new architecture:
//      key 1 — index.ts calls the RPC (and no longer hand-rolls the JS query);
//      key 2 — the migration's `evaluated` CTE preserves the is_servable join
//              (ORCH-1013 Finding A) so coverage can't re-inflate from drifted
//              rows. A revert to the JS 6-query path fails key 1; dropping the
//              is_servable join in SQL fails key 2.
Deno.test("Finding A — RPC + migration preserve the is_servable evaluated filter", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assert(
    src.includes('db.rpc("pg_intelligence_coverage")'),
    "handleIntelligenceCoverage must call the pg_intelligence_coverage RPC — ORCH-1017",
  );

  const sql = await Deno.readTextFile(
    new URL(
      "../../../migrations/20260807000000_orch_1017_pg_intelligence_coverage.sql",
      import.meta.url,
    ),
  );
  assert(
    /JOIN\s+place_pool\s+pp\s+ON\s+pp\.id\s*=\s*tr\.place_pool_id/i.test(sql),
    "evaluated CTE must JOIN place_pool to gate on servability — ORCH-1013 Finding A regression",
  );
  assert(
    /pp\.is_servable\s*=\s*true/i.test(sql),
    "evaluated CTE must filter pp.is_servable = true — ORCH-1013 Finding A regression",
  );
  assert(
    /COUNT\s*\(\s*DISTINCT\s+tr\.place_pool_id\s*\)/i.test(sql),
    "evaluated CTE must COUNT DISTINCT place_pool_id (dedupe across mode changes) — ORCH-1013 Finding A",
  );
});
