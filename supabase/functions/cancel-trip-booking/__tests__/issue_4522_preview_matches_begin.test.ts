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
  alertUnrecordedTripRefund,
  providerRefundsMade,
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
  assertStringIncludes(arm, "if (!paystackFailureRetryable && made === 0) {");
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
