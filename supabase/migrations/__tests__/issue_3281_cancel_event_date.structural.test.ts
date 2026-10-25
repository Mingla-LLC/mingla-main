/**
 * issue #3281 PR9 — cancel one date migration structural pins.
 * [TEST-MOD-APPROVED #3281]
 */
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION =
  "supabase/migrations/20271223003281_issue_3281_cancel_event_date.sql";
const DATES = "mingla-business/app/event/[id]/dates.tsx";

Deno.test("cancel migration adds status columns and RPCs", () => {
  const text = Deno.readTextFileSync(MIGRATION);
  assert(text.includes("ADD COLUMN IF NOT EXISTS status"));
  assert(text.includes("cancelled_at"));
  assert(text.includes("business_cancel_event_date"));
  assert(text.includes("business_move_event_date_time"));
  assert(text.includes("p_preview"));
});

Deno.test("Host Dates screen wires Cancel this date", () => {
  const text = Deno.readTextFileSync(DATES);
  assert(text.includes("business_cancel_event_date"));
  assert(text.includes("Cancel this date"));
  assert(text.includes("issue-3281-cancel-date-"));
});
