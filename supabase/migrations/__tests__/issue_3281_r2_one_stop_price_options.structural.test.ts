/**
 * issue #3281 Round 2 — structural pins: one-stop gate + price_options helper.
 * [TEST-MOD-APPROVED #3281] retires the hard "2–5 only" read of the create body.
 */
// MINGLA-INVARIANT: I-PROPOSED-3281-STOP-COUNT-1-TO-5-ONE-PLACE | issue #3281 | experience stop count 1..5 is enforced in one place on create, publish, and live-edit
// MINGLA-INVARIANT: I-PROPOSED-3281-OPTION-IS-A-TICKET-TYPE | issue #3281 | each experience price option is a ticket_types row with price_basis
import { assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

const MIG =
  "supabase/migrations/20271120003281_issue_3281_r2_one_stop_price_options.sql";

Deno.test("#3281 R2 migration carries one-stop gate, columns, and price_options helper", async () => {
  const text = await Deno.readTextFile(MIG);

  assert(text.includes("v_stop_count < 1 OR v_stop_count > 5"));
  // Self-verify DO $verify$ may mention the old floor as a negative string;
  // live CREATE bodies above it must not keep that gate.
  const executable = text.split("DO $verify$")[0] ?? text;
  assert(!/IF\s+v_stop_count\s*<\s*2\s+OR\s+v_stop_count\s*>\s*5/.test(executable));

  assert(text.includes("ADD COLUMN IF NOT EXISTS price_basis"));
  assert(text.includes("ticket_types_price_unit_coherence_check"));
  assert(text.includes("issue_3281_apply_experience_price_options"));
  assert(text.includes("p_payload->'price_options'"));

  assert(text.includes("CREATE OR REPLACE FUNCTION public.biz_create_experience"));
  assert(text.includes("CREATE OR REPLACE FUNCTION public.biz_publish_experience"));
  assert(text.includes("CREATE OR REPLACE FUNCTION public.biz_update_live_experience"));
});
