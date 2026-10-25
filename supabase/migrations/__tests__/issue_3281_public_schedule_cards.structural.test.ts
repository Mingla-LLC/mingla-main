/**
 * issue #3281 PR7 — public schedule cards migration structural pins.
 * [TEST-MOD-APPROVED #3281]
 */
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION =
  "supabase/migrations/20271222003281_issue_3281_public_schedule_cards.sql";

Deno.test("PR7 migration appends schedule columns to the public view", () => {
  const text = Deno.readTextFileSync(MIGRATION);
  assert(text.includes("next_start_at"));
  assert(text.includes("next_end_at"));
  assert(text.includes("upcoming_count"));
  assert(text.includes("schedule_line"));
  assert(text.includes("business_public_events_view"));
  assert(text.includes("issue_3281_event_schedule"));
  assert(text.includes("discover_v2_event_base"));
  assert(text.includes("admin_list_offerings"));
  assert(text.includes("admin_get_offering"));
  // No new grants on the schedule helper (service_role only).
  assert(text.includes("GRANT EXECUTE ON FUNCTION public.issue_3281_event_schedule"));
  assert(text.includes("TO service_role"));
  assert(!/GRANT EXECUTE ON FUNCTION public\.issue_3281_event_schedule\(uuid\)\s+TO anon/.test(text));
});
