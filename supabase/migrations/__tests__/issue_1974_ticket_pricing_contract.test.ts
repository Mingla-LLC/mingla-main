import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const sql = await Deno.readTextFile(
  new URL(
    "../20270508001974_issue_1974_ari_ticket_pricing.sql",
    import.meta.url,
  ),
);

Deno.test("#1974 SQL exposes one caller-bound ticket command with fixed grants", () => {
  assertStringIncludes(sql, "business_patch_event_ticket_tiers(");
  assertStringIncludes(
    sql,
    "SECURITY DEFINER\nSET search_path = public, pg_temp",
  );
  assertStringIncludes(
    sql,
    "biz_brand_effective_rank(v_event.brand_id,v_uid) < public.biz_role_rank('event_manager')",
  );
  assertStringIncludes(
    sql,
    "REVOKE ALL ON FUNCTION public.business_patch_event_ticket_tiers",
  );
  assertStringIncludes(sql, "TO authenticated, service_role");
});

Deno.test("#1974 SQL keeps draft tiers in JSON and live tiers in ticket_types", () => {
  const draft = sql.slice(
    sql.indexOf("IF v_event.status='draft' THEN"),
    sql.indexOf("  ELSE", sql.indexOf("IF v_event.status='draft' THEN")),
  );
  assertStringIncludes(draft, "'{business_draft}'");
  assertStringIncludes(draft, "'tickets',v_tiers");
  assertStringIncludes(draft, "draft_ticket_projection_conflict");
  assertStringIncludes(sql, "ticket_lifecycle_mismatch");
  assertStringIncludes(sql, "public.trip_pricing_tiers");
  const migrationCleanup = /DELETE\s+FROM\s+public\.ticket_types/i.test(sql);
  assertEquals(
    migrationCleanup,
    false,
    "migration must not clean or reinterpret existing trip rows",
  );
});

Deno.test("#1974 SQL is sparse, rank-aware, and preserves inheritance", () => {
  assertStringIncludes(sql, "p_patch?'pass_tax'");
  assertStringIncludes(sql, "ELSE v_event.pass_tax");
  assertStringIncludes(sql, "biz_role_rank('finance_manager')");
  assertStringIncludes(sql, "pricing_switches_locked");
  assertStringIncludes(sql, "brand_defaults_must_be_concrete");
});

Deno.test("#1974 SQL binds currency, revisions, sold guards, and deterministic operation identity", () => {
  for (
    const contract of [
      "p_expected_event_updated_at",
      "p_expected_client_revision",
      "p_operation_id",
      "pg_brand_can_collect",
      "event_currency_required",
      "sold_ticket_mutation_blocked",
      "tier_delete_with_sales",
      "password_hash=v_password_hash",
    ]
  ) assert(sql.includes(contract), `missing ${contract}`);
  assert(!/['\"]USD['\"]/i.test(sql), "ticket writer must not manufacture USD");
});

Deno.test("#1974 stays a command seam and does not duplicate #1972 transaction/receipt ownership", () => {
  assertStringIncludes(sql, "agent_operation_receipt_begin");
  assertStringIncludes(sql, "agent_operation_receipt_complete");
  assert(
    !/CREATE\s+TABLE[\s\S]*agent_operation_receipts/i.test(sql),
    "#1974 must not create #1972's receipt table",
  );
  assertStringIncludes(sql, "p_operation_id uuid DEFAULT NULL");
});

Deno.test("#1974 routes Business tickets through the same owner and binds tax to fresh provider evidence", () => {
  const businessWriter = sql.slice(
    sql.indexOf(
      "CREATE OR REPLACE FUNCTION public.business_update_live_event_atomic(",
    ),
    sql.indexOf(
      "CREATE OR REPLACE FUNCTION public.ari_execute_ticket_pricing_operation(",
    ),
  );
  assertStringIncludes(
    businessWriter,
    "public.business_patch_event_ticket_tiers(",
  );
  assertStringIncludes(businessWriter, "v_core_without_tickets");
  assert(
    !/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.ticket_types\b/i.test(
      businessWriter,
    ),
    "Business editor must not regain a competing ticket_types writer",
  );
  assertStringIncludes(sql, "brand_tax_registration_attestations");
  assertStringIncludes(sql, "issue_1974_require_fresh_tax_registration");
  assertStringIncludes(sql, "interval '5 minutes'");
  assertStringIncludes(sql, "stripe_connect_accounts");
  assertStringIncludes(
    sql,
    "REVOKE EXECUTE ON FUNCTION public.business_update_live_event(uuid,jsonb,text,integer)",
  );
});
