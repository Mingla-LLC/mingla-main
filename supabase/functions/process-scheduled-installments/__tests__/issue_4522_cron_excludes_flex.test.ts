/**
 * issue #4522 — the cron never notices, charges or retries a flexible payment
 * row (`kind = 'flex'`): its due, retry and pre-charge notice queries all ask
 * for `kind = 'scheduled'`. A planned row of an order with an open flexible
 * payment is refused by the claim RPC (`flex_payment_in_flight`, pg17 suite
 * issue_4522_flex_payments) and counted as a skip.
 */
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

Deno.test("due, retry and notice queries exclude flexible payments", () => {
  assertEquals(
    source.split('.eq("status", "scheduled").eq("kind", "scheduled")').length -
      1,
    1,
    "due query",
  );
  assertEquals(
    source.split('.eq("status", "failed").eq("kind", "scheduled")').length - 1,
    1,
    "retry query",
  );
  assertEquals(
    source.split(
      '.eq("kind", "scheduled")\n    .is("cancelled_at", null)\n    .is("pre_charge_notice_sent_at", null)',
    ).length - 1,
    1,
    "notice query",
  );
});
