/**
 * issue #3281 PR10 — edge structural pins for byDate + capacity eventDateId.
 * [TEST-MOD-APPROVED #3281]
 */
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const EDGE = "supabase/functions/ticket-checkout-create/index.ts";
const BASE_MIG =
  "supabase/migrations/20271224003281_issue_3281_by_date_quantities.sql";
const TERMINAL_MIG =
  "supabase/migrations/20280216003282_issue_3281_by_date_quantities_paystack_reemit.sql";

Deno.test("edge accepts byDate and returns capacity eventDateId", () => {
  const text = Deno.readTextFileSync(EDGE);
  assert(text.includes("byDate"));
  assert(text.includes("capacityEventDateIdFromError"));
  assert(text.includes('error: "ticket_capacity_exceeded"'));
  assert(text.includes("by_date_not_supported_for_all_days"));
  assert(text.includes('./capacityEventDateId.ts'));
});

Deno.test("migration adds by_date helpers and DETAIL on capacity", () => {
  const text = Deno.readTextFileSync(BASE_MIG);
  assert(text.includes("ADD COLUMN IF NOT EXISTS by_date"));
  assert(text.includes("issue_3281_line_qty_for_date"));
  assert(text.includes("USING DETAIL"));
  assert(text.includes("v_by_date"));
  assert(text.includes("by_date_not_supported_for_all_days"));
  // Experience capacity_scope must expand byDate / day multiplier like lifetime.
  assert(text.includes("capacity_scope"));
  const expIdx = text.indexOf("capacity_scope counters");
  assert(expIdx > 0);
  const window = text.slice(expIdx, expIdx + 900);
  assert(window.includes("issue_3281_line_qty_sum"));
  assert(window.includes("v_day_multiplier"));
});

Deno.test("by-date finalizer preserves Paystack installment collection", () => {
  const text = Deno.readTextFileSync(TERMINAL_MIG);
  assert(text.includes("issue_3645_finalize_is_paystack"));
  assert(text.includes("provider, collection_method, plan_bound_at"));
  assert(text.includes("THEN 'paystack' ELSE 'stripe' END"));
  assert(text.includes("THEN 'pay_link' ELSE 'auto_card' END"));
});
