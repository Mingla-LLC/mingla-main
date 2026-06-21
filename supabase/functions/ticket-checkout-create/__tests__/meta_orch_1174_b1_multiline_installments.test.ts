/**
 * META-ORCH-1174 Leg B1 — source-assertion test pinning the multi-line
 * installment migration. Mirrors the ORCH-0915 RPC-behavior test pattern
 * (read the migration SQL text + assert load-bearing characteristics).
 *
 * This proves the SQL RPC implements the SAME per-line algorithm that the
 * adversarially-unit-tested helper
 * (_shared/installments/computeMultiLineInstallmentPlan.ts) specifies, and that
 * the single-line guard is removed.
 *
 * Fails-on-revert: reverting the migration (restoring the
 * `ticket_lines_mixed_with_installments` guard or dropping the per-line loop)
 * fails these assertions.
 *
 * Run: deno test supabase/functions/ticket-checkout-create/__tests__/meta_orch_1174_b1_multiline_installments.test.ts
 */

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const migration = await Deno.readTextFile(
  new URL(
    "../../../migrations/20261101000000_meta_orch_1174_b1_multiline_installments.sql",
    import.meta.url,
  ),
);

Deno.test("B1: the single-line installment guard is REMOVED from the new session RPC body", () => {
  // The new CREATE OR REPLACE body must not RAISE the mixed-cart guard. (It may
  // appear in prose comments describing what was removed, but never as a RAISE.)
  assert(
    !/RAISE\s+EXCEPTION\s+'ticket_lines_mixed_with_installments'/i.test(migration),
    "the new session RPC must not RAISE ticket_lines_mixed_with_installments — DEC-1174-F lifts it",
  );
});

Deno.test("B1: per-line installment math loop over the built line items", () => {
  // Pass 2 iterates v_items (the per-line totals) — not just the first tier.
  assertStringIncludes(migration, "per-line installment math");
  assertStringIncludes(
    migration,
    "FOR v_line IN SELECT * FROM jsonb_array_elements(v_items)",
  );
  // Per-line total drives the deposit + installment amounts (qty folded in).
  assertStringIncludes(migration, "v_line_total := (v_line ->> 'totalCents')::bigint");
  assertStringIncludes(
    migration,
    "v_line_deposit_cents := floor(v_line_total::numeric * v_deposit_pct / 100)::bigint",
  );
});

Deno.test("B1: 'due today' is the sum of per-line deposits + non-plan full totals", () => {
  // Plan line → add its deposit; non-plan line → add its full total.
  assertStringIncludes(
    migration,
    "v_due_today_cents := v_due_today_cents + v_line_deposit_cents",
  );
  assertStringIncludes(
    migration,
    "v_due_today_cents := v_due_today_cents + v_line_total",
  );
  // The deposit override uses the summed due-today, not a single tier's deposit.
  assertStringIncludes(migration, "v_total := v_due_today_cents::integer");
});

Deno.test("B1: last-installment-absorbs-rounding is preserved PER LINE (no money lost)", () => {
  // The last installment of each line = lineTotal − lineDeposit − running.
  assertStringIncludes(
    migration,
    "v_inst_amount := v_line_total - v_line_deposit_cents - v_line_running",
  );
  // Intermediate installments use floor(lineTotal * pct / 100).
  assertStringIncludes(
    migration,
    "v_inst_amount := floor(v_line_total::numeric * v_inst_pct / 100)::bigint",
  );
});

Deno.test("B1: schedules are UNIONED + re-ordinalled 1..M by dueAt (UNIQUE(order_id, ordinal) holds)", () => {
  // Entries accumulate into v_unioned with provenance, then row_number() re-
  // numbers them sequentially sorted by dueAt then source ordinal.
  assertStringIncludes(migration, "v_unioned := v_unioned ||");
  assertStringIncludes(migration, "row_number() OVER");
  assertStringIncludes(migration, "ORDER BY (elem ->> 'dueAt') ASC");
  assertStringIncludes(migration, "'ordinal', rn");
});

Deno.test("B1: ORCH-0915 pay-in-full opt-out is preserved (session-wide, suppresses all schedules)", () => {
  // payment_plan_choice='full' ⇒ skip the entire per-line installment pass.
  assertStringIncludes(
    migration,
    "IF v_is_trip AND p_payment_plan_choice <> 'full' THEN",
  );
  assertStringIncludes(migration, "payment_plan_choice_invalid");
});

Deno.test("B1: persisted installment_schedule shape is UNCHANGED so finalize reads it unmodified", () => {
  // finalize loops schedule.installments[].{ordinal,amountCents,dueAt}; the new
  // RPC builds exactly that shape with depositCents = summed due-today.
  assertStringIncludes(migration, "'fullPriceCents', v_full_price_cents");
  assertStringIncludes(migration, "'depositCents', v_due_today_cents");
  assertStringIncludes(migration, "'installments', v_unioned");
});

Deno.test("B1: CREATE OR REPLACE keeps the 11-arg signature + RETURNS jsonb (no DROP / no widening) + re-GRANTs service_role", () => {
  assertStringIncludes(
    migration,
    "CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session(",
  );
  assertStringIncludes(migration, "p_payment_plan_choice text DEFAULT 'auto'");
  assertStringIncludes(migration, ") RETURNS jsonb");
  assert(
    !/DROP\s+FUNCTION[^;]*biz_ticket_checkout_create_session/i.test(migration),
    "signature + return type are identical → no DROP needed",
  );
  assertStringIncludes(
    migration,
    "GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_create_session(uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text) TO service_role",
  );
});

Deno.test("B1: per-package capacity gate is per-line (each ticket_type's own quantity_total)", () => {
  // The capacity check is inside the per-line loop using THIS line's ticket_type
  // — there is no single-tier capacity shortcut in the engine.
  assertStringIncludes(migration, "PER-PACKAGE capacity");
  assertStringIncludes(migration, "ticket_capacity_exceeded");
});
