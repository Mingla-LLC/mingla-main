// MINGLA-INVARIANT: I-4522-FLEX-RELEASE-VERIFIED | issue #4522 | An open flexible payment is released only with the provider's own answer (a Stripe PaymentIntent read back as canceled, a Paystack transaction verified failed, or no charge ever presented); a success is settled through the webhook's success path, and anything still in flight is kept and flagged for ops past 24 hours.
/**
 * issue #4522 (rework N3, N2) — mocked providers, no network.
 *
 * N3: verifyOpenFlexPayments for every Stripe status and Paystack outcome,
 * the 24-hour ceiling, and "no charge ever presented".
 * N2: returnOverpayment — Stripe partial refund of the PaymentIntent and
 * Paystack partial refund of the transaction, with the attempt's key; a
 * timeout keeps the same key (never a second refund); a refusal is failed;
 * the third failure stops the lane and alerts ops (T3-2). The pending /
 * verify paths are in issue_4522_overpayment_refund_once.implementor.test.ts.
 * T3-5: Paystack "abandoned" is kept, released only past 24 hours.
 *
 * FAILS-ON-REVERT: release on time (call the release RPC without asking the
 * provider) or send a refund with a fresh key on a timeout -> red.
 */
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  type FlexToVerify,
  FLEX_IN_FLIGHT_CEILING_MS,
  FLEX_RECLAIM_WINDOW_MS,
  verifyOpenFlexPayments,
} from "../flexReclaim.ts";
import { isDefinitiveStripeRefusal, returnOverpayment } from "../overpaymentRefunds.ts";

type Call = { fn: string; args?: Record<string, unknown> };

function rpcStub(answers: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      rpc(fn: string, args?: Record<string, unknown>) {
        calls.push({ fn, args });
        const a = answers[fn];
        const data = typeof a === "function" ? (a as (x?: Record<string, unknown>) => unknown)(args) : a;
        return Promise.resolve({ data: data ?? { ok: true, released: true }, error: null });
      },
    },
  };
}

const stripeRow = (over: Partial<FlexToVerify> = {}): FlexToVerify => ({
  installmentId: "flex-1",
  orderId: "order-1",
  provider: "stripe",
  stripePaymentIntentId: "pi_1",
  attemptReference: null,
  attemptCount: 0,
  pastCeiling: false,
  ...over,
});

function deps(rpc: ReturnType<typeof rpcStub>, piStatus: string, cancelStatus = "canceled", cancelThrows = false) {
  const log: string[] = [];
  return {
    log,
    d: {
      supabase: rpc.client,
      stripe: () => ({
        paymentIntents: {
          retrieve: (id: string) => {
            log.push(`retrieve:${id}`);
            return Promise.resolve({ id, status: piStatus });
          },
          cancel: (id: string, _p: Record<string, unknown>, o: { idempotencyKey: string }) => {
            log.push(`cancel:${id}:${o.idempotencyKey}`);
            return cancelThrows ? Promise.reject(new Error("too late")) : Promise.resolve({ id, status: cancelStatus });
          },
        },
      }),
      stripeAccountFor: () => Promise.resolve("acct_1"),
      settleStripe: (pi: Record<string, unknown>) => {
        log.push(`settle:${pi.id}`);
        return Promise.resolve();
      },
      paystackVerify: (ref: string) => {
        log.push(`verify:${ref}`);
        return Promise.resolve({ status: piStatus });
      },
      settlePaystack: (ref: string) => {
        log.push(`settlePaystack:${ref}`);
        return Promise.resolve();
      },
      alertOps: (subject: string) => {
        log.push(`alert:${subject}`);
        return Promise.resolve();
      },
    },
  };
}

const released = (rpc: ReturnType<typeof rpcStub>) =>
  rpc.calls.filter((c) => c.fn === "issue_4522_release_flex_verified").map((c) => c.args?.p_verified);

Deno.test("N3 constants mirror the SQL (15 minutes, 24 hours)", () => {
  assertEquals(FLEX_RECLAIM_WINDOW_MS, 15 * 60 * 1000);
  assertEquals(FLEX_IN_FLIGHT_CEILING_MS, 24 * 60 * 60 * 1000);
});

Deno.test("N3 Stripe succeeded: settled through the success path, never released or cancelled", async () => {
  const rpc = rpcStub();
  const { d, log } = deps(rpc, "succeeded");
  const counts = await verifyOpenFlexPayments(d, [stripeRow()]);
  assertEquals(counts.settled, 1);
  assertEquals(log, ["retrieve:pi_1", "settle:pi_1"]);
  assertEquals(released(rpc), []);
});

