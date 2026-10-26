/**
 * issue #3281 PR7 — public schedule cards migration structural pins.
 * [TEST-MOD-APPROVED #3281]
 */
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION =
  "supabase/migrations/20271222003281_issue_3281_public_schedule_cards.sql";

Deno.test("PR7 migration schedules public view, discover, and admin readers", () => {
  const text = Deno.readTextFileSync(MIGRATION);
  assert(text.includes("next_start_at"));
  assert(text.includes("next_end_at"));
  assert(text.includes("upcoming_count"));
  assert(text.includes("schedule_line"));
  assert(text.includes("issue_3281_event_schedule"));
  assert(text.includes("CREATE OR REPLACE VIEW public.business_public_events_view"));
  assert(text.includes("discover_v2_event_base"));
  assert(text.includes("admin_list_offerings"));

  assert(text.includes("COALESCE(next_start_at_sort, master_start_at)"));
  assert(text.includes("page AS"));
  // Full schedule helper must not run on the filtered catalog CTE.
  // Match only the filtered body (non-greedy up to ", page AS") — a file-wide
  // `filtered AS ([\\s\\S]*issue_3281_event_schedule` false-positives once the
  // helper appears later in `page AS`.
  const filteredBody = text.match(/filtered AS \(([\s\S]*?)\)\s*,\s*page AS/);
  assert(filteredBody !== null);
  assert(!filteredBody[1].includes("issue_3281_event_schedule"));
  assert(/page AS \([\s\S]*issue_3281_event_schedule/.test(text));

  assert(text.includes("admin_get_offering"));
  assert(text.includes("cancel_refund_run_status"));
  assert(text.includes("cancel_refund_object_count"));
  // Helper is service_role-only; public view inlines schedule math.
  assert(text.includes("GRANT EXECUTE ON FUNCTION public.issue_3281_event_schedule"));
  assert(text.includes("TO service_role"));
  assert(
    !/GRANT EXECUTE ON FUNCTION public\.issue_3281_event_schedule\(uuid\)\s+TO anon/
      .test(text),
  );
  assert(text.includes("FROM PUBLIC, anon, authenticated"));
});
