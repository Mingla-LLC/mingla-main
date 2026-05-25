// ORCH-0950 expanded implementor regression.
//
// Run with:
//   deno test --allow-read supabase/functions/_test/orch_0950_expanded_partial_patch_preserves_siblings.test.ts
//
// This is a migration-contract test: it pins the SQL shape that prevents the
// old shallow business_trip merge from wiping siblings while routing capacity,
// dates, destination, and tier sold counts through canonical stores.

import {
  assert,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const migration = await Deno.readTextFile(
  new URL(
    "../../migrations/20260725000002_orch_0950_expanded_scope_dashboard_coherence.sql",
    import.meta.url,
  ),
);

Deno.test("ORCH-0950 expanded T-01 - destination column is added/backfilled and legacy keys stripped", () => {
  assertStringIncludes(migration, "ADD COLUMN IF NOT EXISTS destination_text text");
  assertMatch(
    migration,
    /UPDATE\s+public\.events[\s\S]*?SET\s+destination_text\s*=\s*NULLIF\(btrim\(theme->'business_trip'->>'destinationLocationText'\), ''\)/i,
  );
  assertStringIncludes(migration, "- 'destinationLocationText'");
  assertStringIncludes(migration, "- 'startAt'");
  assertStringIncludes(migration, "ORCH-0950 expanded strip failed");
});

Deno.test("ORCH-0950 expanded T-02 - live patch writes capacity/date/destination canonically", () => {
  assertMatch(
    migration,
    /IF\s+v_new_business_trip\s+\?\s+'capacity'[\s\S]*?UPDATE\s+public\.ticket_types[\s\S]*?quantity_total\s*=\s*v_new_capacity/i,
  );
  assertMatch(
    migration,
    /IF\s+v_new_business_trip\s+\?\s+'startAt'\s+OR\s+v_new_business_trip\s+\?\s+'endAt'[\s\S]*?UPDATE\s+public\.event_dates[\s\S]*?start_at\s*=\s*COALESCE\(v_new_start,\s*start_at\)[\s\S]*?end_at\s*=\s*COALESCE\(v_new_end,\s*end_at\)/i,
  );
  assertMatch(
    migration,
    /IF\s+v_new_business_trip\s+\?\s+'destinationLocationText'[\s\S]*?UPDATE\s+public\.events[\s\S]*?SET\s+destination_text\s*=\s*NULLIF\(btrim\(v_new_business_trip->>'destinationLocationText'\), ''\)/i,
  );
});

Deno.test("ORCH-0950 expanded T-03 - partial business_trip patches deep-merge residual siblings", () => {
  assertMatch(
    migration,
    /UPDATE\s+public\.events[\s\S]*?SET\s+theme\s*=\s*jsonb_set\([\s\S]*?'\{business_trip\}'[\s\S]*?COALESCE\(theme->'business_trip',\s*'\{\}'::jsonb\)\s*\|\|\s*\(p_patch->'theme'->'business_trip'\)/i,
  );
  assertStringIncludes(
    migration,
    "p_patch := p_patch #- '{theme,business_trip}'",
  );
  assert(
    !/theme\s+\|\|\s+\(p_patch->'theme'\)/.test(migration),
    "expanded migration must not contain the old shallow merge literal.",
  );
});

Deno.test("ORCH-0950 expanded T-04 - per-tier ticket sold RPC counts tickets, not orders", () => {
  assertStringIncludes(
    migration,
    "CREATE OR REPLACE FUNCTION public.biz_trip_tickets_sold_by_tier(p_event_id uuid)",
  );
  assertMatch(
    migration,
    /FROM\s+public\.tickets\s+t[\s\S]*?t\.ticket_type_id\s*=\s*tt\.id[\s\S]*?t\.status\s+IN\s+\('valid',\s*'used',\s*'transferred'\)/i,
  );
  assertStringIncludes(
    migration,
    "jsonb_object_agg(tt.id::text, sold_count)",
  );
});

Deno.test("ORCH-0950 expanded T-05 - publish writes destination and strips canonical JSONB keys", () => {
  assertStringIncludes(migration, "destination_text = v_destination_text");
  assertStringIncludes(migration, "#- '{business_trip,destinationLocationText}'");
  assertStringIncludes(migration, "#- '{business_trip,startAt}'");
  assertStringIncludes(migration, "#- '{business_trip,endAt}'");
});
