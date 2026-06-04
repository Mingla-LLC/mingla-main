// META-ORCH-1059 [experiences-business-parity] · SUB-A · LAYER 7.1 (happy path)
//
// Run:
//   deno test --allow-read supabase/functions/__tests__/biz_create_experience.happy.test.ts
//
// Source-level migration regression for biz_create_experience. The worktree
// has no live SQL harness (the repo convention — see biz_trip_tickets_sold.test.ts),
// so this test pins the SQL contract that would FAIL if the RPC is reverted to
// the old single-events-insert behaviour (no ticket / no event_dates) or if the
// one-ticket / publish-date logic is broken.
//
// Asserts (SPEC §7.1) for a valid 2-stop, whole-price, single-date PUBLISH:
//   1. EXACTLY ONE ticket_types INSERT (a single insert, not a loop) at the
//      resolved total (whole_price_cents), is_free derived from total==0.
//   2. experience_stops rows written with stop_order + UNIQUE(event_id, stop_order).
//   3. >=1 event_dates row with is_master=true (materialised on PUBLISH only).
//   4. the events row written at status='scheduled' / visibility='public' on publish,
//      carrying location_mode + pricing_mode + whole_price_cents.
//   5. (integration contract) the resolved total flows to the SINGLE ticket the
//      existing checkout engine reads — no parallel money fn (I-1 / COMMS-0014/0016).
//
// fails-on-revert: each assertion targets a distinct shipped construct in the
// migration; reverting the RPC to its prior shape (or breaking publish-date /
// single-ticket logic) flips at least one assertion.

import { assert, assertEquals } from "jsr:@std/assert@1";

const migration = await Deno.readTextFile(
  "supabase/migrations/20260824000000_meta_orch_1059_sub_a_experience_stops.sql",
);

function functionBody(sql: string): string {
  const match = sql.match(
    /CREATE OR REPLACE FUNCTION public\.biz_create_experience[\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
  );
  assert(match !== null, "biz_create_experience function body is present");
  return match![1];
}

const body = functionBody(migration);

Deno.test("H-01 exactly ONE ticket_types INSERT (never N) at the resolved total", () => {
  // There must be exactly one `INSERT INTO public.ticket_types` in the whole RPC.
  const ticketInserts = body.match(/INSERT\s+INTO\s+public\.ticket_types/gi) ?? [];
  assertEquals(
    ticketInserts.length,
    1,
    "biz_create_experience must INSERT exactly one ticket_types row (I-1 one-ticket)",
  );
  // The ticket insert is NOT inside a FOR/LOOP over stops (that would mint N tickets).
  // Confirm there is no `FOR ... ticket_types` loop construct.
  assert(
    !/FOR[\s\S]{0,120}INSERT\s+INTO\s+public\.ticket_types/i.test(body),
    "the single ticket insert must not be inside a per-stop loop",
  );
  // The price written is the resolved total, not a per-stop price.
  assert(
    /price_cents[\s\S]*?VALUES[\s\S]*?v_resolved_total/i.test(body) ||
      /v_resolved_total[\s\S]*?\)\s*RETURNING id INTO v_ticket_id/i.test(body),
    "ticket price_cents must be the resolved total",
  );
});

Deno.test("H-02 the resolved total is whole_price in whole mode, summed in per_stop mode", () => {
  assert(
    /v_resolved_total\s*:=[\s\S]*?WHEN v_pricing_mode\s*=\s*'whole'\s*THEN v_whole_price/i.test(body),
    "whole mode resolves to v_whole_price",
  );
  assert(
    /sum\(COALESCE\(\(s->>'price_cents'\)::integer,\s*0\)\)/i.test(body),
    "per_stop mode resolves to the SUM of stop prices",
  );
});

