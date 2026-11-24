// MINGLA-INVARIANT: I-4522-TRIP-CANCEL-OPS-QUEUE | issue #4522 | A second-provider trip cancel refund sent and never answered is its own Refund operations row (Trip cancel, part unconfirmed; amount still unconfirmed; provider; Waiting N h); recording it needs a provider refund reference and a 3-500 character reason; before its migration is applied the queue reads exactly as before.
// Issue #4522 (H-2 ops tool): the row model, the panel's validation and
// words, and the deploy window of the Refund operations queue.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  queueRowModel,
  TRIP_CANCEL_OUTCOMES,
  tripCancelChargeRows,
  tripCancelErrorMessage,
  tripCancelQueueItems,
  validateTripCancelResolution,
  waitingHours,
} from "../lib/refundOperationsView.js";
import {
  isSessionExpiredError,
  listUnansweredTripCancelRefunds,
  resolveTripCancelRefund,
} from "../services/refundOperationsService.js";

const panelSource = readFileSync(
  new URL("../components/refunds/TripCancelRefundPanel.jsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../pages/RefundOperationsPage.jsx", import.meta.url),
  "utf8",
);

const NOW = Date.parse("2026-11-23T12:00:00Z");
const stuck = {
  refund_id: "11111111-1111-4111-8111-111111111111",
  order_id: "22222222-2222-4222-8222-222222222222",
  trip_name: "Lagos to Accra",
  currency: "ngn",
  provider: "paystack",
  unconfirmed_amount_cents: 30600000,
  waiting_since: new Date(NOW - 5 * 3_600_000 - 60_000).toISOString(),
  escalated: false,
  charges: [
    { attempt_id: "a-dep", part: "deposit", ordinal: null, amount_cents: 30000000, currency: "ngn", state: "recorded", actionable: false },
    { attempt_id: "a-1", part: "row-1", ordinal: 1, amount_cents: 30600000, currency: "ngn", state: "unanswered", actionable: true },
  ],
};

test("a stuck trip cancel is its own queue row with the amount still unconfirmed and how long it waited", () => {
  const items = tripCancelQueueItems([stuck, null, { nope: true }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].itemKind, "trip_cancel_refund");
  const realNow = Date.now;
  Date.now = () => NOW;
  try {
    const row = queueRowModel(items[0]);
    assert.equal(row.source, "Trip cancel, part unconfirmed");
    assert.equal(row.amountCents, 30600000);
    assert.equal(row.currency, "NGN");
    assert.equal(row.provider, "Paystack");
    assert.equal(row.ops, "Waiting 5 h");
    assert.equal(row.key, `trip_cancel_refund:${stuck.refund_id}`);
    assert.equal(queueRowModel({ ...items[0], safeSummary: { ...stuck, escalated: true } }).ops, "Escalated");
  } finally {
    Date.now = realNow;
  }
  assert.equal(waitingHours(null, NOW), null);
  assert.equal(waitingHours("not a date", NOW), null);
});

test("each charge shows Deposit / Payment N with Refunded, recorded or Sent, no answer", () => {
  const rows = tripCancelChargeRows(stuck);
  assert.deepEqual(rows.map((r) => [r.label, r.stateLabel, r.actionable]), [
    ["Deposit", "Refunded, recorded", false],
    ["Payment 1", "Sent, no answer", true],
  ]);
});

test("recording needs a provider refund reference; every action needs a 3-500 character reason", () => {
  assert.deepEqual(Object.keys(validateTripCancelResolution({ outcome: "refunded_at_provider", reference: "  ", reason: "Paystack shows it" })), ["reference"]);
  assert.deepEqual(Object.keys(validateTripCancelResolution({ outcome: "refunded_at_provider", reference: "rf_1", reason: " a " })), ["reason"]);
  assert.deepEqual(Object.keys(validateTripCancelResolution({ outcome: "escalate", reference: "", reason: "x".repeat(501) })), ["reason"]);
  assert.equal(validateTripCancelResolution({ outcome: "escalate", reference: "", reason: "No refund in Paystack" }), null);
  assert.equal(validateTripCancelResolution({ outcome: "refunded_at_provider", reference: "rf_1", reason: "Paystack shows it" }), null);
  assert.ok(validateTripCancelResolution({ outcome: "write_off", reference: "rf_1", reason: "Paystack shows it" }).outcome);
});

