// ORCH-1016 [Consumer Discover Trips tab]
// Implementor happy-path + hard-guard contract test for the global
// pg_published_trips_public RPC (SPEC §10: T-01, T-04, T-05, T-07, T-08).
//
// Run locally:
//   deno test --allow-read supabase/migrations/__tests__/orch_1016_pg_published_trips_public.test.ts
//
// The worktree has no live SQL harness; this test pins the SQL contract that
// would fail if the hard-guard WHERE or the departure filter is reverted.
// fails-on-revert is verified by deleting the relevant SQL line and re-running
// (see the report's Regression Test section for the cited commit hash).

import { assert, assertMatch } from "jsr:@std/assert@1";

const migration = await Deno.readTextFile(
  "supabase/migrations/20260803000001_orch_1016_pg_published_trips_public.sql",
);

function functionBody(sql: string): string {
  const match = sql.match(
    /CREATE OR REPLACE FUNCTION public\.pg_published_trips_public[\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
  );
  assert(match !== null, "pg_published_trips_public function body is present");
  return match[1];
}

const body = functionBody(migration);

// ── HARD GUARDS (I-PROPOSED-PUBLISHED-TRIPS-PUBLIC-HARD-GUARDS) ──
// All six conjuncts MUST be present in the trip_rows WHERE. Removing any one
// fails the matching test (fails-on-revert target — SPEC T-09).

Deno.test("T-09a hard guard: event_type='trip'", () => {
  assertMatch(body, /(?:WHERE|AND)\s+e\.event_type\s*=\s*'trip'/i);
});

Deno.test("T-09b hard guard: visibility='public'", () => {
  assertMatch(body, /AND\s+e\.visibility\s*=\s*'public'/i);
});

Deno.test("T-09c hard guard: status IN ('scheduled','live') — NOT ended/cancelled", () => {
  assertMatch(
    body,
    /AND\s+e\.status\s+IN\s*\(\s*'scheduled'\s*,\s*'live'\s*\)/i,
  );
});

Deno.test("T-09d hard guard: deleted_at IS NULL (event + brand)", () => {
  assertMatch(body, /AND\s+e\.deleted_at\s+IS\s+NULL/i);
  assertMatch(body, /AND\s+b\.deleted_at\s+IS\s+NULL/i);
});

Deno.test("T-09e hard guard: NOT bookings_closed", () => {
  assertMatch(
    body,
    /AND\s+COALESCE\(\s*e\.bookings_closed\s*,\s*false\s*\)\s*=\s*false/i,
  );
});

Deno.test("T-04 / T-09f hard guard: booking_deadline NULL-or-future (NULL = open = surfaced)", () => {
  assertMatch(
    body,
    /AND\s*\(\s*e\.booking_deadline\s+IS\s+NULL\s+OR\s+e\.booking_deadline\s*>=\s*now\(\)\s*\)/i,
  );
});

Deno.test("T-03 / T-09g hard guard: >= 1 published non-hidden pricing tier (EXISTS)", () => {
  assertMatch(body, /AND\s+EXISTS\s*\(/i);
  assertMatch(body, /trip_pricing_tiers\s+tpt2/i);
  assertMatch(body, /COALESCE\(\s*tt2\.is_hidden\s*,\s*false\s*\)\s*=\s*false/i);
});

Deno.test("operator decision #1: show_on_discover is NOT filtered (no predicate)", () => {
  // The protective NOTE comment intentionally names show_on_discover; what MUST
  // NOT exist is a SQL PREDICATE on it (a WHERE/AND comparison). Strip line
  // comments, then assert no `show_on_discover <op>` predicate remains.
  const bodyNoComments = body.replace(/--[^\n]*\n/g, "\n");
  assert(
    !/show_on_discover\s*(=|<>|!=|IS|ILIKE|IN)/i.test(bodyNoComments),
    "show_on_discover MUST NOT be used as a filter predicate (operator decision #1)",
  );
});

// ── DEPARTURE filter SEPARATE from destination (T-05 / T-10) ──

Deno.test("T-05 departure filter is SEPARATE from destination (both ILIKE clauses present)", () => {
  assertMatch(
    body,
    /p_destination_query\s+IS\s+NULL\s+OR\s+\w+\.destination_text\s+ILIKE/i,
  );
  assertMatch(
    body,
    /p_departure_query\s+IS\s+NULL\s+OR\s+\w+\.departure_text\s+ILIKE/i,
  );
});

// ── spots_left mirrors capacity gate (T-08) ──

Deno.test("T-08 spots_left = GREATEST(cap - sold, 0); unlimited → NULL", () => {
  assertMatch(body, /bool_or\(\s*tt\.is_unlimited\s*\)/i);
  assertMatch(
    body,
    /GREATEST\(\s*c\.total_capacity\s*-\s*COALESCE\(\s*s\.tickets_sold\s*,\s*0\s*\)\s*,\s*0\s*\)/i,
  );
  assertMatch(body, /WHEN\s+c\.any_unlimited\s+THEN\s+NULL/i);
});

// ── sold formula mirrors pg_public_trips_by_brand (I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE) ──

Deno.test("T-08b sold = COUNT of tickets in ('valid','used','transferred')", () => {
  assertMatch(
    body,
    /t\.status\s+IN\s*\(\s*'valid'\s*,\s*'used'\s*,\s*'transferred'\s*\)/i,
  );
});

// ── ANON EXECUTE grant (T-07) + SECURITY DEFINER ──

Deno.test("T-07 anon + authenticated GRANT EXECUTE; SECURITY DEFINER", () => {
  assertMatch(migration, /SECURITY\s+DEFINER/i);
  assertMatch(
    migration,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.pg_published_trips_public[\s\S]*?TO\s+anon,\s*authenticated/i,
  );
  assertMatch(
    migration,
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.pg_published_trips_public[\s\S]*?FROM\s+PUBLIC/i,
  );
});

// ── self-verify DO-block present ──

Deno.test("self-verify DO-block asserts definer + anon EXECUTE + smoke call", () => {
  assertMatch(migration, /DO\s+\$verify\$/i);
  assertMatch(migration, /has_function_privilege\(\s*'anon'/i);
  assertMatch(migration, /SELECT\s+count\(\*\)\s+INTO\s+v_smoke\s+FROM\s+public\.pg_published_trips_public\(\)/i);
});

// ── sort modes (SPEC A.3.5) ──

Deno.test("sort supports relevance/oldest/price_asc/price_desc with unknown→relevance fallback", () => {
  assertMatch(body, /'relevance'/);
  assertMatch(body, /'oldest'/);
  assertMatch(body, /'price_asc'/);
  assertMatch(body, /'price_desc'/);
  assertMatch(body, /ELSE\s+'relevance'/i);
});
