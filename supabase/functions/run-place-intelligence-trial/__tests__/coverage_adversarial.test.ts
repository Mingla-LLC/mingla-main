// ORCH-1013 ADVERSARIAL — Finding A: handleIntelligenceCoverage coverage math
// edge cases that the implementor's coverage_servable_filter.test.ts misses.
//
// Implementor's tests fixture only Cary (760/761/1), Raleigh (1540/1540/0),
// and one "empty" sentinel. This file probes the corner cases the SPEC §3
// Finding A "edge-case audit" section enumerates:
//
//   - city with 0 servable + 0 evaluated → filtered out (servable_count > 0 filter)
//   - city with N servable + 0 evaluated → 0 evaluated, N remaining, 0% coverage
//   - city where ALL evaluated rows drifted out (post-fix returns 0 evaluated)
//   - Place evaluated multiple times across mode changes → Set-dedupe to 1
//   - The `Math.min(evaluated, servable)` clamp is still in place (defensive)
//   - Race-window: evaluated > servable by 1 row → clamp prevents 100.x% display
//   - coverage_pct toFixed(1) rounds correctly at boundaries
//
// Plus source-inspect for the .filter(r => r.servable_count > 0) drop-row
// guard at L2312, which the implementor's test doesn't cover.

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// Pure mirror of the per-city aggregation at index.ts L2284-L2316 (post-Finding A).
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

// Mirror of the final rows.filter + sort.
function buildRows(
  cities: { id: string; name: string; country: string }[],
  servableRows: { city_id: string }[],
  completedRowsServableOnly: { city_id: string; place_pool_id: string }[],
) {
  return cities
    .map((c) => {
      const agg = aggregateCityCoverage(c.id, servableRows, completedRowsServableOnly);
      return {
        city_id: c.id,
        city_name: c.name,
        country: c.country,
        ...agg,
      };
    })
    .filter((r) => r.servable_count > 0)
    .sort((a, b) => b.servable_count - a.servable_count);
}

Deno.test("ADV-A1 — city with 0 servable + 0 evaluated → dropped from response", () => {
  const cities = [{ id: "empty", name: "Empty City", country: "US" }];
  const rows = buildRows(cities, [], []);
  assertEquals(rows.length, 0, "city with 0 servable must be filtered out");
});

Deno.test("ADV-A2 — city with N servable + 0 evaluated → 0%, N remaining", () => {
  const cities = [{ id: "lagos", name: "Lagos", country: "NG" }];
  const servable = Array.from({ length: 908 }, () => ({ city_id: "lagos" }));
  const rows = buildRows(cities, servable, []);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].servable_count, 908);
  assertEquals(rows[0].evaluated_count, 0);
  assertEquals(rows[0].remaining_count, 908);
  assertEquals(rows[0].coverage_pct, 0);
});

Deno.test("ADV-A3 — extreme drift: ALL evaluated rows drifted (post-fix returns 0 evaluated)", () => {
  // Simulating that the JOIN filtered out 100% of evaluated rows because
  // every previously-evaluated place is now non-servable. Post-fix, the
  // completedRowsServableOnly array is empty.
  const cities = [{ id: "churn", name: "Churn City", country: "US" }];
  const servable = Array.from({ length: 100 }, () => ({ city_id: "churn" }));
  // 0 still-servable evaluated (extreme pool churn scenario)
  const rows = buildRows(cities, servable, []);
  assertEquals(rows[0].evaluated_count, 0);
  assertEquals(rows[0].remaining_count, 100);
  assertEquals(rows[0].coverage_pct, 0);
  assert(rows[0].remaining_count >= 0, "remaining must never be negative");
});

Deno.test("ADV-A4 — same place evaluated multiple times → Set-dedupe to 1", () => {
  // Place evaluated 3x (sample, then full_city, then retry_failed)
  const cities = [{ id: "dup", name: "Dup City", country: "US" }];
  const servable = Array.from({ length: 10 }, () => ({ city_id: "dup" }));
  const completed = [
    { city_id: "dup", place_pool_id: "p1" },
    { city_id: "dup", place_pool_id: "p1" }, // same place, different run
    { city_id: "dup", place_pool_id: "p1" }, // same place, again
    { city_id: "dup", place_pool_id: "p2" },
  ];
  const rows = buildRows(cities, servable, completed);
  assertEquals(rows[0].evaluated_count, 2, "Set must dedupe duplicate evaluation rows");
  assertEquals(rows[0].remaining_count, 8);
});

Deno.test("ADV-A5 — race window: evaluated > servable by 1 → clamp prevents 100.x display", () => {
  // The 4 parallel queries are NOT transactional. If a place's is_servable
  // flips between the servableRes query and the completedRes query, evaluated
  // could exceed servable by 1. The retained Math.min(evaluated, servable)
  // clamp ensures coverage_pct ≤ 100 and remaining ≥ 0.
  const cities = [{ id: "race", name: "Race City", country: "US" }];
  const servable = Array.from({ length: 9 }, () => ({ city_id: "race" })); // 9 servable
  // 10 evaluated (the 10th was servable at query-time-1, now isn't)
  const completed = Array.from({ length: 10 }, (_v, i) => ({
    city_id: "race",
    place_pool_id: `r${i}`,
  }));
  const rows = buildRows(cities, servable, completed);
  assertEquals(rows[0].servable_count, 9);
  assertEquals(
    rows[0].evaluated_count,
    9,
    "Math.min clamp must cap evaluated at servable",
  );
  assertEquals(
    rows[0].remaining_count,
    0,
    "Math.max clamp must prevent negative remaining (9 - 10 = -1 → 0)",
  );
  // coverage_pct uses unclamped evaluated/servable but is itself clamped to 100
  assertEquals(rows[0].coverage_pct, 100, "coverage_pct must be clamped to ≤ 100");
});