test("server refusals read in plain words", () => {
  assert.match(tripCancelErrorMessage(new Error("provider_refund_reference_already_used")), /already recorded on another refund/);
  assert.match(tripCancelErrorMessage(new Error("trip_cancel_refund_too_recent")), /15 minutes/);
  assert.match(tripCancelErrorMessage(new Error("something else")), /could not be applied/);
});

test("before the migration is applied the queue lists no trip cancels and raises nothing", async () => {
  for (const code of ["PGRST202", "42883"]) {
    const rows = await listUnansweredTripCancelRefunds(async () => ({ data: null, error: { code, message: "missing" }, status: 404 }));
    assert.deepEqual(rows, []);
  }
  await assert.rejects(
    listUnansweredTripCancelRefunds(async () => ({ data: null, error: { code: "42501", message: "not_authorized" }, status: 403 })),
    /not_authorized/,
  );
});

test("an expired session on the new calls is the page's session-expiry case", async () => {
  const err = await listUnansweredTripCancelRefunds(async () => ({ data: null, error: { code: "PGRST303", message: "JWT expired" }, status: 401 }))
    .catch((caught) => caught);
  assert.equal(isSessionExpiredError(err), true);
});

test("escalate sends no reference; record sends the reference, amount and currency shown", async () => {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push([name, args]);
    return { data: { ok: true }, error: null, status: 200 };
  };
  await resolveTripCancelRefund({ attemptId: "a-1", outcome: "escalate", reference: "rf_1", reason: "No refund", amountCents: 1, currency: "ngn" }, rpc);
  await resolveTripCancelRefund({ attemptId: "a-1", outcome: "refunded_at_provider", reference: "rf_1", reason: "Shows it", amountCents: 30600000, currency: "ngn" }, rpc);
  assert.equal(calls[0][0], "issue_4522_resolve_trip_cancel_refund_by_ops");
  assert.equal(calls[0][1].p_provider_refund_reference, null);
  assert.deepEqual(calls[1][1], {
    p_attempt_id: "a-1",
    p_outcome: "refunded_at_provider",
    p_provider_refund_reference: "rf_1",
    p_reason: "Shows it",
    p_amount_cents: 30600000,
    p_currency: "ngn",
  });
});

test("the panel carries the approved choices, buttons and note, and validates before sending", () => {
  assert.deepEqual(TRIP_CANCEL_OUTCOMES.map((o) => o.label), [
    "Paystack shows it refunded: record it",
    "Paystack shows no refund: escalate (nothing is re-sent from here)",
  ]);
  for (const words of [
    "Record refund and finish cancel",
    ">\n                  Escalate\n",
    "Finishing sends the traveler their refund email and updates the host's payout.",
    "Paystack refund reference",
    "Reason (saved on the refund)",
  ]) {
    assert.ok(panelSource.includes(words), words);
  }
  assert.match(panelSource, /validateTripCancelResolution\(\{ outcome: chosen, reference, reason \}\)/);
  assert.match(panelSource, /variant="primary"[^<]*?onClick=\{\(\) => submit\("refunded_at_provider"\)\}[^<]*?>\s*Record refund and finish cancel/);
  assert.match(pageSource, /listUnansweredTripCancelRefunds\(\)/);
  assert.match(pageSource, /<TripCancelRefundPanel/);
});

// Pass 8 (P8-6): the Amount and State columns never run together
// ("NGN 300,000.00Refunded, recorded"): each side of the gap is padded in the
// header and in every row. FAILS ON REVERT: the bare "py-1" cells had no gap.
test("the charge table keeps a gap between Amount and State", () => {
  assert.match(panelSource, /<th className="py-1 pr-8 text-right">Amount<\/th>/);
  assert.match(panelSource, /<th className="py-1 pl-8">State<\/th>/);
  assert.match(panelSource, /<td className="py-1 pr-8 text-right tabular-nums whitespace-nowrap">/);
  assert.match(panelSource, /<td className="py-1 pl-8">\s*\{charge\.stateLabel\}/);
});
