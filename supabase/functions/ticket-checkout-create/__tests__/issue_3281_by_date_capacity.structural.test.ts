/**
 * issue #3281 PR10 — edge structural pins for byDate + capacity eventDateId.
 * [TEST-MOD-APPROVED #3281]
 */
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const EDGE = "supabase/functions/ticket-checkout-create/index.ts";
const MIG =
  "supabase/migrations/20271224003281_issue_3281_by_date_quantities.sql";

Deno.test("edge accepts byDate and returns capacity eventDateId", () => {
  const text = Deno.readTextFileSync(EDGE);
  assert(text.includes("byDate"));
  assert(text.includes("capacityEventDateIdFromError"));
  assert(text.includes('error: "ticket_capacity_exceeded"'));
});

Deno.test("migration adds by_date helpers and DETAIL on capacity", () => {
  const text = Deno.readTextFileSync(MIG);
  assert(text.includes("ADD COLUMN IF NOT EXISTS by_date"));
  assert(text.includes("issue_3281_line_qty_for_date"));
  assert(text.includes("USING DETAIL"));
  assert(text.includes("v_by_date"));
});
