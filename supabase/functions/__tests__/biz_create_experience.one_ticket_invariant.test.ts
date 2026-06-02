// META-ORCH-1059 [experiences-business-parity] · SUB-A · LAYER 7.2 (adversarial)
//
// Run:
//   deno test --allow-read supabase/functions/__tests__/biz_create_experience.one_ticket_invariant.test.ts
//
// DISTINCT from the happy-path test (whole-mode / single-location / single-date /
// min-stops). This adversarial suite pins the ONE-TICKET invariant + the
// publish-gate negatives under the hard cases:
//   - per_stop pricing mode with 5 priced stops → still EXACTLY ONE ticket at the
//     SUM, never 5 (the COMMS-0014/0016 spine, I-1).
//   - per_stop prices are display-only on experience_stops (the sellable price is
//     the single ticket).
//   - multi_date → N event_dates, exactly ONE is_master (the earliest).
//   - publish gate: 2–5 stops enforced ONLY on publish; a stop missing place_id
//     raises stop_address_unvalidated on publish; a draft bypasses both gates.
//
// fails-on-revert: the assertions target the single-insert + sum + publish-gated
// constructs. Reverting to N-ticket inserts, dropping the SUM, removing the
// publish gate, or removing the unvalidated-location guard flips an assertion.

import { assert } from "jsr:@std/assert@1";

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

Deno.test("A-01 ONE ticket even in per_stop mode — single insert, NEVER N (I-1)", () => {
  const ticketInserts = body.match(/INSERT\s+INTO\s+public\.ticket_types/gi) ?? [];
  assert(
    ticketInserts.length === 1,
    `expected exactly 1 ticket_types INSERT, found ${ticketInserts.length} — per-stop mode must NOT mint one ticket per stop`,
  );
  // The stops loop inserts experience_stops, NOT ticket_types.
  const stopsLoop = body.match(
    /FOR v_stop IN SELECT value FROM jsonb_array_elements\(v_stops\)\s*LOOP[\s\S]*?END LOOP;/gi,
  );
  assert(stopsLoop !== null, "there is a per-stop loop");
  for (const loop of stopsLoop!) {
    assert(
      !/INSERT\s+INTO\s+public\.ticket_types/i.test(loop),
      "no ticket_types insert inside a per-stop loop (would mint N tickets)",
    );
  }
});

Deno.test("A-02 per_stop resolved total is the SUM of stop prices; per-stop price_cents is display-only", () => {
  assert(
    /ELSE\s*\(\s*SELECT COALESCE\(sum\(COALESCE\(\(s->>'price_cents'\)::integer,\s*0\)\),\s*0\)/i.test(
      body,
    ),
    "per_stop total is the SUM of stop price_cents",
  );
  // experience_stops carry their own per-stop price (display-only); in whole mode → 0.
  assert(
    /v_s_price\s*:=\s*CASE WHEN v_pricing_mode\s*=\s*'whole' THEN 0\s*ELSE COALESCE\(\(v_stop->>'price_cents'\)::integer,\s*0\)/i.test(
      body,
    ),
    "per-stop price_cents stored on the stop row (0 in whole mode)",
  );
});

Deno.test("A-03 multi_date → N dates, exactly ONE is_master (the earliest)", () => {
  assert(
    /v_min_start/i.test(body),
    "multi_date computes the earliest start (v_min_start)",
  );
  assert(
    /VALUES\s*\(v_event_id,\s*v_start,\s*v_end,\s*v_timezone,\s*v_start = v_min_start\)/i.test(
      body,
    ),
    "is_master is true ONLY for the earliest date (v_start = v_min_start)",
  );
});

Deno.test("A-04 publish gate: 2–5 stops enforced on publish; drafts bypass (<2 allowed)", () => {
  // Publish branch enforces 2..5.
  assert(
    /IF p_publish THEN[\s\S]*?IF v_stop_count\s*<\s*2 OR v_stop_count\s*>\s*5 THEN[\s\S]*?experience_stop_count_invalid/i.test(
      body,
    ),
    "publish enforces 2..5 stops (experience_stop_count_invalid)",
  );
  // Draft branch only caps at 5 (allows <2).
  assert(
    /ELSE\s*IF v_stop_count\s*>\s*5 THEN[\s\S]*?experience_stop_count_invalid/i.test(body),
    "draft allows 0–5 stops (only the >5 cap fires)",
  );
});

Deno.test("A-05 publish gate: unvalidated stop location raises stop_address_unvalidated (publish only)", () => {
  assert(
    /stop_address_unvalidated/i.test(body),
    "the unvalidated-location guard exists",
  );
  // single mode: only stops[0] must be validated.
  assert(
    /IF v_location_mode\s*=\s*'single' THEN[\s\S]*?v_stops->0->>'place_id'[\s\S]*?stop_address_unvalidated/i.test(
      body,
    ),
    "single mode validates stops[0] only",
  );
  // The guard is inside the IF p_publish block (drafts may hold unvalidated picks).
  assert(
    /IF p_publish THEN[\s\S]*?stop_address_unvalidated/i.test(body),
    "the location-validation guard is publish-gated",
  );
});

Deno.test("A-06 single location mode materialises stops[0]'s place onto every stop row", () => {
  assert(
    /v_shared_place_id\s*:=\s*NULLIF\(v_stops->0->>'place_id'/i.test(body),
    "single mode snapshots stops[0]'s place",
  );
  assert(
    /IF v_location_mode\s*=\s*'single' THEN[\s\S]*?v_s_place_id\s*:=\s*v_shared_place_id/i.test(
      body,
    ),
    "every stop row inherits the shared place in single mode",
  );
});

Deno.test("A-07 slug collision + (event_id, stop_order) collision map to a friendly slug_taken", () => {
  assert(
    /EXCEPTION\s+WHEN unique_violation THEN[\s\S]*?RAISE EXCEPTION 'slug_taken'/i.test(body),
    "unique_violation surfaces as slug_taken (friendly client code)",
  );
});
