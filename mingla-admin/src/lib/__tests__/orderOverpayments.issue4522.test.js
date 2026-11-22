// issue #4522 (N5) — Admin's order view lists every overpayment with where its
// refund stands. FAILS-ON-REVERT: drop a state label or the failed flag -> red.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { overpaymentRows } from "../orderOverpayments.js";

describe("#4522 Admin overpayments", () => {
  it("lists held, refunding, failed and refunded overpayments in the order's currency", () => {
    const rows = overpaymentRows({
      currency: "USD",
      overpayments: [
        { overpaymentId: "a", state: "held", reason: "flex_exceeds_balance", refundMinor: 10000, currency: "USD", attempts: 0 },
        { overpaymentId: "b", state: "refund_pending", reason: "superseded_row_collected", refundMinor: 90000, currency: "USD", attempts: 1 },
        { overpaymentId: "c", state: "refund_failed", reason: "late_amount_mismatch", refundMinor: 500, currency: "USD", attempts: 3 },
        { overpaymentId: "d", state: "refunded", reason: "collected_above_row", refundMinor: 15000, currency: "USD", attempts: 1,
          resolvedAt: "2026-11-22T10:00:00Z" },
      ],
    });
    assert.deepEqual(rows.map((r) => [r.id, r.stateLabel, r.needsAttention]), [
      ["a", "Held — refund starting", false],
      ["b", "Refunding", false],
      ["c", "Refund failed — retrying", true],
      ["d", "Refunded", false],
    ]);
    assert.equal(rows[3].resolvedAt, "2026-11-22T10:00:00Z");
    assert.equal(rows[1].reasonLabel, "A cancelled payment was charged");
  });

  it("flags a stopped overpayment (needs_ops) for attention and shows what was returned (T3-2)", () => {
    const rows = overpaymentRows({
      currency: "NGN",
      overpayments: [
        { overpaymentId: "e", state: "needs_ops", reason: "flex_exceeds_balance", refundMinor: 3000, returnedMinor: 0,
          needsOpsReason: "below_provider_minimum", currency: "NGN", attempts: 0 },
        { overpaymentId: "f", state: "refund_pending", reason: "flex_exceeds_balance", refundMinor: 3000000000,
          returnedMinor: 2147483647, currency: "NGN", attempts: 2 },
      ],
    });
    assert.deepEqual(rows.map((r) => [r.id, r.stateLabel, r.needsAttention, r.returnedMinor]), [
      ["e", "Needs ops — automatic refund stopped", true, 0],
      ["f", "Refunding", false, 2147483647],
    ]);
  });

  it("is empty for an order with no v2 balance or no overpayment", () => {
    assert.deepEqual(overpaymentRows(null), []);
    assert.deepEqual(overpaymentRows({ overpayments: [] }), []);
    assert.deepEqual(overpaymentRows({ overpayments: [{ state: "held", refundMinor: 0 }] }), []);
  });
});
