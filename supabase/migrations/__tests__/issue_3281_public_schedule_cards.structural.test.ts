/**
 * issue #3281 PR7 — public schedule cards migration structural pins.
 * [TEST-MOD-APPROVED #3281]
 */
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION =
  "supabase/migrations/20271222003281_issue_3281_public_schedule_cards.sql";
const DISCOVER_MIGRATION =
  "supabase/migrations/20280214003281_issue_3281_discover_schedule_keys.sql";

Deno.test("PR7 migration schedules public view, discover, and admin readers", () => {
  const text = Deno.readTextFileSync(MIGRATION);
  assert(text.includes("next_start_at"));
  assert(text.includes("next_end_at"));
  assert(text.includes("upcoming_count"));
  assert(text.includes("schedule_line"));
  assert(text.includes("issue_3281_event_schedule"));
  assert(text.includes("CREATE OR REPLACE VIEW public.business_public_events_view"));
  assert(text.includes("admin_list_offerings"));
  // Discover REPLACE lives after #4174 so the explorer brand guard is kept.
  assert(!text.includes("CREATE OR REPLACE FUNCTION public.discover_v2_event_base"));
  // Live Offerings console uses admin_list_offerings_board (#4130), enriched
  // in the follow-on migration after that board reader landed.
  const board = Deno.readTextFileSync(
    "supabase/migrations/20280213003281_issue_3281_admin_offerings_board_schedule.sql",
  );
  assert(board.includes("admin_list_offerings_board"));
  assert(board.includes("issue_3281_event_schedule"));
  assert(board.includes("schedule_line"));
  assert(board.includes("next_start_at"));
  assert(/page AS \([\s\S]*issue_3281_event_schedule/.test(board));
  assert(!/filtered AS \([\s\S]*?issue_3281_event_schedule[\s\S]*?\)\s*,\s*ranked AS/.test(board));
  assert(board.includes("admin_offerings_summary"));
  assert(board.includes("COALESCE(nxt.start_at, d.start_at)"));

  assert(text.includes("COALESCE(next_start_at_sort, master_start_at)"));
  assert(
    text.includes(
      "p_date_from IS NULL OR COALESCE(next_start_at_sort, master_start_at) >= p_date_from",
    ),
  );
  assert(text.includes("page AS"));
  // Full schedule helper must not run on the filtered catalog CTE.
  // Bound at `ranked AS` (not `page AS`) — ranked sits between filtered and page.
  const filteredBody = text.match(/filtered AS \(([\s\S]*?)\)\s*,\s*ranked AS/);
  assert(filteredBody !== null);
  assert(!filteredBody[1].includes("issue_3281_event_schedule"));
  assert(!/ranked AS \([\s\S]*?issue_3281_event_schedule[\s\S]*?\)\s*,\s*page AS/.test(text));
  assert(/page AS \([\s\S]*issue_3281_event_schedule/.test(text));

  const discoverText = Deno.readTextFileSync(DISCOVER_MIGRATION);
  assert(discoverText.includes("CREATE OR REPLACE FUNCTION public.discover_v2_event_base"));
  assert(discoverText.includes("issue_4174_explorer_brand_visible"));
  // Discover eligibility base must not call the schedule helper (facet/count tax).
  const discoverBody = discoverText.match(
    /CREATE OR REPLACE FUNCTION public\.discover_v2_event_base\([\s\S]*?\$function\$([\s\S]*?)\$function\$/,
  );
  assert(discoverBody !== null);
  assert(!discoverBody[1].includes("issue_3281_event_schedule"));
  assert(discoverBody[1].includes("'schedule_line',NULL"));
  assert(discoverBody[1].includes("issue_4174_explorer_brand_visible(e.brand_id)"));

  // T-18 parity patch must stay in the migration (fail-fast if DO block is dropped).
  assert(text.includes("patch_rsvp_schedule"));
  assert(text.includes("pg_public_rsvp_by_slug"));
  assert(text.includes("sched.next_start_at"));

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
