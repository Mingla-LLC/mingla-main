/**
 * issue #4522 — the cron never notices, charges or retries a flexible payment
 * row (`kind = 'flex'`): its due, retry and pre-charge notice queries all ask
 * for `kind = 'scheduled'`. A planned row of an order with an open flexible
 * payment is refused by the claim RPC (`flex_payment_in_flight`, pg17 suite
 * issue_4522_flex_payments) and counted as a skip.
 */
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

// #4522 rework F6: `kind` exists only once the #4522 migrations are applied,
// so each filter is added when the schema probe says so (behaviour, both
// ways, in _shared/installments/__tests__/issue_4522_old_schema_tolerance).
Deno.test("due, retry and notice queries exclude flexible payments", () => {
  assertEquals(
    source.split('if (planV2) dueQuery = dueQuery.eq("kind", "scheduled");').length - 1,
    1,
    "due query",
  );
  assertEquals(
    source.split('if (planV2) retryQuery = retryQuery.eq("kind", "scheduled");').length - 1,
    1,
    "retry query",
  );
  assertEquals(
    source.split('if (planV2) noticeQuery = noticeQuery.eq("kind", "scheduled");').length - 1,
    1,
    "notice query",
  );
});