Deno.test("H-03 experience_stops written with stop_order; UNIQUE(event_id, stop_order) enforced", () => {
  assert(
    /INSERT\s+INTO\s+public\.experience_stops/i.test(body),
    "RPC inserts experience_stops rows",
  );
  assert(
    /stop_order/i.test(body),
    "stop rows carry stop_order",
  );
  // The migration declares the UNIQUE constraint.
  assert(
    /CONSTRAINT\s+experience_stops_unique_order\s+UNIQUE\s*\(\s*event_id,\s*stop_order\s*\)/i.test(
      migration,
    ),
    "experience_stops has UNIQUE(event_id, stop_order)",
  );
});

Deno.test("H-04 event_dates materialise on PUBLISH only, with a master row", () => {
  // The event_dates insert(s) live inside the `IF p_publish THEN` block.
  const publishBlock = body.match(/IF p_publish THEN[\s\S]*?event_dates[\s\S]*?END IF;/i);
  assert(publishBlock !== null, "event_dates insert is gated by IF p_publish");
  assert(
    /INSERT\s+INTO\s+public\.event_dates[\s\S]*?is_master/i.test(body),
    "a master event_dates row is written",
  );
  // single/recurring writes is_master=true; multi_date marks the earliest master.
  assert(
    /VALUES\s*\(v_event_id,\s*v_start,\s*v_end,\s*v_timezone,\s*true\)/i.test(body),
    "single/recurring writes is_master=true",
  );
});

Deno.test("H-05 publish writes scheduled/public; draft writes draft/draft with no dates", () => {
  assert(
    /CASE WHEN p_publish THEN 'scheduled' ELSE 'draft' END/i.test(body),
    "status is scheduled on publish, draft otherwise",
  );
  assert(
    /CASE WHEN p_publish THEN 'public' ELSE 'draft' END/i.test(body),
    "visibility is public on publish, draft otherwise",
  );
  assert(
    /CASE WHEN p_publish THEN v_now ELSE NULL END/i.test(body),
    "published_at set on publish only",
  );
  // The events row carries the new experience columns.
  assert(
    /location_mode,\s*pricing_mode,\s*whole_price_cents/i.test(body),
    "events row writes location_mode + pricing_mode + whole_price_cents",
  );
});

Deno.test("H-06 currency defaults to brand default_currency, never a hardcoded GBP fallback (I-7)", () => {
  // The currency COALESCE resolves to brand.default_currency with a USD (not GBP) fallback.
  assert(
    /v_currency\s*:=\s*upper\(COALESCE\(/i.test(body),
    "currency resolves via COALESCE",
  );
  assert(
    /v_brand\.default_currency::text/i.test(body),
    "currency falls back to brand.default_currency",
  );
  assert(
    /v_brand\.default_currency::text,\s*\n?\s*'USD'\s*\)\s*\)::char\(3\)/i.test(body),
    "the final currency fallback is USD, NOT a hardcoded GBP (I-7)",
  );
  // The whole-mode price column is NULLed in per-stop mode (display-only redundancy).
  assert(
    /CASE WHEN v_pricing_mode\s*=\s*'whole' THEN v_resolved_total ELSE NULL END/i.test(body),
    "whole_price_cents is NULL in per_stop mode",
  );
});

Deno.test("H-07 RPC is SECURITY DEFINER + granted to authenticated only", () => {
  assert(/SECURITY DEFINER/i.test(migration), "RPC is SECURITY DEFINER");
  assert(
    /GRANT EXECUTE ON FUNCTION public\.biz_create_experience\(uuid, jsonb, boolean\) TO authenticated/i.test(
      migration,
    ),
    "execute granted to authenticated",
  );
  // No new Stripe / money fn — the RPC writes only the single sellable ticket the
  // existing checkout engine reads (I-6). Check for actual payment-API tokens in
  // executable SQL (not prose comments): no PaymentIntent / application_fee /
  // stripe.* table touches.
  assert(
    !/payment_intent|application_fee|stripe\./i.test(body),
    "biz_create_experience touches no Stripe/payment surface (I-6)",
  );
});
