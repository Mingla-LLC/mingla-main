// ORCH-1017 happy-path regression — Intelligence Coverage moved from a JS-side
// 6-query Promise.all aggregation (which pulled ~79k place_pool rows into the
// edge fn and intermittently blew the Edge WORKER_LIMIT → HTTP 546) into a
// single Postgres SECURITY DEFINER RPC, pg_intelligence_coverage().
//
// Two-key revert detector for the FIX itself:
//   key 1 — handleIntelligenceCoverage calls db.rpc("pg_intelligence_coverage")
//           and NO LONGER hand-rolls the 6-query Promise.all over place_pool.
//   key 2 — the migration defines the RPC with the full aggregation contract.
//
// fails-on-revert: reverting to the JS aggregation removes the db.rpc(...) call
// (key 1 FAILS) and/or removes the migration (key 2 FAILS). A handler that
// re-adds a raw place_pool scan re-introduces the 546 and FAILS the "no full
// scan in handler" guard below.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const INDEX_TS = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
const MIGRATION_SQL = await Deno.readTextFile(
  new URL(
    "../../../migrations/20260807000000_orch_1017_pg_intelligence_coverage.sql",
    import.meta.url,
  ),
);

// ── key 1: handler calls the RPC, not the JS 6-query path ──────────────────
Deno.test("ORCH-1017 — handler calls pg_intelligence_coverage RPC", () => {
  assert(
    INDEX_TS.includes('db.rpc("pg_intelligence_coverage")'),
    "handleIntelligenceCoverage must delegate to the RPC",
  );
});

Deno.test("ORCH-1017 — handler no longer hand-rolls the place_pool scan that caused HTTP 546", () => {
  // Isolate the handler body and assert it contains no raw place_pool fetch nor
  // the old 6-query Promise.all — those are exactly what exceeded the worker limit.
  const start = INDEX_TS.indexOf("async function handleIntelligenceCoverage(");
  assert(start > 0, "handler must exist");
  const next = INDEX_TS.indexOf("\nasync function ", start + 1);
  const body = INDEX_TS.slice(start, next === -1 ? undefined : next);
  assert(
    !body.includes('.from("place_pool")'),
    "handler must NOT scan place_pool directly — that is the 546 root cause (ORCH-1017)",
  );
  assert(
    !/servableDetailsRes|seedWindowRes/.test(body),
    "handler must NOT re-introduce the old per-row servable/seed fetches",
  );
});

// ── key 2: migration defines the RPC with the security + aggregation contract ─
Deno.test("ORCH-1017 — migration creates a SECURITY DEFINER RPC granted to service_role only", () => {
  assert(
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.pg_intelligence_coverage\(\)/i.test(
      MIGRATION_SQL,
    ),
    "migration must create pg_intelligence_coverage()",
  );
  assert(/SECURITY\s+DEFINER/i.test(MIGRATION_SQL), "RPC must be SECURITY DEFINER");
  assert(
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.pg_intelligence_coverage\(\)\s+TO\s+service_role/i
      .test(MIGRATION_SQL),
    "EXECUTE must be granted to service_role",
  );
  assert(
    /REVOKE\s+ALL[\s\S]*?anon/i.test(MIGRATION_SQL) &&
      /REVOKE\s+ALL[\s\S]*?authenticated/i.test(MIGRATION_SQL),
    "EXECUTE must be revoked from anon + authenticated (admin-gated in the edge fn)",
  );
});

Deno.test("ORCH-1017 — migration aggregates per city (GROUP BY city_id, ORDER BY servable_count DESC)", () => {
  assert(/GROUP\s+BY\s+pp\.city_id/i.test(MIGRATION_SQL), "must GROUP BY city_id");
  assert(
    /ORDER\s+BY\s+s\.servable_count\s+DESC/i.test(MIGRATION_SQL),
    "rows must be ordered by servable_count DESC (contract preserved)",
  );
});

