/**
 * issue #3281 PR9 — cancel one date migration structural pins.
 * [TEST-MOD-APPROVED #3281]
 */
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION =
  "supabase/migrations/20280216003281_issue_3281_cancel_event_date.sql";
const DATES = "mingla-business/app/event/[id]/dates.tsx";

Deno.test("cancel migration adds status columns and RPCs", () => {
  const text = Deno.readTextFileSync(MIGRATION);
  assert(text.includes("ADD COLUMN IF NOT EXISTS status"));
  assert(text.includes("cancelled_at"));
  assert(text.includes("business_cancel_event_date"));
  assert(text.includes("business_move_event_date_time"));
  assert(text.includes("p_preview"));
  assert(text.includes("multi_date_pricing_mode"));
  assert(text.includes("buyer_total_cents"));
  assert(text.includes("partial_refund"));
  assert(text.includes("FOR UPDATE"));
  assert(text.includes("COALESCE(d.status"));
  assert(text.includes("sold_date_requires_schedule_writer"));
  assert(text.includes("order_live_tickets"));
  assert(text.includes("issue_3281_event_schedule"));
  assert(text.includes("REVOKE ALL ON FUNCTION public.issue_3281_event_schedule(uuid)"));
  assert(!text.includes("DO $patch$"));
  assert(!text.includes("EXECUTE v_new"));
});

Deno.test("Host Dates screen wires Cancel this date with confirm", () => {
  const text = Deno.readTextFileSync(DATES);
  assert(text.includes("business_cancel_event_date"));
  assert(text.includes("Cancel this date"));
  assert(text.includes("issue-3281-cancel-date-"));
  assert(text.includes("requestCancelPreview"));
  assert(text.includes("confirmCancelDate"));
  assert(text.includes("formatCurrency"));
  assert(text.includes("p_preview: false"));
  assert(text.includes("LazyConfirmDialog"));
});
