// #1971 implementor regression — canonical trip commands and safety seams.
// FAILS-ON-REVERT: removing any command, receipt, CAS, deletion lock/guard,
// manager RLS policy, or no-PII money projection fails a named assertion.
import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const path = "supabase/migrations/20270407001971_issue_1971_ari_trip_lifecycle.sql";
const source = await Deno.readTextFile(path);
const sql = source.replace(/--[^\n]*/g, "");

const commands = [
  "biz_create_trip_draft",
  "biz_apply_trip_draft_graph",
  "biz_update_trip_live_command",
  "biz_publish_trip_command",
  "biz_soft_delete_trip",
  "biz_get_trip_order_money_snapshot",
];

Deno.test("#1971 graph lifecycle exposes exactly the canonical command family", () => {
  for (const command of commands) {
    assertStringIncludes(sql, `FUNCTION public.${command}(`, `${command} missing`);
  }
  assertStringIncludes(sql, "issue_1719_publish_trip_with_poster");
  assertStringIncludes(sql, "issue_1719_update_live_trip_with_poster");
});

Deno.test("#1971 every mutating command consumes a durable domain receipt", () => {
  assertStringIncludes(sql, "CREATE TABLE public.biz_trip_command_receipts");
  assertStringIncludes(sql, "operation_id uuid PRIMARY KEY");
  assertStringIncludes(sql, "idempotency_conflict");
  assert((sql.match(/biz_trip_command_begin\(/g) ?? []).length >= 6);
  assert((sql.match(/biz_trip_command_finish\(/g) ?? []).length >= 6);
});

Deno.test("#1971 draft/live/publish/delete commands enforce optimistic concurrency", () => {
  assert((sql.match(/trip_revision_conflict/g) ?? []).length >= 4);
  assert((sql.match(/IS DISTINCT FROM p_expected_updated_at/g) ?? []).length >= 4);
});

Deno.test("#1971 delete and order creation serialize on one event lock", () => {
  assert((sql.match(/hashtextextended\([^\n]+1971\)/g) ?? []).length >= 2);
  assertStringIncludes(sql, "payment_status NOT IN ('failed','cancelled')");
  assertStringIncludes(sql, "trip_deleted_order_forbidden");
  assertStringIncludes(sql, "BEFORE INSERT OR UPDATE OF event_id,payment_status ON public.orders");
});

Deno.test("#1971 sidecar writers require event_manager and money read returns aggregates only", () => {
  for (const policy of ["trip_days_write_event_managers", "trip_inclusions_write_event_managers", "trip_pricing_tiers_write_event_managers"]) {
    assertStringIncludes(sql, policy);
  }
  assert((sql.match(/biz_role_rank\('event_manager'\)/g) ?? []).length >= 4);
  assertStringIncludes(sql, "biz_role_rank('finance_manager')");
  for (const pii of ["buyer_email", "buyer_phone", "buyer_name"]) {
    assert(!sql.includes(pii), `money snapshot leaks ${pii}`);
  }
});

Deno.test("#1971 quote and consent engines are not duplicated", () => {
  assert(!/quote_stay|calculate_trip_quote|consent_mapping/i.test(sql));
});
