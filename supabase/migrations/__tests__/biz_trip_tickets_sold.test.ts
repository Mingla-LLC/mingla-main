// ORCH-0947 [Trip dashboard Spots tile counts tickets, not orders]
// Run:
//   deno test --allow-read supabase/migrations/__tests__/biz_trip_tickets_sold.test.ts
//
// Source-level migration regression for the new RPC. The worktree does not
// currently have a live SQL harness under supabase/migrations/__tests__, so
// this test pins the SQL contract that would fail if the function is reverted
// to order-count semantics.

import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";

const migration = await Deno.readTextFile(
  "supabase/migrations/20260725000001_orch_0947_biz_trip_tickets_sold.sql",
);

function functionBody(sql: string): string {
  const match = sql.match(
    /CREATE OR REPLACE FUNCTION public\.biz_trip_tickets_sold[\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
  );
  assert(match !== null, "biz_trip_tickets_sold function body is present");
  return match[1];
}

const body = functionBody(migration);

Deno.test("T-01 counts valid + used + transferred tickets and excludes cancelled/void/refunded/order-count semantics", () => {
  const statuses = Array.from(
    body.matchAll(/'([a-z_]+)'/g),
    (match) => match[1],
  );

  assert(statuses.includes("valid"));
  assert(statuses.includes("used"));
  assert(statuses.includes("transferred"));
  assert(!statuses.includes("cancelled"));
  assert(!statuses.includes("void"));
  assert(!statuses.includes("refunded"));
  assertMatch(body, /FROM public\.tickets\s+t/i);
  assert(!/FROM public\.orders\b/i.test(body));
  assert(!/payment_status\s+NOT\s+IN/i.test(body));
  assert(!/biz_trip_sold_count_by_tier/i.test(body));
});

Deno.test("T-02 sums across multiple ticket_types for the trip event", () => {
  assertMatch(
    body,
    /JOIN public\.ticket_types\s+tt\s+ON\s+tt\.id\s*=\s*t\.ticket_type_id/i,
  );
  assertMatch(body, /WHERE\s+tt\.event_id\s*=\s*p_event_id/i);
  assert(!/WHERE\s+t\.event_id\s*=\s*p_event_id/i.test(body));
});

Deno.test("T-03 zero tickets returns 0, not null", () => {
  assertMatch(body, /SELECT COUNT\(\*\)::integer\s+INTO v_count/i);
  assertMatch(body, /RETURN COALESCE\(v_count,\s*0\);/i);
  assertEquals(
    migration.includes("RETURNS integer") && migration.includes("STABLE"),
    true,
  );
});
