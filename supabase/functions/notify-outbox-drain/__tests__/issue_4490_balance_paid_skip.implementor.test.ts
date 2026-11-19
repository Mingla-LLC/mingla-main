// #4490 P3 fix: a balance reminder is not sent once nothing is left to pay.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { venueBalanceAlreadyPaid } from "../index.ts";

Deno.test("a paid balance skips the due and overdue reminders only", () => {
  assertEquals(
    venueBalanceAlreadyPaid("venue_balance_due", { balance_minor: 0 }),
    true,
  );
  assertEquals(
    venueBalanceAlreadyPaid("venue_balance_overdue", { balance_minor: 0 }),
    true,
  );
  assertEquals(
    venueBalanceAlreadyPaid("venue_balance_due", { balance_minor: 750000 }),
    false,
  );
  assertEquals(
    venueBalanceAlreadyPaid("venue_balance_paid", { balance_minor: 0 }),
    false,
  );
  // facts that could not be read never skip (the email still goes)
  assertEquals(venueBalanceAlreadyPaid("venue_balance_due", {}), false);
});
