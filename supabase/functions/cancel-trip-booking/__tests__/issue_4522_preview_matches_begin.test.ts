/**
 * issue #4522 (D-9) — the cancel preview and the Paystack minimum check compute
 * the refund for the same actor begin uses, so a host's preview includes a
 * non-refundable v2 deposit exactly as the cancel will (otherwise the SC-22
 * freshness check would refuse every host cancel of such a booking).
 *
 * Rework F6: before the #4522 migrations are applied the per-actor function
 * does not exist, so both calls fall back to biz_compute_refund_for_cancel
 * exactly as it was called before #4522.
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { computeRefundForActor } from "../refundEntries.ts";
import {
  alertTripCancelNotFinished,
  alertUnrecordedTripRefund,
  providerRefundsMade,
  resumeTripCancels,
} from "../../_shared/installments/unrecordedRefunds.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

function recorder() {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    client: {
      rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args });
        return Promise.resolve({ data: { ok: true }, error: null });
      },
    },
  };
}

Deno.test("preview and the Paystack floor go through the per-actor computation", () => {
  assertEquals(source.split("computeRefundForActor(").length - 1, 2);
  assertEquals(source.includes('supabase.rpc(\n      "biz_compute_refund_for_cancel"'), false);
  assertStringIncludes(source, 'actorKind: actorKind ?? "buyer",');
});

Deno.test("with the #4522 schema: the per-actor function", async () => {
  const { calls, client } = recorder();
  await computeRefundForActor(client, true, { orderId: "o1", cancelAt: "t", actorKind: "operator" });
  assertEquals(calls, [{
    fn: "issue_4522_compute_refund_for_cancel_as",
    args: { p_order_id: "o1", p_cancel_at: "t", p_actor_kind: "operator" },
  }]);
});

Deno.test("before the #4522 migrations: exactly the pre-#4522 call", async () => {
  const { calls, client } = recorder();
  await computeRefundForActor(client, false, { orderId: "o1", cancelAt: "t", actorKind: "buyer" });
  assertEquals(calls, [{
    fn: "biz_compute_refund_for_cancel",
    args: { p_order_id: "o1", p_cancel_at: "t" },
  }]);
});

Deno.test("E-6: a cancel with nothing to refund skips every provider, ledger and commit step", () => {
  assertStringIncludes(
    source,
    "const noRefund = refundId.length === 0 && computedRefundTotalCents === 0;",
  );
  // the Stripe account is not needed when nothing is sent
  assertStringIncludes(source, 'if (paymentProvider === "stripe" && !connectedAccountId && !noRefund) {');
  // no refund row to commit or finalise
  assertStringIncludes(source, 'await (paymentProvider === "paystack" && !noRefund\n      ? supabase.rpc("biz_cancel_trip_booking_commit"');
  assertStringIncludes(source, 'if (paymentProvider === "paystack" && !noRefund && !commitErr) {');
  // the cancellation notice is keyed by the order, never by an empty refund id
  assertStringIncludes(source, "const cancelNoticeKey = noRefund ? `order:${orderId}` : refundId;");
  assertStringIncludes(source, "idempotency_key: `tr4_cancel:${cancelNoticeKey}:cancelled`,");
});

// Pass 5 (T9-2) — begin refuses while a charge of the booking can still land
// (pg17: issue_4522_refunds_payouts A3); the edge answers 409 with the
// "already processing" reason and nothing is cancelled, so the caller retries.
// FAILS-ON-REVERT: the refusal fell through to a 500 rpc_error.
Deno.test("T9-2: a begin refused for a charge in flight is a 409 balance_payment_in_flight", () => {
  const at = source.indexOf('case "balance_payment_in_flight":');
  assertEquals(at > 0, true);
  const arm = source.slice(at, at + 260);
  assertStringIncludes(arm, 'code: "balance_payment_in_flight"');
  assertStringIncludes(arm, "status: 409");
  assertStringIncludes(arm, "A payment on this trip is already processing");
});

// Pass 6 (S9-1) — a cancel whose provider refunds were made but not recorded
// tells ops once (order, amounts, provider refund ids), keeps the refund
// pending (never "failed": it is still finished from the same provider
// refunds), and rolls back only when the provider moved nothing.
// FAILS-ON-REVERT: the failure arms rolled the refund back to failed and no
// one was told (the s8 finding).

function attemptsClient(card: unknown[], second: unknown[]) {
  const chain = (rows: unknown[]) => {
    const q = {
      select: () => q,
      eq: () => q,
      not: () => q,
      then: (r: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(r),
    };
    return q;
  };
  return { from: (t: string) => chain(t === "ticket_refund_attempts" ? card : second) };
}

Deno.test("S9-1: the ops alert names the order, each charge's amount and provider refund id", async () => {
  const made = await providerRefundsMade(attemptsClient([
    { payment_intent_id: "pi_row1", buyer_refund_id: "re_1", buyer_refund_amount_text: "30000", status: "not_applicable" },
    { payment_intent_id: "pi_dep", buyer_refund_id: "re_2", buyer_refund_amount_text: "30000", status: "pending_visibility" },
  ], [
    { transaction_reference: "mingla-inst-x", provider_refund_id: null, amount_cents: 500, status: "pending" },
  ]), "rf_1");
  assertEquals(made.map((m) => `${m.charge}:${m.amountMinor}:${m.providerRefundId}:${m.recorded}`),
    ["pi_row1:30000:re_1:true", "pi_dep:30000:re_2:false"]);
  const sent: Array<{ subject: string; paragraphs: string[] }> = [];
  await alertUnrecordedTripRefund(async (subject, paragraphs) => {
    sent.push({ subject, paragraphs });
  }, { orderId: "o_1", refundId: "rf_1", currency: "usd", detail: "finalize failed", made });
  assertEquals(sent.length, 1);
  const text = sent[0].paragraphs.join("\n");
  for (const want of ["o_1", "rf_1", "re_1", "re_2", "30000 USD", "finalize failed", "nothing is sent again"]) {
    assertStringIncludes(text, want);
  }
  // nothing moved at the provider: no alert
  await alertUnrecordedTripRefund(async () => {
    throw new Error("must not alert");
  }, { orderId: "o_1", refundId: "rf_1", currency: "usd", detail: "x", made: [] });
});

Deno.test("S9-1: a failed cancel keeps a refund the provider made pending and alerts", () => {
  const loopFail = source.slice(source.indexOf("if (stripeFailureDetail !== null) {"));
  const arm = loopFail.slice(0, loopFail.indexOf("return jsonResponse("));
  assertStringIncludes(arm, "const made = await unrecordedRefundsAlert(stripeFailureDetail);");
  assertStringIncludes(arm, "if (!paystackFailureRetryable) {\n      if (made === 0) {");
  assertStringIncludes(source, "if (await unrecordedRefundsAlert(`ledger_insert_failed: ${insertError.message}`) === 0) {");
  assertStringIncludes(source, "await unrecordedRefundsAlert(`commit_failed: ${commitErr?.message ?? \"not_ok\"}`);");
});

Deno.test("S9-1: the instalment run finishes such a card refund by reading it back, never sending one", async () => {
  const lane = await Deno.readTextFile(new URL("../../_shared/installments/unrecordedRefunds.ts", import.meta.url));
  assertStringIncludes(lane, "allowProviderMutation: false,");
  assertStringIncludes(lane, "requestFingerprint: String(a.request_fingerprint),");
  assertStringIncludes(lane, '"installment_plan_root",');
  const cron = await Deno.readTextFile(new URL("../../process-scheduled-installments/index.ts", import.meta.url));
  const at = cron.indexOf("result.unrecorded_refunds = await finishUnrecordedPlanRefunds(");
  assertEquals(at > 0, true);
  // only with the #4522 schema (on main's database the run behaves as main)
  assertEquals(cron.lastIndexOf("if (planV2 && input.dryRun !== true) {", at) > 0, true);
});

// ---------------------------------------------------------------------------
// issue #4522 G-3 / G-4 — a part-done cancel is always completable.
// ---------------------------------------------------------------------------

Deno.test("G-3/G-4: a cancel with the #4522 operation is never rolled back part-way; it answers in progress", () => {
  // every failure with the operation records a step on it and answers 409 refund_in_progress
  const arm = source.slice(source.indexOf("if (resumable && (stripeFailureDetail !== null || unconfirmedPaystack.length > 0)) {"));
  const block = arm.slice(0, arm.indexOf("return inProgressResponse("));
  assertStringIncludes(block, 'providerStillAnswering ? "waiting" : "failure"');
  assertEquals(block.includes("biz_cancel_trip_booking_rollback"), false);
  assertStringIncludes(source, 'error: "refund_in_progress",');
  // completion is decided by the settled refund row, and is marked once
  assertStringIncludes(source, 'firstCompletion = (await noteTripCancel("completed", null)).first_completion;');
  assertStringIncludes(source, '"issue_4522_settle_trip_cancel_status"');
  // a second-provider refund with no answer is read back, never sent again
  assertStringIncludes(source, "await reconcilePaystackRefund({");
  assertStringIncludes(source, '"issue_4522_claim_trip_paystack_send"');
  // the instalment run's resume mode is service-role only and never starts a cancel
  const resume = source.slice(source.indexOf('} else if (mode === "resume") {'));
  assertStringIncludes(resume.slice(0, 600), "`Bearer ${serviceKey}`");
  assertStringIncludes(resume.slice(0, 900), '"issue_4522_trip_cancel_operation"');
  assertStringIncludes(resume.slice(0, 1100), 'error: "no_cancel_in_progress"');
});

Deno.test("G-3/G-4: the instalment run resumes each cancel in progress through the cancel function", async () => {
  const sent: Array<{ body: Record<string, unknown>; key: string }> = [];
  const rpcs: string[] = [];
  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push(fn);
      if (fn === "issue_4522_trip_cancels_to_resume") {
        return Promise.resolve({ data: ["o_done", "o_wait", "o_gone"], error: null });
      }
      if (fn === "issue_4522_trip_cancel_operation") {
        return Promise.resolve({
          data: args.p_order_id === "o_gone" ? null : { refund_id: `rf_${args.p_order_id}`, amount_cents: 60000 },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  const out = await resumeTripCancels(client, 20, (body, key) => {
    sent.push({ body, key });
    return Promise.resolve(new Response("{}", { status: body.orderId === "o_done" ? 200 : 409 }));
  });
  assertEquals(out, { completed: 1, in_progress: 1, error: 0 });
  assertEquals(sent.map((s) => [s.body.mode, s.body.orderId, s.body.expectedRefundTotalCents, s.key]), [
    ["resume", "o_done", 60000, "trip-cancel-resume:rf_o_done"],
    ["resume", "o_wait", 60000, "trip-cancel-resume:rf_o_wait"],
  ]);
});

Deno.test("G-3/G-4: the one alert says per charge what is true now and what happens next", async () => {
  const sent: Array<{ subject: string; paragraphs: string[] }> = [];
  const alert = async (subject: string, paragraphs: string[]) => {
    sent.push({ subject, paragraphs });
  };
  await alertTripCancelNotFinished(alert, {
    orderId: "o_1", refundId: "rf_1", currency: "usd", detail: "refund refused",
    made: [{ provider: "stripe", charge: "pi_row1", providerRefundId: "re_1", amountMinor: 30000, recorded: true }],
    intended: [
      { installment_id: "row1", source_pi: "pi_row1", refund_cents: 30000 },
      { installment_id: null, source_pi: "pi_dep", refund_cents: 30000 },
    ],
    unconfirmed: [],
    cause: "failure",
  });
  const text = sent[0].paragraphs.join("\n");
  assertEquals(sent[0].subject, "A trip cancel refund could not be finished");
  for (const want of ["o_1", "rf_1", "pi_row1", "refunded and recorded", "pi_dep (deposit): 30000 USD (minor units): not refunded yet",
    "three attempts", "payouts stay held", "repeats the same request", "never sent again"]) {
    assertStringIncludes(text, want);
  }
  await alertTripCancelNotFinished(alert, {
    orderId: "o_2", refundId: "rf_2", currency: "ngn", detail: "no answer",
    made: [], intended: [{ installment_id: null, source_pi: "ref_dep", refund_cents: 3000000 }],
    unconfirmed: ["mingla_trip_refund:rf_2:deposit"], cause: "unconfirmed",
  });
  const text2 = sent[1].paragraphs.join("\n");
  assertStringIncludes(text2, "sent to the provider, no answer yet (never re-sent automatically)");
  assertStringIncludes(text2, "never sends it again automatically");
  assertStringIncludes(text2, "Admin > Money > Refund operations");
  // Pass 8 (P8-2): a failure alert sends staff to Refund operations for a
  // part refused as more than the charge holds (a host retry repeats it).
  assertStringIncludes(text, "Refund operations");
});

// Pass 8 (P8-6): the H-2 alert states each part's real state. A deposit the
// second provider accepted (and the cancel recorded or will record on its
// confirmation) is never called "not yet recorded".
// FAILS ON REVERT: without awaitingConfirmation the deposit line read
// "refunded at the provider, not yet recorded".
Deno.test("P8-6: an accepted deposit is not called unrecorded; a confirmed one is recorded", async () => {
  const sent: string[] = [];
  const alert = async (_s: string, paragraphs: string[]) => {
    sent.push(paragraphs.join("\n"));
  };
  const intended = [
    { installment_id: "row1", source_pi: "ref_row1", refund_cents: 30000000 },
    { installment_id: null, source_pi: "ref_dep", refund_cents: 30000000 },
  ];
  await alertTripCancelNotFinished(alert, {
    orderId: "o_3", refundId: "rf_3", currency: "ngn", detail: "no answer",
    made: [{ provider: "paystack", charge: "ref_dep", providerRefundId: "4522500013", amountMinor: 30000000, recorded: false, awaitingConfirmation: true }],
    intended, unconfirmed: ["mingla_trip_refund:rf_3:row1"], cause: "unconfirmed",
  });
  assertEquals(sent[0].includes("not yet recorded"), false);
  assertStringIncludes(sent[0], "ref_dep (deposit): 30000000 NGN (minor units): accepted by the provider, waiting for its confirmation");
  assertStringIncludes(sent[0], "ref_row1 (instalment row1): 30000000 NGN (minor units): sent to the provider, no answer yet");
  assertStringIncludes(sent[0], "Admin > Money > Refund operations");
  await alertTripCancelNotFinished(alert, {
    orderId: "o_3", refundId: "rf_3", currency: "ngn", detail: "no answer",
    made: [{ provider: "paystack", charge: "ref_dep", providerRefundId: "4522500013", amountMinor: 30000000, recorded: true, awaitingConfirmation: false }],
    intended, unconfirmed: ["mingla_trip_refund:rf_3:row1"], cause: "unconfirmed",
  });
  assertStringIncludes(sent[1], "ref_dep (deposit): 30000000 NGN (minor units): refunded and recorded (provider refund 4522500013)");
});


// Seventh pass (H-1): after an earlier refund of the same charge only what
// is left is refunded, and that amount is always named: a refund of the
// whole charge as made (and only that) may omit it. Driven through the real
// chargeCents the cancel's second-provider branch and its minimum check use.
// FAILS ON REVERT: paid_cents (what is left) equal to the refund omitted the
// amount, a full reversal the provider refuses after a partial refund.
import { chargeCents, paymentRefundEntries } from "../refundEntries.ts";
Deno.test("H-1: an amount is omitted only for a refund of the whole charge as made", () => {
  const [left, whole, legacy] = paymentRefundEntries([
    { installment_id: null, ordinal: 0, source_pi: "ref_dep", paid_cents: 30000000, charge_cents: 42000000, refund_cents: 30000000, currency: "NGN" },
    { installment_id: null, ordinal: 0, source_pi: "ref_full", paid_cents: 50000000, charge_cents: 50000000, refund_cents: 50000000, currency: "NGN" },
    { installment_id: null, ordinal: 0, source_pi: "ref_main", paid_cents: 50000000, refund_cents: 50000000, currency: "NGN" },
  ]);
  assertEquals(left.refund_cents === chargeCents(left), false);
  assertEquals(whole.refund_cents === chargeCents(whole), true);
  // main's database (no charge_cents): exactly as before
  assertEquals(legacy.refund_cents === chargeCents(legacy), true);
  assertStringIncludes(source, "entry.refund_cents === chargeCents(entry)");
});

// Seventh pass (H-1 b): past 24 hours a cancel still waiting says so.
Deno.test("H-1: a cancel still unfinished after 24 hours is one truthful alert", async () => {
  const sent: string[] = [];
  await alertTripCancelNotFinished(async (_s, p) => { sent.push(p.join("\n")); }, {
    orderId: "o_3", refundId: "rf_3", currency: "usd", detail: "fee_truth_awaiting_application_fee",
    made: [], intended: [{ installment_id: null, source_pi: "pi_dep", refund_cents: 30000 }],
    unconfirmed: [], cause: "stuck",
  });
  assertStringIncludes(sent[0], "still not finished 24 hours after the cancel");
  assertStringIncludes(sent[0], "fee_truth_awaiting_application_fee");
  assertStringIncludes(sent[0], "pi_dep (deposit): 30000 USD (minor units): not refunded yet");
});
