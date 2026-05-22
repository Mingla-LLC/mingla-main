/**
 * ORCH-0921 ADVERSARIAL — `biz_ticket_checkout_finalize` compare-and-correct
 * branch attacks different angles from the implementor's T-05/T-06/T-07.
 *
 * Implementor covered:
 *   T-05 — happy-path self-heal writes installments correctly
 *   T-06 — idempotency on second self-heal call (NOT EXISTS guard)
 *   T-07 — legacy "first time finalize" path is preserved
 *
 * Adversarial angles attacked here (4 tests):
 *   TA-S01 — self-heal must NOT fire when customer is NULL even if all other
 *            conditions are met (preserves the "no installment without PM"
 *            invariant that prevents the cron from charging into a void)
 *   TA-S02 — self-heal must NOT fire when payment_method is NULL even if all
 *            other conditions are met (same invariant from the other side)
 *   TA-S03 — self-heal must NOT fire when the order already has
 *            installment_plan_root=true (the EXISTS-guard in the migration
 *            line 65-69 prevents a redundant or competing rewrite)
 *   TA-S04 — self-heal must NOT fire when at least 1 installment row already
 *            exists on the order, even if the count is wrong (partial-write
 *            collision protection; orchestrator decides repair, not the RPC)
 *
 * Strategy: structural source assertions against the live migration body. The
 * implementor's T-05..T-07 already exercise the happy path via fake-rpc DI;
 * this test pins the BAD-CONDITION reject paths by reading the migration's
 * own SQL guard logic. If a future migration relaxes any of the 4 guards,
 * these tests fail — protecting the invariant.
 */

import { assertEquals, assertMatch } from "https://deno.land/std@0.190.0/testing/asserts.ts";

const MIGRATION_PATH = new URL(
  "../../../migrations/20260724000000_orch_0921_finalize_compare_and_correct.sql",
  import.meta.url,
);
const MIGRATION_SQL = await Deno.readTextFile(MIGRATION_PATH);

Deno.test("ORCH-0921 TA-S01 - compare-and-correct guard requires p_stripe_customer_id_on_connected_account IS NOT NULL", () => {
  // The guard must reject NULL customer even when all other conditions match.
  assertMatch(
    MIGRATION_SQL,
    /IF\s+p_installment_plan_root[\s\S]{0,500}AND\s+p_stripe_customer_id_on_connected_account\s+IS\s+NOT\s+NULL/i,
    "Self-heal guard must require NON-NULL stripe_customer_id_on_connected_account",
  );
});

Deno.test("ORCH-0921 TA-S02 - compare-and-correct guard requires p_saved_payment_method_id IS NOT NULL", () => {
  // The guard must reject NULL payment method even when all other conditions match.
  assertMatch(
    MIGRATION_SQL,
    /IF\s+p_installment_plan_root[\s\S]{0,500}AND\s+p_saved_payment_method_id\s+IS\s+NOT\s+NULL/i,
    "Self-heal guard must require NON-NULL saved_payment_method_id",
  );
});

Deno.test("ORCH-0921 TA-S03 - compare-and-correct guard requires orders.installment_plan_root = false (no redundant rewrite)", () => {
  // The EXISTS clause must filter on installment_plan_root=false so a second
  // correct caller cannot accidentally rewrite/duplicate an already-correct
  // installment plan.
  assertMatch(
    MIGRATION_SQL,
    /AND\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.orders\s+WHERE\s+id\s*=\s*v_session\.order_id\s+AND\s+installment_plan_root\s*=\s*false\s*\)/i,
    "Self-heal guard must require existing order with installment_plan_root=false",
  );
});

Deno.test("ORCH-0921 TA-S04 - compare-and-correct guard requires zero existing order_installments rows (no partial-write collision)", () => {
  // The NOT EXISTS clause must filter on zero installment rows so a partial
  // prior write (e.g., 1 of 2 rows landed before a crash) doesn't get layered
  // with duplicates.
  assertMatch(
    MIGRATION_SQL,
    /AND\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.order_installments\s+WHERE\s+order_id\s*=\s*v_session\.order_id\s*\)/i,
    "Self-heal guard must require zero existing order_installments rows",
  );
});

