// Issue #3645 — I-3645-BOTH-2: retry dates anchored to due_at (same table as the
// SQL mirror in issue_3645_paystack_attempts.implementor.happy.pg17.test.sql).
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { isAtRiskAfterFailure, MAX_RETRY_ATTEMPTS, nextRetryAtAfterFailure } from "../installmentRetrySchedule.ts";
import { MAX_RETRY_ATTEMPTS as PI_MAX } from "../createInstallmentPI.ts";

const DUE = "2027-03-01T12:00:00.000Z";
const CASES: Array<[number, string, string | null, string]> = [
  [1, "2027-03-01T13:00:00.000Z", "2027-03-04T12:00:00.000Z", "retry 1 = due + 3 days"],
  [2, "2027-03-04T13:00:00.000Z", "2027-03-08T12:00:00.000Z", "retry 2 = due + 7 days (not day 10)"],
  [3, "2027-03-08T13:00:00.000Z", null, "third failure = at risk"],
  [1, "2027-03-05T00:00:00.000Z", "2027-03-05T06:00:00.000Z", "late first attempt = now + 6h"],
  [2, "2027-03-08T12:00:00.000Z", "2027-03-08T18:00:00.000Z", "exactly at the anchor counts as past"],
  [0, "2027-03-01T13:00:00.000Z", null, "not a failure"],
];

for (const [count, now, expected, label] of CASES) {
  Deno.test(`#3645 retry schedule: ${label}`, () => {
    assertEquals(nextRetryAtAfterFailure(DUE, count, new Date(now)), expected);
  });
}

Deno.test("#3645 retry schedule: at risk on the third failure; createInstallmentPI re-exports the same constant", () => {
  assertEquals(MAX_RETRY_ATTEMPTS, 3);
  assertEquals(PI_MAX, 3);
  assertEquals(isAtRiskAfterFailure(2), false);
  assertEquals(isAtRiskAfterFailure(3), true);
});

Deno.test("#3645 retry schedule: the Stripe owners use the anchored rule (no +72h/+168h-from-now cadence left)", async () => {
  for (const path of ["../createInstallmentPI.ts", "../../installmentWebhookHandlers.ts"]) {
    const src = await Deno.readTextFile(new URL(path, import.meta.url));
    assertEquals(/RETRY_INTERVAL_HOURS_BY_RETRY_COUNT|nextRetryAtFor\(/.test(src), false, path);
    assertEquals(src.includes("nextRetryAtAfterFailure("), true, path);
  }
});
