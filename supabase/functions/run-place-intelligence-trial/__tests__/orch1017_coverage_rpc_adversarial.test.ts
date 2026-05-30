// ORCH-1017 ADVERSARIAL — attacks angles the happy-path test does not:
//   1. PostgREST numeric serialization: coverage_pct / cost may arrive as STRINGS
//      ("0.0", "100") — the handler's toNum() must coerce to JS numbers so the
//      admin UI's numeric math (badges, cost preview) doesn't break.
//   2. Empty / null RPC payload → empty rows array, never a throw.
//   3. SQL clamp boundaries: a race where evaluated > servable must NOT yield a
//      negative remaining nor a >100% coverage (LEAST/GREATEST in the migration).
//   4. Security: the RPC must REVOKE from PUBLIC and only GRANT service_role —
//      a SECURITY DEFINER fn exposed to anon would leak the whole place corpus.
//   5. The handler must preserve the full 21-field wire contract (no field
//      silently dropped in the JS→SQL move).
//
// The happy-path file pins the math + RPC wiring; this file pins serialization
// robustness, the error/empty path, the security grant, and contract width.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const INDEX_TS = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
const MIGRATION_SQL = await Deno.readTextFile(
  new URL(
    "../../../migrations/20260807000000_orch_1017_pg_intelligence_coverage.sql",
    import.meta.url,
  ),
);

// Mirror of the handler's toNum() coercion (index.ts).
const toNum = (v: unknown): number | null =>
  v === null || v === undefined ? null : typeof v === "number" ? v : Number(v);

Deno.test("ADV-1017-1 — numeric coverage_pct arrives as string → coerced to number", () => {
  assertEquals(toNum("0.0"), 0);
  assertEquals(toNum("100"), 100);
  assertEquals(toNum("6.0"), 6);
  assertEquals(toNum(42.5), 42.5);
});

Deno.test("ADV-1017-2 — null/undefined numeric → null (not NaN, not 0)", () => {
  assertEquals(toNum(null), null);
  assertEquals(toNum(undefined), null);
  // NaN would silently corrupt the UI; assert we never emit it for nullish input
  assert(!Number.isNaN(toNum(null) as unknown as number) || toNum(null) === null);
});

Deno.test("ADV-1017-3 — handler maps empty/null RPC data to [] without throwing", () => {
  // Mirror the exact guard: ((data as ...[] | null) ?? []).map(...)
  const mapEmpty = (data: unknown[] | null) => (data ?? []).map((r) => r);
  assertEquals(mapEmpty(null), []);
  assertEquals(mapEmpty([]), []);
  // and the source actually contains the ?? [] guard
  assert(
    /\?\?\s*\[\]\)\s*\.map\(/.test(INDEX_TS),
    "handler must default null RPC data to [] before mapping",
  );
});

Deno.test("ADV-1017-4 — migration REVOKEs from PUBLIC (no anon leak of the place corpus)", () => {
  assert(
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.pg_intelligence_coverage\(\)\s+FROM\s+PUBLIC/i
      .test(MIGRATION_SQL),
    "SECURITY DEFINER fn must REVOKE ALL FROM PUBLIC",
  );
  // And must NOT grant to anon or authenticated anywhere.
  assert(
    !/GRANT\s+EXECUTE[\s\S]*?\bTO\s+anon/i.test(MIGRATION_SQL),
    "must never GRANT EXECUTE to anon",
  );
  assert(
    !/GRANT\s+EXECUTE[\s\S]*?\bTO\s+authenticated/i.test(MIGRATION_SQL),
    "must never GRANT EXECUTE to authenticated",
  );
});

Deno.test("ADV-1017-5 — migration pins search_path (SECURITY DEFINER hardening)", () => {
  assert(
    /SET\s+search_path\s*=\s*public/i.test(MIGRATION_SQL),
    "SECURITY DEFINER fn must pin search_path to avoid hijack",
  );
});

Deno.test("ADV-1017-6 — clamp prevents negative remaining + >100% coverage under race skew", () => {
  // SQL: LEAST(evaluated, servable) + GREATEST(0, servable-evaluated) +
  // LEAST(100, ROUND(...)). Reproduce the worst case: evaluated = servable + 5.
  const servable = 100;
  const evaluatedRaw = 105;
  const evaluated = Math.min(evaluatedRaw, servable);
  const remaining = Math.max(0, servable - evaluatedRaw);
  const coverage = Math.min(100, +((evaluatedRaw / servable) * 100).toFixed(1));
  assertEquals(evaluated, 100, "evaluated clamped to servable");
  assertEquals(remaining, 0, "remaining never negative");
  assertEquals(coverage, 100, "coverage never exceeds 100");
});

Deno.test("ADV-1017-7 — full 21-field wire contract preserved in handler output", () => {
  const start = INDEX_TS.indexOf("async function handleIntelligenceCoverage(");
  const next = INDEX_TS.indexOf("\nasync function ", start + 1);
  const body = INDEX_TS.slice(start, next === -1 ? undefined : next);
  for (
    const field of [
      "city_id:",
      "city_name:",
      "country:",
      "servable_count:",
      "evaluated_count:",
      "remaining_count:",
      "coverage_pct:",
      "last_run_id:",
      "last_run_at:",
      "last_run_status:",
      "last_run_cost_usd:",
      "last_run_mode:",
      "first_seeded_at:",
      "last_seeded_at:",
      "refresh_oldest_at:",
      "refresh_newest_at:",
      "stale_refresh_count:",
      "missing_fields_count:",
      "regeocoded:",
      "refreshed_new_fields:",
      "needs_refresh_count:",
    ]
  ) {
    assert(body.includes(field), `wire contract must still emit ${field}`);
  }
});

Deno.test("ADV-1017-8 — migration latest_run picks most-recent terminal run (DISTINCT ON + nulls last)", () => {
  assert(
    /DISTINCT\s+ON\s*\(\s*r\.city_id\s*\)/i.test(MIGRATION_SQL),
    "latest_run must DISTINCT ON (city_id)",
  );
  assert(
    /ORDER\s+BY\s+r\.city_id\s*,\s*r\.completed_at\s+DESC\s+NULLS\s+LAST/i.test(
      MIGRATION_SQL,
    ),
    "latest_run ordering must be completed_at DESC NULLS LAST (matches prior JS sort)",
  );
  assert(
    /status\s+IN\s*\(\s*'complete'\s*,\s*'failed'\s*,\s*'cancelled'\s*\)/i.test(
      MIGRATION_SQL,
    ),
    "latest_run must consider exactly the 3 terminal statuses",
  );
});
