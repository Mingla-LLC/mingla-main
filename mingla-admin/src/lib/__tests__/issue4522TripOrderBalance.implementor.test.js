// issue #4522 S-13 (spec §12) — Admin's order view of a plan-v2 trip order.
// FAILS-ON-REVERT: a closed flexible attempt listed as an instalment, a row
// without its provider / method, a rebalanced row shown as raw "superseded",
// a v1 order given the v2 view, or the terms / balance / history dropped.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tripOrderBalanceView } from "../tripOrderBalance.js";

// The jsonb admin_trip_order_balance returns (issue_4522_balance || rows).
const balance = (overrides = {}) => ({
  orderId: "c2450000-0000-4000-8000-00000000a003",
  currency: "USD",
  depositMinor: 30000,
  paidMinor: 40000,
  remainingMinor: 80000,
  totalMinor: 120000,
  terms: {
    v: 2, final_due_at: "2027-02-10T00:00:00Z", trip_start_at: "2027-03-12T00:00:00Z",
    auto_adjust: true, flex_enabled: true, min_payment_minor: 9000, deposit_minor: 30000,
    deposit_non_refundable: true, addon_payment_mode: null, count_offered: 3, count_given: 3,
  },
  waivedMinor: 0,
  paymentInFlight: false,
  overpayments: [],
  balanceEvents: [
    { reason: "missed_rollover", triggerInstallmentId: "r1", createdAt: "2026-11-19T09:05:00Z", before: {}, after: {} },
    { reason: "flex_payment", triggerInstallmentId: "fx", createdAt: "2026-11-22T09:01:30Z", before: {}, after: {} },
  ],
  rows: [
    { installmentId: "r1", ordinal: 1, kind: "scheduled", status: "superseded", dueAt: "2026-11-10T09:00:00Z", amountMinor: 30000,
      addonPortionMinor: 0, scheduleVersion: 1, supersededAt: "2026-11-19T09:05:00Z", refundedMinor: 0,
      provider: "stripe", collectionMethod: "auto_card", buyerTotalMinor: null, failureReason: "card_declined" },
    { installmentId: "r2", ordinal: 2, kind: "scheduled", status: "scheduled", dueAt: "2027-01-15T09:00:00Z", amountMinor: 40000,
      addonPortionMinor: 4500, scheduleVersion: 3, supersededAt: null, refundedMinor: 0,
      provider: "stripe", collectionMethod: "auto_card", buyerTotalMinor: null, failureReason: null },
    { installmentId: "r3", ordinal: 3, kind: "scheduled", status: "scheduled", dueAt: "2027-02-10T09:00:00Z", amountMinor: 40000,
      addonPortionMinor: 0, scheduleVersion: 3, supersededAt: null, refundedMinor: 0,
      provider: "stripe", collectionMethod: "auto_card", buyerTotalMinor: null, failureReason: null },
    { installmentId: "fx-closed", ordinal: 4, kind: "flex", status: "superseded", dueAt: "2026-11-21T09:00:00Z", amountMinor: 10000,
      addonPortionMinor: 0, scheduleVersion: 1, supersededAt: "2026-11-21T09:02:00Z", refundedMinor: 0,
      provider: "stripe", collectionMethod: "auto_card", buyerTotalMinor: null, failureReason: "provider_create_failed" },
    { installmentId: "fx", ordinal: 5, kind: "flex", status: "collected", dueAt: "2026-11-22T09:00:00Z", amountMinor: 10000,
      addonPortionMinor: 0, scheduleVersion: 1, supersededAt: null, refundedMinor: 0,
      provider: "stripe", collectionMethod: "auto_card", buyerTotalMinor: null, failureReason: null },
  ],
  ...overrides,
});

describe("#4522 S-13 Admin plan-v2 order view", () => {
  it("lists the plan's rows with kind, status, version, add-on share, provider and method; no closed attempt", () => {
    const view = tripOrderBalanceView(balance());
    assert.deepEqual(view.rows.map((r) => [r.id, r.kind, r.statusLabel, r.scheduleVersion]), [
      ["r1", "Scheduled payment", "Rebalanced", 1],
      ["r2", "Scheduled payment", "Scheduled", 3],
      ["r3", "Scheduled payment", "Scheduled", 3],
      ["fx", "Partial payment", "Partial", 1],
    ]);
    assert.ok(view.rows.every((r) => r.provider === "stripe" && r.collectionMethod === "auto_card"));
    assert.equal(view.rows[1].addonPortionMinor, 4500);
    assert.ok(!view.rows.some((r) => r.statusLabel === "superseded"));
  });

  it("carries the terms, the server's balance and the history", () => {
    const view = tripOrderBalanceView(balance());
    assert.equal(view.terms.version, 2);
    assert.equal(view.terms.countGiven, 3);
    assert.equal(view.terms.flexEnabled, true);
    assert.equal(view.terms.minPaymentMinor, 9000);
    assert.equal(view.terms.depositNonRefundable, true);
    assert.deepEqual([view.paidMinor, view.remainingMinor, view.totalMinor], [40000, 80000, 120000]);
    assert.deepEqual(view.history.map((e) => e.label), [
      "Missed payment moved to later payments.",
      "Traveler paid part of the balance. Remaining payments updated.",
    ]);
  });

  it("shows a remainder written off below the provider minimum as written off", () => {
    const view = tripOrderBalanceView(balance({
      remainingMinor: 0, paidMinor: 120000, waivedMinor: 30,
      rows: [{ installmentId: "w", ordinal: 1, kind: "scheduled", status: "superseded", dueAt: "2027-02-10T09:00:00Z",
        amountMinor: 30, scheduleVersion: 2, provider: "stripe", collectionMethod: "auto_card",
        failureReason: "waived_below_provider_minimum" }],
    }));
    assert.equal(view.rows[0].statusLabel, "Written off");
    assert.equal(view.waivedMinor, 30);
    assert.equal(view.remainingMinor, 0);
  });

  it("gives no v2 view to an older plan or a non-trip order", () => {
    assert.equal(tripOrderBalanceView(balance({ terms: null })), null);
    assert.equal(tripOrderBalanceView(balance({ terms: { v: 1 } })), null);
    assert.equal(tripOrderBalanceView(null), null);
  });
});