Deno.test("N3 Stripe canceled: released with the provider's id", async () => {
  const rpc = rpcStub();
  const { d } = deps(rpc, "canceled");
  await verifyOpenFlexPayments(d, [stripeRow()]);
  assertEquals(rpc.calls.find((c) => c.fn === "issue_4522_release_flex_verified")?.args,
    { p_installment_id: "flex-1", p_verified: "provider_canceled", p_provider_ref: "pi_1" });
});

Deno.test("N3 Stripe cancelable: cancel, read back canceled, then release", async () => {
  for (const status of ["requires_payment_method", "requires_confirmation"]) {
    const rpc = rpcStub();
    const { d, log } = deps(rpc, status);
    await verifyOpenFlexPayments(d, [stripeRow()]);
    assertEquals(log[1], "cancel:pi_1:flex-release-cancel:flex-1:pi_1", status);
    assertEquals(released(rpc), ["provider_canceled"], status);
  }
});

Deno.test("N3 Stripe cancel answered with anything but canceled: kept", async () => {
  const rpc = rpcStub();
  const { d } = deps(rpc, "requires_payment_method", "processing");
  const counts = await verifyOpenFlexPayments(d, [stripeRow()]);
  assertEquals(released(rpc), []);
  assertEquals(counts.in_flight, 1);
});

Deno.test("N3 Stripe cancel lost to a confirmation: the read-back success is settled", async () => {
  const rpc = rpcStub();
  let reads = 0;
  const { d, log } = deps(rpc, "requires_confirmation", "canceled", true);
  d.stripe = () => ({
    paymentIntents: {
      retrieve: (id: string) => {
        reads += 1;
        return Promise.resolve({ id, status: reads === 1 ? "requires_confirmation" : "succeeded" });
      },
      cancel: () => Promise.reject(new Error("payment_intent_unexpected_state")),
    },
  });
  await verifyOpenFlexPayments(d, [stripeRow()]);
  assertEquals(released(rpc), []);
  assertEquals(log.includes("settle:pi_1"), true);
});

Deno.test("N3 Stripe processing / requires_action: kept; past 24 hours flagged once (alert), never released", async () => {
  for (const status of ["processing", "requires_action", "requires_capture"]) {
    const rpc = rpcStub({ issue_4522_flag_stuck_flex: true });
    const { d, log } = deps(rpc, status, "canceled");
    const fresh = await verifyOpenFlexPayments(d, [stripeRow()]);
    assertEquals(fresh.in_flight, 1, status);
    assertEquals(released(rpc), [], status);
    if (status === "requires_action") continue;
    const old = await verifyOpenFlexPayments(d, [stripeRow({ pastCeiling: true })]);
    assertEquals(old.flagged, 1, status);
    assertEquals(released(rpc), [], status);
    assertEquals(log.filter((l) => l.startsWith("alert:")).length, 1, status);
  }
});

Deno.test("N3 Stripe requires_action past 24 hours: cancelled (confirmed) and released", async () => {
  const rpc = rpcStub();
  const { d } = deps(rpc, "requires_action");
  await verifyOpenFlexPayments(d, [stripeRow({ pastCeiling: true })]);
  assertEquals(released(rpc), ["provider_canceled"]);
});

Deno.test("N3 Stripe with no PaymentIntent id: nothing was ever presented, released as such", async () => {
  const rpc = rpcStub();
  const { d, log } = deps(rpc, "succeeded");
  await verifyOpenFlexPayments(d, [stripeRow({ stripePaymentIntentId: null })]);
  assertEquals(log, []);
  assertEquals(released(rpc), ["no_provider_charge"]);
});

Deno.test("N3 Stripe unreachable: kept, not released", async () => {
  const rpc = rpcStub();
  const { d } = deps(rpc, "x");
  d.stripe = () => ({ paymentIntents: {
    retrieve: () => Promise.reject(new Error("network")),
    cancel: () => Promise.reject(new Error("network")),
  } });
  const counts = await verifyOpenFlexPayments(d, [stripeRow()]);
  assertEquals(counts.in_flight, 1);
  assertEquals(released(rpc), []);
});

