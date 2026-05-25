// ORCH-0950 [Trip capacity dual-source-of-truth bug] implementor regression.
//
// Run with:
//   deno test --allow-read supabase/functions/_test/orch_0950_trip_capacity_canonical.test.ts
//
// Fails-on-revert: if the ORCH-0950 migration's biz_update_live_trip rewrite
// is reverted to the pre-fix theme-only capacity path, T-01/T-02/T-03 fail
// because the migration no longer writes ticket_types.quantity_total or strips
// capacity from the inbound p_patch before the events.theme merge.

import {
  assert,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const migration = await Deno.readTextFile(
  new URL(
    "../../migrations/20260725000000_orch_0950_trip_capacity_single_source.sql",
    import.meta.url,
  ),
);

const checkoutMigration = await Deno.readTextFile(
  new URL(
    "../../migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql",
    import.meta.url,
  ),
);

Deno.test("ORCH-0950 T-00 - pre-flight tier invariant applies to published/sellable trips", () => {
  assertStringIncludes(
    migration,
    "AND e.status IN ('scheduled', 'live')",
    "migration pre-flight must not abort on incomplete abandoned draft trips.",
  );
  assertStringIncludes(
    migration,
    "business_publish_trip_draft validates the 1:1 pricing row",
    "draft exclusion must be paired with publish-time pricing validation.",
  );
  assertStringIncludes(
    migration,
    "published/sellable trip events have != 1 trip_pricing_tiers row",
    "pre-flight error should identify the sellable-trip invariant.",
  );
});

Deno.test("ORCH-0950 T-01 - migration reconciles drift to MAX and strips existing JSONB capacity", () => {
  assertMatch(
    migration,
    /UPDATE\s+public\.ticket_types\s+tt[\s\S]*?quantity_total\s*=\s*GREATEST\([\s\S]*?theme->'business_trip'->>'capacity'[\s\S]*?tt\.quantity_total/i,
    "migration must backfill ticket_types.quantity_total from MAX(theme capacity, ticket capacity).",
  );
  assertMatch(
    migration,
    /UPDATE\s+public\.events[\s\S]*?jsonb_set\([\s\S]*?\(theme->'business_trip'\)\s*-\s*'capacity'[\s\S]*?WHERE\s+event_type\s*=\s*'trip'/i,
    "migration must strip capacity from events.theme.business_trip on trip rows.",
  );
  assertStringIncludes(
    migration,
    "ORCH-0950 strip failed",
    "migration must abort if post-strip residue remains.",
  );
});

Deno.test("ORCH-0950 T-02 - biz_update_live_trip writes capacity to ticket_types.quantity_total", () => {
  assertMatch(
    migration,
    /IF\s+v_new_business_trip\s+\?\s+'capacity'[\s\S]*?SELECT\s+tt\.quantity_total,\s+tt\.id[\s\S]*?INTO\s+v_old_capacity,\s+v_ticket_type_id[\s\S]*?UPDATE\s+public\.ticket_types[\s\S]*?SET\s+quantity_total\s*=\s*v_new_capacity/i,
    "live-trip capacity patch must resolve the joined ticket type and update ticket_types.quantity_total.",
  );
  assertMatch(
    migration,
    /IF\s+v_new_capacity\s+IS\s+NULL\s+OR\s+v_new_capacity\s+<=\s+0\s+THEN[\s\S]*?RAISE\s+EXCEPTION\s+'trip_capacity_required'/i,
    "live-trip capacity patch must reject null/non-positive capacity before write.",
  );
  assertMatch(
    migration,
    /IF\s+v_new_capacity\s+<\s+v_total_sold\s+THEN[\s\S]*?'capacity_below_sold'/i,
    "live-trip capacity patch must preserve the sold-count refund gate.",
  );
});

Deno.test("ORCH-0950 T-03 - biz_update_live_trip strips capacity before theme merge", () => {
  assertStringIncludes(
    migration,
    "p_patch := p_patch #- '{theme,business_trip,capacity}'",
    "live-trip RPC must remove capacity from p_patch before events.theme merge.",
  );
  assertStringIncludes(
    migration,
    "p_patch := p_patch #- '{theme,business_trip}'",
    "live-trip RPC must remove empty business_trip shells left by capacity-only patches.",
  );
  assertMatch(
    migration,
    /theme\s*=\s*CASE\s+WHEN\s+p_patch\s+\?\s+'theme'[\s\S]*?THEN\s+theme\s+\|\|\s+\(p_patch->'theme'\)/i,
    "existing theme merge behavior must remain, operating on the capacity-free p_patch.",
  );
});

Deno.test("ORCH-0950 T-04 - publish validator sources capacity from ticket_types.quantity_total", () => {
  assertMatch(
    migration,
    /SELECT\s+tt\.quantity_total\s+INTO\s+v_capacity[\s\S]*?FROM\s+public\.ticket_types\s+tt[\s\S]*?JOIN\s+public\.trip_pricing_tiers\s+tpt/i,
    "business_publish_trip_draft must validate capacity from the joined ticket_types row.",
  );
  assertStringIncludes(
    migration,
    "Trips must have a positive capacity in ticket_types.quantity_total before publish.",
  );
  assertMatch(
    migration,
    /theme\s*=\s*jsonb_strip_nulls\(\(v_theme\s+#-\s+'\{business_trip,capacity\}'\)\s*-\s*'business_draft'\)/i,
    "business_publish_trip_draft must not persist stale capacity from draft payload theme.",
  );
});

Deno.test("ORCH-0950 T-05 - checkout gate remains on ticket_types.quantity_total", () => {
  assert(
    !/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.biz_ticket_checkout_create_session/i
      .test(migration),
    "ORCH-0950 migration must not alter the checkout RPC.",
  );
  assertMatch(
    checkoutMigration,
    /v_sold\s+\+\s+v_reserved\s+\+\s+v_qty\s+>\s+v_ticket_type\.quantity_total/i,
    "checkout RPC capacity gate must continue to enforce ticket_types.quantity_total.",
  );
});
