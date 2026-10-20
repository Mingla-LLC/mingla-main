/**
 * issue #3281 Round 3 — structural pins for spacing / notice / capacity_scope.
 */
// MINGLA-INVARIANT: I-PROPOSED-3281-SPOTS-ONE-COUNTER-FAMILY | issue #3281 | capacity_scope uses one counter family (total / day / start)
import { assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

const MIG =
  "supabase/migrations/20271123003281_issue_3281_r3_spacing_spots.sql";

Deno.test("#3281 R3 migration carries spacing, notice, capacity_scope, slot RPC", async () => {
  const text = await Deno.readTextFile(MIG);

  assert(text.includes("ADD COLUMN IF NOT EXISTS capacity_scope"));
  assert(text.includes("ADD COLUMN IF NOT EXISTS booking_spacing_minutes"));
  assert(text.includes("ADD COLUMN IF NOT EXISTS min_notice_minutes"));
  assert(text.includes("ADD COLUMN IF NOT EXISTS start_offset_minutes"));
  assert(text.includes("issue_3281_apply_experience_r3_settings"));
  assert(text.includes("spots_scope_requires_start_time"));
  assert(text.includes("pg_experience_slot_availability"));
  assert(text.includes("perStartCapacity"));
  assert(text.includes("'spacingMinutes'"));
  assert(text.includes("v_spacing_secs"));
  assert(text.includes("min_notice_minutes"));
  assert(text.includes("'startOffsetMinutes'"));
  assert(text.includes("issue_3313_ticket_type_occurrence_taken"));
  // #4000 posture kept after create_session re-emit
  assert(text.includes("GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_create_session"));
  assert(text.includes("TO service_role"));
  assert(text.includes("PERFORM public.issue_3281_apply_experience_r3_settings"));
});