Deno.test("N3 / T3-5 Paystack: success settles, failed/reversed release, abandoned/pending kept, never attempted releases", async () => {
  const row = stripeRow({ provider: "paystack", stripePaymentIntentId: null, attemptReference: "mingla-inst-x-l1", attemptCount: 1,
    attemptCreatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() });
  for (const [status, expectRelease, expectSettle] of [
    ["success", [], true], ["failed", ["provider_failed"], false], ["reversed", ["provider_failed"], false],
    // T3-5: an unfinished checkout the old tab can still complete is not final.
    ["abandoned", [], false],
    ["ongoing", [], false], ["pending", [], false],
  ] as const) {
    const rpc = rpcStub();
    const { d, log } = deps(rpc, status);
    await verifyOpenFlexPayments(d, [row]);
    assertEquals(released(rpc), [...expectRelease], status);
    assertEquals(log.includes("settlePaystack:mingla-inst-x-l1"), expectSettle, status);
  }
  const rpc = rpcStub();
  const { d, log } = deps(rpc, "success");
  await verifyOpenFlexPayments(d, [{ ...row, attemptReference: null, attemptCount: 0 }]);
  assertEquals(released(rpc), ["no_provider_charge"]);
  assertEquals(log, []);
});

Deno.test("T3-5 Paystack abandoned: released (provider_abandoned) only once the attempt is 24 hours old", async () => {
  const base = stripeRow({ provider: "paystack", stripePaymentIntentId: null, attemptReference: "mingla-inst-x-l1", attemptCount: 1,
    pastCeiling: true });
  for (const [hours, expected] of [[23, []], [25, ["provider_abandoned"]]] as const) {
    const rpc = rpcStub({ issue_4522_flag_stuck_flex: false });
    const { d } = deps(rpc, "abandoned");
    await verifyOpenFlexPayments(d, [{ ...base, attemptCreatedAt: new Date(Date.now() - hours * 3600e3).toISOString() }]);
    assertEquals(released(rpc), [...expected], `${hours}h`);
  }
  // No creation time known: never released on "abandoned" alone.
  const rpc = rpcStub({ issue_4522_flag_stuck_flex: false });
  const { d } = deps(rpc, "abandoned");
  await verifyOpenFlexPayments(d, [{ ...base, attemptCreatedAt: null }]);
  assertEquals(released(rpc), []);
});

// ── N2: the overpayment refund lane ──────────────────────────────────────

function lane(begun: Record<string, unknown>, finishAnswer: Record<string, unknown> = { ok: true }) {
  const rpc = rpcStub({
    issue_4522_begin_overpayment_refund: begun,
    issue_4522_finish_overpayment_refund: finishAnswer,
  });
  const refunds: Array<{ params: Record<string, unknown>; key: string }> = [];
  const alerts: string[] = [];
  return { rpc, refunds, alerts };
}

const begunStripe = {
  ok: true, done: false, action: "create", overpaymentId: "op-1", orderId: "order-1", installmentId: "flex-1", brandId: "brand-1",
  provider: "stripe", providerRef: "pi_flex", refundMinor: 10000, remainingMinor: 10000, amountMinor: 10000, currency: "USD",
  refundId: "rf-1", attemptNo: 1, idempotencyKey: "mingla_overpay_refund:op-1:1",
};
const unusedReads = {
  retrieve: () => Promise.reject(new Error("unused")),
  list: () => Promise.reject(new Error("unused")),
};

Deno.test("N2 Stripe: a partial refund of the PaymentIntent with the attempt's key", async () => {
  const l = lane(begunStripe);
  const outcome = await returnOverpayment({
    supabase: l.rpc.client,
    stripe: () => ({ refunds: { ...unusedReads, create: (params, o) => {
      l.refunds.push({ params, key: o.idempotencyKey });
      return Promise.resolve({ id: "re_1", status: "succeeded" });
    } } }),
    stripeAccountForBrand: () => Promise.resolve("acct_1"),
    createPaystackRefund: () => Promise.reject(new Error("unused")),
    alertOps: () => Promise.resolve(),
  }, "op-1");
  assertEquals(outcome, "succeeded");
  assertEquals(l.refunds, [{ params: { payment_intent: "pi_flex", amount: 10000, reason: "requested_by_customer",
    refund_application_fee: true, metadata: { mingla_overpayment_id: "op-1", mingla_overpayment_attempt: "1",
      mingla_order_id: "order-1", mingla_refund_id: "rf-1", mingla_installment_id: "flex-1" } },
    key: "mingla_overpay_refund:op-1:1" }]);
  assertEquals(l.rpc.calls.find((c) => c.fn === "issue_4522_finish_overpayment_refund")?.args,
    { p_overpayment_id: "op-1", p_attempt_no: 1, p_outcome: "succeeded", p_provider_refund_id: "re_1", p_error: null });
});

