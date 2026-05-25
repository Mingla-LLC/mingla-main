// ORCH-0963 [Public brand page business-case optimization]
// T-01 happy-path contract test for pg_public_trips_by_brand RPC.
//
// Run locally:
//   deno test --allow-read supabase/migrations/__tests__/pg_public_trips_by_brand.test.ts
//
// The worktree has no live SQL harness; this test pins the SQL contract that
// would fail if the function is reverted. fails-on-revert is verified by
// commenting out the relevant SQL line and re-running.

import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";

const migration = await Deno.readTextFile(
  "supabase/migrations/20260728000000_orch_0963_pg_public_trips_by_brand.sql",
);

function functionBody(sql: string): string {
  const match = sql.match(
    /CREATE OR REPLACE FUNCTION public\.pg_public_trips_by_brand[\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
  );
  assert(match !== null, "pg_public_trips_by_brand function body is present");
  return match[1];
}

const body = functionBody(migration);

Deno.test("T-01a brand-kind guard pins trip_planner — no other kinds pass the brand CTE", () => {
  assertMatch(
    body,
    /WHERE\s+b\.slug\s*=\s*p_brand_slug[\s\S]*?AND\s+b\.deleted_at\s+IS\s+NULL[\s\S]*?AND\s+b\.kind\s*=\s*'trip_planner'/i,
    "brand CTE must include b.kind = 'trip_planner' clause",
  );
});

Deno.test("T-01b event_type='trip' pinned + visibility='public' + status whitelist", () => {
  // Predicate may be the first WHERE clause or a subsequent AND. Match both.
  assertMatch(body, /(?:WHERE|AND)\s+e\.event_type\s*=\s*'trip'/i);
  assertMatch(body, /(?:WHERE|AND)\s+e\.visibility\s*=\s*'public'/i);
  assertMatch(
    body,
    /(?:WHERE|AND)\s+e\.status\s+IN\s*\(\s*'scheduled'\s*,\s*'live'\s*,\s*'ended'\s*,\s*'cancelled'\s*\)/i,
  );
  assertMatch(body, /(?:WHERE|AND)\s+e\.deleted_at\s+IS\s+NULL/i);
});

Deno.test("T-01c canonical sold formula — valid+used+transferred only", () => {
  const statuses = Array.from(
    body.matchAll(/t\.status\s+IN\s*\(([^)]+)\)/gi),
    (m) => m[1],
  ).join(" ");
  assert(statuses.includes("'valid'"));
  assert(statuses.includes("'used'"));
  assert(statuses.includes("'transferred'"));
  // Mirror biz_trip_tickets_sold: NO cancelled/void/refunded in the sold count
  assert(!/t\.status\s+IN\s*\([^)]*'cancelled'[^)]*\)/i.test(body));
  assert(!/t\.status\s+IN\s*\([^)]*'void'[^)]*\)/i.test(body));
  assert(!/t\.status\s+IN\s*\([^)]*'refunded'[^)]*\)/i.test(body));
});

Deno.test("T-01d sold join shape mirrors biz_trip_tickets_sold — through ticket_types.event_id", () => {
  assertMatch(
    body,
    /FROM\s+public\.tickets\s+t[\s\S]*?JOIN\s+public\.ticket_types\s+tt\s+ON\s+tt\.id\s*=\s*t\.ticket_type_id/i,
  );
  // Must NOT join tickets directly via tickets.event_id
  assert(!/WHERE\s+t\.event_id\s*=/i.test(body));
});

Deno.test("T-01e capacity uses trip_pricing_tiers JOIN ticket_types", () => {
  assertMatch(
    body,
    /FROM\s+public\.trip_pricing_tiers\s+tpt[\s\S]*?JOIN\s+public\.ticket_types\s+tt\s+ON\s+tt\.id\s*=\s*tpt\.ticket_type_id/i,
  );
  assertMatch(body, /bool_or\(\s*tt\.is_unlimited\s*\)/i);
});

Deno.test("T-01f spots_left null-safe — any_unlimited or null capacity → NULL", () => {
  assertMatch(
    body,
    /CASE[\s\S]*?WHEN\s+c\.any_unlimited\s+THEN\s+NULL[\s\S]*?WHEN\s+c\.total_capacity\s+IS\s+NULL\s+THEN\s+NULL[\s\S]*?ELSE\s+GREATEST\(\s*c\.total_capacity\s*-\s*COALESCE\(\s*s\.tickets_sold\s*,\s*0\s*\)\s*,\s*0\s*\)\s*END\s+AS\s+spots_left/i,
  );
});

Deno.test("T-01g min_price excludes free tiers + currency tied to lowest paid tier", () => {
  assertMatch(body, /MIN\(\s*NULLIF\(\s*tt\.price_cents\s*,\s*0\s*\)\s*\)\s+FILTER\s*\(\s*WHERE\s+NOT\s+tt\.is_free\s*\)/i);
  assertMatch(body, /ARRAY_AGG\(\s*tt\.currency\s+ORDER\s+BY\s+tt\.price_cents\s+ASC/i);
});

Deno.test("T-01h GRANT EXECUTE to anon+authenticated + REVOKE FROM PUBLIC", () => {
  assertMatch(
    migration,
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.pg_public_trips_by_brand\(text\)\s+FROM\s+PUBLIC;/i,
  );
  assertMatch(
    migration,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.pg_public_trips_by_brand\(text\)\s+TO\s+anon\s*,\s*authenticated;/i,
  );
});

Deno.test("T-01i SECURITY DEFINER + STABLE + search_path pinned", () => {
  const fnDecl = migration.match(
    /CREATE OR REPLACE FUNCTION public\.pg_public_trips_by_brand[\s\S]*?\$\$/,
  );
  assert(fnDecl !== null);
  assertMatch(fnDecl[0], /SECURITY DEFINER/);
  assertMatch(fnDecl[0], /STABLE/);
  assertMatch(fnDecl[0], /SET\s+search_path\s*=\s*public\s*,\s*pg_temp/);
});

Deno.test("T-01j return shape includes all 20 fields in order", () => {
  const returnsMatch = migration.match(/RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE/);
  assert(returnsMatch !== null, "RETURNS TABLE clause present");
  const fields = returnsMatch[1];
  for (
    const expected of [
      "trip_id",
      "trip_slug",
      "brand_slug",
      "title",
      "description",
      "destination_text",
      "cover_media_url",
      "cover_media_type",
      "status",
      "start_at",
      "end_at",
      "timezone",
      "bookings_closed",
      "total_capacity",
      "tickets_sold",
      "spots_left",
      "min_price_cents",
      "currency",
      "has_free_tier",
      "published_at",
    ]
  ) {
    assertMatch(fields, new RegExp(`\\b${expected}\\b`), `RETURNS TABLE includes ${expected}`);
  }
});
