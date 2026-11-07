// Issue #4271 (PR #4303, tester P3-4): the Admin refund window handles a refund
// the server committed 'failed', and never says "no money moved" when the
// outcome is unknown.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  adminRefundErrorCopy,
  describeAdminRefundError,
} from "../lib/adminRefundError.js";

const pageSource = readFileSync(
  new URL("../pages/BusinessOrdersPage.jsx", import.meta.url),
  "utf8",
);

test("a refund the server committed failed reads as failed and spends the key", () => {
  const fromThrow = describeAdminRefundError({
    error: "stripe_declined",
    detail: "permission denied",
    refund_id: "r1",
    refund_outcome: "failed",
  });
  assert.deepEqual(fromThrow, {
    code: "refund_failed",
    message: "The refund didn't go through, so nothing was refunded. Try again.",
    keySpent: true,
  });
  const fromReplay = describeAdminRefundError({
    error: "refund_failed",
    detail: "This refund did not go through and nothing was refunded. Start a new refund.",
    refund_outcome: "failed",
  });
  assert.equal(fromReplay.code, "refund_failed");
  assert.equal(fromReplay.keySpent, true);
  assert.equal(fromReplay.message, adminRefundErrorCopy("refund_failed"));
});

test("an unknown outcome never claims no money moved and keeps the key", () => {
  const unknown = describeAdminRefundError({
    error: "stripe_declined",
    refund_outcome: "unknown",
  });
  assert.equal(unknown.code, "stripe_declined");
  assert.equal(unknown.keySpent, false, "a pending row is retried under its own key");
  assert.doesNotMatch(unknown.message, /no money moved|nothing was refunded/i);
  assert.match(unknown.message, /may still go through/);
});

test("a Stripe refund that came back failed still reads as declined", () => {
  const declined = describeAdminRefundError({ error: "stripe_declined" });
  assert.equal(declined.message, "Stripe declined — no money moved.");
  assert.equal(declined.keySpent, false);
  assert.equal(describeAdminRefundError(null).message, null);
  assert.equal(describeAdminRefundError({ error: "line_overrefund" }).keySpent, false);
});

test("the refund window rotates its key only when the refund is spent", () => {
  assert.match(
    pageSource,
    /const \[idempotencyKey, setIdempotencyKey\] = useState\(createAdminRefundIdempotencyKey\);/,
  );
  assert.match(
    pageSource,
    /if \(described\.keySpent\) setIdempotencyKey\(createAdminRefundIdempotencyKey\(\)\);/,
  );
  assert.match(pageSource, /describeAdminRefundError\(body\)/);
  assert.doesNotMatch(pageSource, /function refundErrorCopy\(/, "one copy table, in the helper");
});
