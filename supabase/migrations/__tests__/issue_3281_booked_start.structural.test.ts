/**
 * issue #3281 Round 1 PR 1b — structural pins on the booked-start migration.
 * Fails on revert of columns, validate helper, create/finalize/reminders/scan hunks.
 */
// MINGLA-INVARIANT: I-PROPOSED-3281-BOOKED-START-SAVED | issue #3281 | a checkout that names a start stores it on session and order and every receipt surface prints it
// MINGLA-INVARIANT: I-PROPOSED-3281-REMINDER-AND-SCAN-USE-BOOKED-START | issue #3281 | experience reminders and scan admit windows key off booked_start_at when present
import { assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

const MIG =
  "supabase/migrations/20271109003281_issue_3281_booked_start.sql";

Deno.test("#3281 booked_start migration carries columns, flag, validate, and re-emits", async () => {
  const text = await Deno.readTextFile(MIG);

  assert(text.includes("ADD COLUMN IF NOT EXISTS booked_start_at"));
  assert(text.includes("experience_require_booked_start"));
  assert(text.includes("issue_3281_validate_booked_start"));
  assert(text.includes("booked_start_required"));
  assert(text.includes("booked_start_off_grid"));
  assert(text.includes("booked_start_in_past"));

  assert(text.includes("p_booked_start_at"));
  assert(text.includes("PERFORM public.issue_3281_validate_booked_start("));
  assert(text.includes("p_booked_start_at IS NOT NULL AND v_day_count <> 1"));
  assert(text.includes("v_session.booked_start_at"));

  // F-B reminders + F-C scan
  assert(text.includes("o.booked_start_at AS start_at"));
  assert(text.includes("v_booked_start"));
  assert(text.includes("issue #3281 F-C"));

  // Prior capacity / queue hunks must survive the re-emit
  assert(text.includes("issue_3313_ticket_type_occurrence_taken("));
  assert(text.includes("ticket_sales_not_started"));
  assert(text.includes("AND event_id=p_event_id"));
});
