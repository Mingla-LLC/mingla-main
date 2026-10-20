/**
 * issue #3281 Round 2c — structural pins on checkout units migration.
 * Fails on revert of columns, slot helper, unit pricing, options[], admits_count.
 */
// MINGLA-INVARIANT: I-PROPOSED-3281-CHECKOUT-UNITS | issue #3281 | person/group/block checkout stores end+party, prices by unit, and exposes options[]
import { assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

const MIG =
  "supabase/migrations/20271121003281_issue_3281_r2_checkout_units.sql";

Deno.test("#3281 R2c migration carries columns, units, options, and forwards end/party", async () => {
  const text = await Deno.readTextFile(MIG);

  assert(text.includes("ADD COLUMN IF NOT EXISTS booked_end_at"));
  assert(text.includes("ADD COLUMN IF NOT EXISTS booked_party_size"));
  assert(text.includes("ADD COLUMN IF NOT EXISTS admits_count"));
  assert(text.includes("issue_3281_ticket_type_slot_taken"));
  assert(text.includes("pg_experience_booking_quote"));
  assert(text.includes("booked_length_invalid"));
  assert(text.includes("booked_party_invalid"));
  assert(text.includes("slot_full"));
  assert(text.includes("'options'"));
  assert(text.includes("price_basis IN ('group', 'block')"));
  assert(text.includes("admits_count"));

  // Wrapper must forward end + party into the base (not drop them).
  assert(
    text.includes(
      "p_booked_start_at,p_booked_end_at,p_booked_party_size);",
    ),
  );
  assert(
    text.includes(
      "p_booked_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_booked_party_size integer DEFAULT NULL::integer)",
    ),
  );
});
