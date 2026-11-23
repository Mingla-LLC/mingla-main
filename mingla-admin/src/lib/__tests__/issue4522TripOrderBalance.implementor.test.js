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
  providerMinimumMinor: 50,
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

  it("shows a balance below the provider minimum as still owed and Scheduled, never written off", () => {
    const view = tripOrderBalanceView(balance({
      remainingMinor: 30, paidMinor: 119970, totalMinor: 120000,
      rows: [{ installmentId: "w", ordinal: 1, kind: "scheduled", status: "scheduled", dueAt: "2027-02-10T09:00:00Z",
        amountMinor: 30, scheduleVersion: 2, provider: "stripe", collectionMethod: "auto_card" }],
    }));
    assert.equal(view.rows[0].statusLabel, "Scheduled");
    assert.equal(view.rows[0].amountMinor, 30);
    assert.equal(view.remainingMinor, 30);
    assert.equal(view.belowProviderMinimum, true);
    assert.equal("waivedMinor" in view, false);
    assert.equal(tripOrderBalanceView(balance()).belowProviderMinimum, false);
  });

  it("gives no v2 view to an older plan or a non-trip order", () => {
    assert.equal(tripOrderBalanceView(balance({ terms: null })), null);
    assert.equal(tripOrderBalanceView(balance({ terms: { v: 1 } })), null);
    assert.equal(tripOrderBalanceView(null), null);
  });
});

// issue #4522 deploy window — Admin deploys before the migrations are applied.
// FAILS-ON-REVERT: a missing admin_trip_order_balance (main's database) shown
// as an error, or a real failure silently read as "no plan".
import { readTripOrderBalanceResult } from "../tripOrderBalance.js";
import { readFileSync } from "node:fs";

describe("#4522 deploy window — admin_trip_order_balance on main's database", () => {
  it("a missing function is main's view: no balance, no error", () => {
    for (const error of [
      { code: "PGRST202", message: "Could not find the function public.admin_trip_order_balance(p_order_id) in the schema cache" },
      { code: "42883", message: "function public.admin_trip_order_balance(uuid) does not exist" },
    ]) {
      assert.deepEqual(readTripOrderBalanceResult({ data: null, error }), { balance: null, error: null });
    }
    assert.equal(tripOrderBalanceView(readTripOrderBalanceResult({ data: null, error: { code: "PGRST202" } }).balance), null);
  });

  it("a real failure is reported, not swallowed", () => {
    const out = readTripOrderBalanceResult({ data: null, error: { code: "XX000", message: "boom" } });
    assert.equal(out.balance, null);
    assert.equal(out.error, "Couldn't load this order's payment plan. Reload to try again.");
  });

  it("once the function exists the v2 view switches on", () => {
    const out = readTripOrderBalanceResult({ data: balance(), error: null });
    assert.equal(out.error, null);
    assert.notEqual(tripOrderBalanceView(out.balance), null);
  });

  it("the page reads the balance through the result (old view on null)", () => {
    const page = readFileSync(new URL("../../pages/BusinessOrdersPage.jsx", import.meta.url), "utf8");
    assert.match(page, /tripBalance\?\.balance \?\? null, tripBalance\?\.error \?\? null/);
    const service = readFileSync(new URL("../../services/adminMoneyService.js", import.meta.url), "utf8");
    assert.match(service, /readTripOrderBalanceResult\(\s*await supabase\.rpc\("admin_trip_order_balance"/);
    assert.match(service, /readAddOnLinesResult\(\s*await supabase\.rpc\("admin_order_add_on_lines"/);
  });
});