Deno.test("ADV-A6 — coverage_pct rounding at boundaries", () => {
  // 99.87% should display as 99.9 (toFixed(1))
  const cities = [{ id: "cary", name: "Cary", country: "US" }];
  const servable = Array.from({ length: 761 }, () => ({ city_id: "cary" }));
  const completed = Array.from({ length: 760 }, (_v, i) => ({
    city_id: "cary",
    place_pool_id: `c${i}`,
  }));
  const rows = buildRows(cities, servable, completed);
  // 760/761 = 0.99868... × 100 = 99.868... → toFixed(1) = 99.9
  assertEquals(rows[0].coverage_pct, 99.9);
});

Deno.test("ADV-A7 — coverage_pct exact 100% with 1540 places", () => {
  const cities = [{ id: "raleigh", name: "Raleigh", country: "US" }];
  const servable = Array.from({ length: 1540 }, () => ({ city_id: "raleigh" }));
  const completed = Array.from({ length: 1540 }, (_v, i) => ({
    city_id: "raleigh",
    place_pool_id: `r${i}`,
  }));
  const rows = buildRows(cities, servable, completed);
  assertStrictEquals(rows[0].coverage_pct, 100);
});

Deno.test("ADV-A8 — rows sorted by servable_count DESC", () => {
  const cities = [
    { id: "small", name: "Small", country: "US" },
    { id: "big", name: "Big", country: "US" },
    { id: "med", name: "Med", country: "US" },
  ];
  const servable = [
    ...Array.from({ length: 100 }, () => ({ city_id: "small" })),
    ...Array.from({ length: 1000 }, () => ({ city_id: "big" })),
    ...Array.from({ length: 500 }, () => ({ city_id: "med" })),
  ];
  const rows = buildRows(cities, servable, []);
  assertEquals(rows.map((r) => r.city_name), ["Big", "Med", "Small"]);
});

// ── Source-inspect (ORCH-1017): the aggregation moved into the
//    pg_intelligence_coverage() migration. The same defensive guards the JS
//    handler carried (drop-empty, clamp, coverage rounding, completed gate)
//    must now exist in SQL form. Each test asserts BOTH that index.ts calls the
//    RPC (so a JS-revert is caught) AND that the migration retains the guard.

const MIGRATION_SQL = await Deno.readTextFile(
  new URL(
    "../../../migrations/20260807000000_orch_1017_pg_intelligence_coverage.sql",
    import.meta.url,
  ),
);
const INDEX_SRC = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

Deno.test("ADV-A9 — RPC call present + migration drops servable_count=0 cities", () => {
  assert(
    INDEX_SRC.includes('db.rpc("pg_intelligence_coverage")'),
    "handler must call the RPC — ORCH-1017",
  );
  assert(
    /WHERE\s+s\.servable_count\s*>\s*0/i.test(MIGRATION_SQL),
    "migration must retain the servable_count > 0 drop guard",
  );
});

Deno.test("ADV-A10 — migration retains LEAST/GREATEST defensive clamp", () => {
  assert(
    /LEAST\s*\(\s*COALESCE\(\s*e\.evaluated_count/i.test(MIGRATION_SQL),
    "evaluated_count must be LEAST(evaluated, servable) — defensive clamp per SPEC §7-D9",
  );
  assert(
    /GREATEST\s*\(\s*0\s*,\s*s\.servable_count\s*-\s*COALESCE\(\s*e\.evaluated_count/i
      .test(MIGRATION_SQL),
    "remaining_count must be GREATEST(0, servable - evaluated) — defensive clamp per SPEC §7-D9",
  );
});

Deno.test("ADV-A11 — migration clamps + rounds coverage_pct (LEAST(100, ROUND(...,1)))", () => {
  assert(
    /LEAST\s*\(\s*100\s*,\s*ROUND\(/i.test(MIGRATION_SQL),
    "coverage_pct must clamp to 100 and round to 1dp in SQL",
  );
  assert(
    /ROUND\([\s\S]*?\*\s*100\s*,\s*1\s*\)/i.test(MIGRATION_SQL),
    "coverage_pct must round (evaluated/servable)*100 to 1 decimal place",
  );
});

Deno.test("ADV-A12 — migration evaluated CTE still gates by status = 'completed'", () => {
  assert(
    /tr\.status\s*=\s*'completed'/i.test(MIGRATION_SQL),
    "evaluated CTE must NOT drop the status='completed' filter",
  );
});

Deno.test("ADV-A13 — Brussels / Lagos / London (cities with servable but 0 evaluated) → 0% remaining=servable", () => {
  // From the live-DB probe: Brussels=1858, Lagos=908, London=3495, all 0 evaluated.
  const cities = [
    { id: "bxl", name: "Brussels", country: "BE" },
    { id: "los", name: "Lagos", country: "NG" },
    { id: "lon", name: "London", country: "GB" },
  ];
  const servable = [
    ...Array.from({ length: 1858 }, () => ({ city_id: "bxl" })),
    ...Array.from({ length: 908 }, () => ({ city_id: "los" })),
    ...Array.from({ length: 3495 }, () => ({ city_id: "lon" })),
  ];
  const rows = buildRows(cities, servable, []);
  assertEquals(rows.length, 3);
  for (const row of rows) {
    assertEquals(row.evaluated_count, 0, `${row.city_name} must be 0 evaluated`);
    assertEquals(row.remaining_count, row.servable_count, `${row.city_name} remaining must equal servable`);
    assertEquals(row.coverage_pct, 0);
  }
});