Deno.test("N2 Stripe: a timeout stays pending under the same key; a 4xx refusal is failed", async () => {
  for (const [err, expected] of [
    [Object.assign(new Error("socket hang up"), {}), "unknown"],
    [Object.assign(new Error("rate"), { statusCode: 429 }), "unknown"],
    [Object.assign(new Error("idempotency in use"), { statusCode: 409 }), "unknown"],
    [Object.assign(new Error("charge already refunded"), { statusCode: 400 }), "failed"],
  ] as const) {
    const l = lane(begunStripe);
    const outcome = await returnOverpayment({
      supabase: l.rpc.client,
      stripe: () => ({ refunds: { ...unusedReads, create: () => Promise.reject(err) } }),
      stripeAccountForBrand: () => Promise.resolve("acct_1"),
      createPaystackRefund: () => Promise.reject(new Error("unused")),
      alertOps: () => Promise.resolve(),
    }, "op-1");
    assertEquals(outcome, expected, err.message);
    assertEquals(l.rpc.calls.find((c) => c.fn === "issue_4522_finish_overpayment_refund")?.args?.p_outcome, expected);
  }
  assertEquals(isDefinitiveStripeRefusal({ statusCode: 500 }), false);
});

Deno.test("N2 Paystack: a partial refund of the transaction; processed / pending / refused / retryable", async () => {
  const begunPs = { ...begunStripe, provider: "paystack", providerRef: "mingla-inst-flex-l1", currency: "NGN",
    refundMinor: 10200, amountMinor: 10200, idempotencyKey: "mingla_overpay_refund:op-1:1" };
  for (const [answer, expected] of [
    [{ id: "rfd_1", status: "processed" }, "succeeded"],
    [{ id: "rfd_1", status: "pending" }, "pending"],
    [{ id: "rfd_1", status: "failed" }, "failed"],
  ] as const) {
    const l = lane(begunPs);
    const seen: Record<string, unknown>[] = [];
    const outcome = await returnOverpayment({
      supabase: l.rpc.client,
      stripe: () => ({ refunds: { ...unusedReads, create: () => Promise.reject(new Error("unused")) } }),
      stripeAccountForBrand: () => Promise.resolve(null),
      // deno-lint-ignore no-explicit-any
      createPaystackRefund: ((p: Record<string, unknown>) => {
        seen.push(p);
        return Promise.resolve({ ...answer, amount: 10200, currency: "NGN", integration: null, transaction: "x" });
      }) as any,
      alertOps: () => Promise.resolve(),
    }, "op-1");
    assertEquals(outcome, expected);
    assertEquals(seen[0], { transaction: "mingla-inst-flex-l1", merchantNote: "mingla_overpay_refund:op-1:1",
      amountSubunits: 10200, currency: "NGN" });
  }
});

Deno.test("N2 / T3-2 the third failure stops the lane and alerts ops once through the existing alert path", async () => {
  const l = lane(begunStripe, { ok: true, state: "needs_ops", alertOps: true, alertKind: "refund_failed_repeatedly",
    attemptNo: 3, remainingMinor: 10000 });
  const outcome = await returnOverpayment({
    supabase: l.rpc.client,
    stripe: () => ({ refunds: { ...unusedReads, create: () => Promise.reject(Object.assign(new Error("declined"), { statusCode: 402 })) } }),
    stripeAccountForBrand: () => Promise.resolve("acct_1"),
    createPaystackRefund: () => Promise.reject(new Error("unused")),
    alertOps: (subject) => {
      l.alerts.push(subject);
      return Promise.resolve();
    },
  }, "op-1");
  assertEquals(outcome, "needs_ops");
  assertEquals(l.alerts, ["Trip overpayment refund stopped after 3 refusals"]);
});

Deno.test("N2 a resolved overpayment calls no provider", async () => {
  const l = lane({ ok: true, done: true, state: "refunded" });
  let called = false;
  const outcome = await returnOverpayment({
    supabase: l.rpc.client,
    stripe: () => ({ refunds: { ...unusedReads, create: () => {
      called = true;
      return Promise.resolve({});
    } } }),
    stripeAccountForBrand: () => Promise.resolve("acct_1"),
    createPaystackRefund: () => Promise.reject(new Error("unused")),
    alertOps: () => Promise.resolve(),
  }, "op-1");
  assertEquals(outcome, "done");
  assertEquals(called, false);
});