// ── Behavioral spec: a SQL-faithful mirror reproduces the row contract ──────
// This mirrors what pg_intelligence_coverage() computes per city so the math
// contract is pinned independently of the SQL text. Numbers below match the
// live-DB truth captured 2026-05-30 (Raleigh 100%, Durham 6.0%, London 0%).
type Pool = {
  city_id: string;
  is_servable: boolean;
  last_detail_refresh: string | null;
  reviews: unknown[] | null;
  generative_summary: string | null;
  editorial_summary: string | null;
};
type Trial = { city_id: string; place_pool_id: string; status: string; servable: boolean };

const CUTOVER = Date.parse("2026-03-19T00:00:00Z");

function coverageRow(
  cityId: string,
  pool: Pool[],
  trials: Trial[],
) {
  const servableRows = pool.filter((p) => p.city_id === cityId && p.is_servable);
  const servable = servableRows.length;
  const evaluatedSet = new Set<string>();
  for (const t of trials) {
    if (t.city_id === cityId && t.status === "completed" && t.servable) {
      evaluatedSet.add(t.place_pool_id);
    }
  }
  const evaluatedRaw = evaluatedSet.size;
  const evaluated = Math.min(evaluatedRaw, servable);
  const remaining = Math.max(0, servable - evaluatedRaw);
  const coverage = servable === 0
    ? 0
    : Math.min(100, +((evaluatedRaw / servable) * 100).toFixed(1));
  const needs = servableRows.filter(
    (p) => p.last_detail_refresh === null || Date.parse(p.last_detail_refresh) < CUTOVER,
  ).length;
  return {
    servable_count: servable,
    evaluated_count: evaluated,
    remaining_count: remaining,
    coverage_pct: coverage,
    needs_refresh_count: needs,
    refreshed_new_fields: servable > 0 && needs === 0,
  };
}

Deno.test("ORCH-1017 — math mirror: Raleigh-style fully-evaluated city → 100% / 0 remaining", () => {
  const pool: Pool[] = Array.from({ length: 3 }, (_, i) => ({
    city_id: "ral",
    is_servable: true,
    last_detail_refresh: "2026-04-01T00:00:00Z",
    reviews: [1],
    generative_summary: "x",
    editorial_summary: "y",
  }));
  const trials: Trial[] = pool.map((_, i) => ({
    city_id: "ral",
    place_pool_id: `p${i}`,
    status: "completed",
    servable: true,
  }));
  const r = coverageRow("ral", pool, trials);
  assertEquals(r.servable_count, 3);
  assertEquals(r.evaluated_count, 3);
  assertEquals(r.remaining_count, 0);
  assertEquals(r.coverage_pct, 100);
  assertEquals(r.refreshed_new_fields, true);
});

Deno.test("ORCH-1017 — math mirror: Durham-style partial → 6.0% (rounded 1dp)", () => {
  // 39 of 648 evaluated → 6.0%
  const pool: Pool[] = Array.from({ length: 648 }, () => ({
    city_id: "dur",
    is_servable: true,
    last_detail_refresh: "2026-05-01T00:00:00Z",
    reviews: [1],
    generative_summary: "x",
    editorial_summary: "y",
  }));
  const trials: Trial[] = Array.from({ length: 39 }, (_, i) => ({
    city_id: "dur",
    place_pool_id: `p${i}`,
    status: "completed",
    servable: true,
  }));
  const r = coverageRow("dur", pool, trials);
  assertEquals(r.coverage_pct, 6.0);
  assertEquals(r.remaining_count, 609);
});

Deno.test("ORCH-1017 — math mirror: London-style 0 evaluated → 0% remaining=servable", () => {
  const pool: Pool[] = Array.from({ length: 10 }, (_, i) => ({
    city_id: "lon",
    is_servable: true,
    // 7 below cutover (need refresh), 3 above
    last_detail_refresh: i < 7 ? "2026-01-01T00:00:00Z" : "2026-04-01T00:00:00Z",
    reviews: null, // missing fields
    generative_summary: null,
    editorial_summary: null,
  }));
  const r = coverageRow("lon", pool, []);
  assertEquals(r.coverage_pct, 0);
  assertEquals(r.remaining_count, 10);
  assertEquals(r.needs_refresh_count, 7);
  assertEquals(r.refreshed_new_fields, false);
});