Deno.test("ORCH-0921 TA-S05 - migration self-verify probe is non-bypassable", () => {
  // The migration MUST contain a probe that fails the push if the post-state
  // isn't exactly 1 overload of 8 params. This prevents a future migration
  // from silently shipping an extra overload that breaks strict-grep's
  // caller-counting assumptions. The IF condition asserts pronargs=8 and
  // the RAISE EXCEPTION fires on mismatch.
  assertMatch(
    MIGRATION_SQL,
    /IF\s*\(\s*SELECT\s+COUNT\(\*\)\s+FROM\s+pg_proc\s+WHERE\s+proname\s*=\s*'biz_ticket_checkout_finalize'\s+AND\s+pronargs\s*=\s*8\s*\)\s*<>\s*1\s+THEN/i,
    "Migration must check pg_proc for exactly 1 overload at pronargs=8",
  );
  assertMatch(
    MIGRATION_SQL,
    /RAISE\s+EXCEPTION\s+'ORCH-0921\s+self-verify[^']*'/i,
    "Migration must RAISE EXCEPTION on probe failure (so supabase db push fails loudly)",
  );
});

Deno.test("ORCH-0921 TA-S06 - the first-call branch's installment_plan_finalize_missing_customer_or_pm guard is preserved unchanged", () => {
  // This guard pre-existed in ORCH-0869 Stage 1B. ORCH-0921 must NOT remove or
  // weaken it (it prevents a buggy caller from ever writing installments
  // without a customer/PM on the first finalize call).
  assertMatch(
    MIGRATION_SQL,
    /IF\s+p_stripe_customer_id_on_connected_account\s+IS\s+NULL\s+OR\s+p_saved_payment_method_id\s+IS\s+NULL\s+THEN[\s\S]{0,200}RAISE\s+EXCEPTION\s+'installment_plan_finalize_missing_customer_or_pm'/i,
    "First-call missing-customer-or-PM guard must remain intact",
  );
});

Deno.test("ORCH-0921 TA-S07 - SECURITY DEFINER + service_role grant are intact", () => {
  assertMatch(
    MIGRATION_SQL,
    /SECURITY\s+DEFINER/i,
    "RPC must remain SECURITY DEFINER",
  );
  assertMatch(
    MIGRATION_SQL,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.biz_ticket_checkout_finalize\s*\([\s\S]{0,200}\)\s+TO\s+service_role/i,
    "RPC must GRANT EXECUTE to service_role",
  );
  assertMatch(
    MIGRATION_SQL,
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.biz_ticket_checkout_finalize\s*\([\s\S]{0,200}\)\s+FROM\s+PUBLIC/i,
    "RPC must REVOKE ALL from PUBLIC",
  );
});

Deno.test("ORCH-0921 TA-S08 - compare-and-correct branch reads installment_schedule from session (not from orders metadata) — correct cross-table source", () => {
  // The hypothesis #2 in the investigation was "finalize reads schedule from
  // orders.metadata which is empty." This test pins the FIX: the compare-and-
  // correct branch must read v_session.installment_schedule, not from orders.
  assertMatch(
    MIGRATION_SQL,
    /v_schedule\s*:=\s*v_session\.installment_schedule;/i,
    "Compare-and-correct must read installment_schedule from the session row",
  );
  // Negative assertion: must NOT read from orders.metadata for the schedule.
  const ordersMetadataReadForSchedule =
    /v_schedule\s*:=[\s\S]{0,200}orders[\s\S]{0,200}metadata/i;
  assertEquals(
    ordersMetadataReadForSchedule.test(MIGRATION_SQL),
    false,
    "Compare-and-correct must NOT read installment_schedule from orders.metadata",
  );
});

Deno.test("ORCH-0921 TA-S09 - response payload's installmentPlanRoot is computed from the live orders row, not the input flag (so self-heal post-state is reflected truthfully)", () => {
  // After self-heal, the legacy early-return must return the JUST-UPDATED
  // flag, not the input parameter that triggered the heal. This is what makes
  // the response shape honest about the actual DB state.
  assertMatch(
    MIGRATION_SQL,
    /'installmentPlanRoot',\s*\(\s*SELECT\s+installment_plan_root\s+FROM\s+public\.orders\s+WHERE\s+id\s*=\s*v_session\.order_id\s*\)/i,
    "Response installmentPlanRoot must be computed from the live orders row post-self-heal",
  );
});
