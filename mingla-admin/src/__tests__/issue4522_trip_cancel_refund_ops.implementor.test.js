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
    "Paystack shows it partly refunded already: ask only for what is left",
    "Paid to the traveler outside Paystack: record it",
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
  assert.match(panelSource, /validateTripCancelResolution\(\{\s*outcome: chosen,\s*reference,\s*reason,/);
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

// Pass 8 (P8-2): a part Paystack refused (another refund of the payment was
// made, its answer lost) is finished by saying what Paystack already shows
// refunded; the cancel then asks only for what is left.
test("P8-2: a refused part offers 'partly refunded already' and needs the amount and the other refund's reference", async () => {
  const { majorToMinor } = await import("../lib/refundOperationsView.js");
  const refused = {
    ...stuck,
    charges: [{ attempt_id: "a-9", part: "deposit", ordinal: null, amount_cents: 100000000, currency: "ngn",
      state: "refused", actionable: true, outcomes: ["refunded_elsewhere", "escalate"], charge_cents: 100000000 }],
  };
  const [row] = tripCancelChargeRows(refused);
  assert.deepEqual([row.stateLabel, row.outcomes, row.chargeCents], ["Refused by Paystack", ["refunded_elsewhere", "escalate"], 100000000]);
  assert.equal(majorToMinor("500,000.00"), 50000000);
  assert.equal(majorToMinor("12.5"), 1250);
  assert.equal(majorToMinor("-1"), null);
  assert.deepEqual(Object.keys(validateTripCancelResolution({ outcome: "refunded_elsewhere", reference: "", reason: "Paystack lists the seat refund", refundedElsewhere: "", chargeCents: 100000000 })).sort(), ["reference", "refundedElsewhere"]);
  // Pass 9 (GAP): the whole payment is accepted (nothing left to send); more never is.
  assert.ok(validateTripCancelResolution({ outcome: "refunded_elsewhere", reference: "PS1", reason: "Paystack lists the seat refund", refundedElsewhere: "1000000.01", chargeCents: 100000000 }).refundedElsewhere);
  assert.equal(validateTripCancelResolution({ outcome: "refunded_elsewhere", reference: "PS1", reason: "Paystack lists the whole payment refunded", refundedElsewhere: "1000000", chargeCents: 100000000 }), null);
  assert.equal(validateTripCancelResolution({ outcome: "refunded_elsewhere", reference: "PS1", reason: "Paystack lists the seat refund", refundedElsewhere: "500000", chargeCents: 100000000 }), null);
  assert.ok(TRIP_CANCEL_OUTCOMES.some((o) => o.value === "refunded_elsewhere"));
  assert.match(panelSource, /Ask only for what is left/);
  assert.match(pageSource, /asks Paystack only for what is left/);
});

test("P10-2: 'partly refunded already' goes to the edge function (Paystack's list is checked), never straight to the database", async () => {
  const calls = [];
  const invokes = [];
  const rpc = async (fn, args) => { calls.push([fn, args]); return { data: { ok: true }, error: null, status: 200 }; };
  const invoke = async (fn, options) => { invokes.push([fn, options]); return { data: { ok: true }, error: null }; };
  await resolveTripCancelRefund({ attemptId: "a-9", outcome: "refunded_elsewhere", reference: "PS1", reason: "Seat refund", amountCents: 100000000, currency: "ngn", refundedElsewhereCents: 50000000 }, rpc, invoke);
  await resolveTripCancelRefund({ attemptId: "a-9", outcome: "escalate", reference: "PS1", reason: "No refund", amountCents: 1, currency: "ngn", refundedElsewhereCents: 5 }, rpc, invoke);
  assert.equal(invokes.length, 1);
  assert.equal(invokes[0][0], "cancel-trip-booking");
  assert.deepEqual(invokes[0][1].body, { mode: "ops_refunded_elsewhere", attemptId: "a-9", reference: "PS1", reason: "Seat refund", amountCents: 100000000, currency: "ngn", refundedElsewhereCents: 50000000 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].p_outcome, "escalate");
  assert.equal("p_refunded_elsewhere_cents" in calls[0][1], false);
});

test("P10-2: the edge function's refusals read in plain words (unknown reference names it; unreadable list says retry)", async () => {
  const fail = (payload, status) => async () => ({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: { status, json: async () => payload } } });
  const notFound = await resolveTripCancelRefund({ attemptId: "a", outcome: "refunded_elsewhere", reference: "X9", reason: "abc", refundedElsewhereCents: 1 }, null,
    fail({ error: "provider_refund_reference_not_found", message: "Paystack shows no refund with reference X9 on this payment, so nothing was recorded. Check the reference in the Paystack dashboard." }, 422)).catch((e) => e);
  assert.equal(tripCancelErrorMessage(notFound), "Paystack shows no refund with reference X9 on this payment, so nothing was recorded. Check the reference in the Paystack dashboard.");
  const mismatch = await resolveTripCancelRefund({ attemptId: "a", outcome: "refunded_elsewhere", reference: "X9", reason: "abc", refundedElsewhereCents: 1 }, null,
    fail({ error: "refunded_elsewhere_amount_mismatch" }, 422)).catch((e) => e);
  assert.match(tripCancelErrorMessage(mismatch), /not what Paystack shows for this refund/);
  const down = await resolveTripCancelRefund({ attemptId: "a", outcome: "refunded_elsewhere", reference: "X9", reason: "abc", refundedElsewhereCents: 1 }, null,
    fail({ error: "provider_refund_list_unreadable" }, 503)).catch((e) => e);
  assert.match(tripCancelErrorMessage(down), /could not be read just now, so nothing was recorded. Try again/);
});

test("P10-3: an owed part below Paystack's minimum offers 'paid outside Paystack' (reference and reason required) or escalate", async () => {
  const [row] = tripCancelChargeRows({ currency: "ngn", charges: [{ attempt_id: "b-1", part: "deposit", amount_cents: 3000, currency: "ngn",
    state: "below_minimum", actionable: true, outcomes: ["paid_outside_provider", "escalate"] }] });
  assert.deepEqual([row.stateLabel, row.actionable, row.outcomes], ["Below Paystack's minimum, not sent", true, ["paid_outside_provider", "escalate"]]);
  assert.ok(TRIP_CANCEL_OUTCOMES.some((o) => o.value === "paid_outside_provider"));
  assert.deepEqual(Object.keys(validateTripCancelResolution({ outcome: "paid_outside_provider", reference: " ", reason: "" })).sort(), ["reason", "reference"]);
  assert.equal(validateTripCancelResolution({ outcome: "paid_outside_provider", reference: "BANK-1", reason: "Paid by bank transfer" }), null);
  const calls = [];
  const rpc = async (fn, args) => { calls.push([fn, args]); return { data: { ok: true }, error: null, status: 200 }; };
  await resolveTripCancelRefund({ attemptId: "b-1", outcome: "paid_outside_provider", reference: "BANK-1", reason: "Paid by bank transfer", amountCents: 3000, currency: "ngn" }, rpc, async () => assert.fail("no edge call"));
  assert.equal(calls[0][0], "issue_4522_resolve_trip_cancel_refund_by_ops");
  assert.equal(calls[0][1].p_outcome, "paid_outside_provider");
  assert.equal(calls[0][1].p_provider_refund_reference, "BANK-1");
  const model = queueRowModel({ itemKind: "trip_cancel_refund", itemId: "r-b", safeSummary: { refund_id: "r-b", currency: "ngn", provider: "paystack",
    unconfirmed_amount_cents: 0, refused_amount_cents: 0, below_minimum_amount_cents: 3000, waiting_since: new Date().toISOString() } });
  assert.match(JSON.stringify(model), /below Paystack's minimum/);
  assert.match(JSON.stringify(model), /30\.00|3,000|3000/);
});
