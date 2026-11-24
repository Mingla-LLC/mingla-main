// MINGLA-INVARIANT: I-4522-FLEX-RELEASE-VERIFIED | issue #4522 | An open flexible payment is released only with the provider's own answer (a Stripe PaymentIntent read back as canceled, a Paystack transaction verified failed, or no charge ever presented); a success is settled through the webhook's success path, and anything still in flight is kept and flagged for ops past 24 hours.
/**
 * issue #4522 (rework N3, N2) — mocked providers, no network.
 *
 * N3: verifyOpenFlexPayments for every Stripe status and Paystack outcome,
 * the 24-hour ceiling, and "no charge ever presented".
 * N2: returnOverpayment — Stripe partial refund of the PaymentIntent and
 * Paystack partial refund of the transaction, with the attempt's key; a
 * timeout keeps the same key (never a second refund); only the provider's
 * refusal of the refund itself is failed, anything else is unknown (T4-1);
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
  reconcileMarkedStripeCharges,
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

Deno.test("N2 / T4-1 Stripe: only the provider's refusal of the refund itself is failed; anything else is unknown", async () => {
  for (const [err, expected] of [
    [Object.assign(new Error("socket hang up"), {}), "unknown"],
    [Object.assign(new Error("rate"), { statusCode: 429 }), "unknown"],
    [Object.assign(new Error("idempotency in use"), { statusCode: 409 }), "unknown"],
    [Object.assign(new Error("Keys for idempotent requests can only be used with the same parameters they were first used with."),
      { statusCode: 400, type: "StripeIdempotencyError", rawType: "idempotency_error" }), "unknown"],
    [Object.assign(new Error("server"), { statusCode: 500 }), "unknown"],
    [Object.assign(new Error("an unrecognised refusal"), { statusCode: 400 }), "unknown"],
    [Object.assign(new Error("payment required"), { statusCode: 402 }), "unknown"],
    [Object.assign(new Error("charge already refunded"), { statusCode: 400, type: "StripeInvalidRequestError",
      code: "charge_already_refunded" }), "failed"],
    [Object.assign(new Error("disputed"), { statusCode: 400, raw: { code: "charge_disputed" } }), "failed"],
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
    stripe: () => ({ refunds: { ...unusedReads, create: () => Promise.reject(Object.assign(new Error("declined"),
      { statusCode: 400, code: "charge_already_refunded" })) } }),
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

// ── rework 9 (T8-2 / T8-3): a marked planned charge is read back and acted on its answer only ──
// FAILS-ON-REVERT: settle, fail or release a marked charge without Stripe's
// answer (or release one that succeeded / is processing) -> red.
Deno.test("rework 9 T8-3: marked planned Stripe charges are settled, failed, released or kept only on Stripe's answer", async () => {
  const cases: Array<[string, Record<string, unknown> | Error, boolean, string, string[]]> = [
    ["succeeded", { status: "succeeded" }, true, "settled", ["retrieve", "settle"]],
    ["processing", { status: "processing" }, true, "in_flight", ["retrieve"]],
    ["requires_action", { status: "requires_action" }, true, "in_flight", ["retrieve"]],
    ["never confirmed", { status: "requires_confirmation" }, true, "released", ["retrieve", "cancel", "release"]],
    ["declined, answer lost", { status: "requires_payment_method", last_payment_error: { code: "card_declined" } }, true, "failed", ["retrieve", "fail"]],
    ["failed attempt's id", { status: "requires_payment_method", last_payment_error: { code: "card_declined" } }, false, "released", ["retrieve", "cancel", "release"]],
    ["already cancelled", { status: "canceled" }, true, "released", ["retrieve", "release"]],
    ["no answer", new Error("timeout"), true, "in_flight", ["retrieve"]],
  ];
  for (const [label, answer, marked, outcome, steps] of cases) {
    const seen: string[] = [];
    const counts = await reconcileMarkedStripeCharges({
      supabase: { rpc: (fn: string) => { seen.push(fn === "issue_4522_release_unconfirmed_stripe_charge" ? "release" : fn); return Promise.resolve({ data: { ok: true, released: true }, error: null }); } },
      stripe: () => ({ paymentIntents: {
        retrieve: () => { seen.push("retrieve"); return answer instanceof Error ? Promise.reject(answer) : Promise.resolve({ id: "pi_m", ...answer }); },
        cancel: () => { seen.push("cancel"); return Promise.resolve({ id: "pi_m", status: "canceled" }); },
      } }),
      stripeAccountFor: () => Promise.resolve("acct_1"),
      settleStripe: () => { seen.push("settle"); return Promise.resolve(); },
      failStripe: () => { seen.push("fail"); return Promise.resolve(); },
    }, [{ installmentId: "r1", orderId: "o1", paymentIntentId: "pi_m", marked, pastCeiling: false }]);
    assertEquals([counts[outcome as keyof typeof counts], seen], [1, steps], label);
  }
  // A cancel that loses to a confirmation is read back: succeeded settles, never releases.
  const seen: string[] = [];
  let reads = 0;
  const counts = await reconcileMarkedStripeCharges({
    supabase: { rpc: () => { seen.push("release"); return Promise.resolve({ data: { ok: true }, error: null }); } },
    stripe: () => ({ paymentIntents: {
      retrieve: () => { reads += 1; return Promise.resolve({ id: "pi_m", status: reads === 1 ? "requires_confirmation" : "succeeded" }); },
      cancel: () => Promise.reject(new Error("payment_intent_unexpected_state")),
    } }),
    stripeAccountFor: () => Promise.resolve("acct_1"),
    settleStripe: () => { seen.push("settle"); return Promise.resolve(); },
    failStripe: () => { seen.push("fail"); return Promise.resolve(); },
  }, [{ installmentId: "r1", orderId: "o1", paymentIntentId: "pi_m", marked: true, pastCeiling: false }]);
  assertEquals([counts.settled, seen], [1, ["settle"]]);
  // A cancel whose answer is not "canceled" releases nothing: the row stays in flight.
  const kept: string[] = [];
  const keptCounts = await reconcileMarkedStripeCharges({
    supabase: { rpc: () => { kept.push("release"); return Promise.resolve({ data: { ok: true }, error: null }); } },
    stripe: () => ({ paymentIntents: {
      retrieve: () => Promise.resolve({ id: "pi_m", status: "requires_confirmation" }),
      cancel: () => Promise.resolve({ id: "pi_m", status: "processing" }),
    } }),
    stripeAccountFor: () => Promise.resolve("acct_1"),
    settleStripe: () => { kept.push("settle"); return Promise.resolve(); },
    failStripe: () => { kept.push("fail"); return Promise.resolve(); },
  }, [{ installmentId: "r1", orderId: "o1", paymentIntentId: "pi_m", marked: true, pastCeiling: false }]);
  assertEquals([keptCounts.in_flight, kept], [1, []]);
});

// ── Pass 5 (F-3): a duplicate / late second-provider payment is refunded by
// its REFERENCE. The refund helper verifies the transaction first and the
// provider's verify takes a reference (GET /transaction/verify/:reference);
// the numeric transaction id is only the identity check. Driven through the
// real refundInstallmentAttempt and the real createPaystackRefund, with the
// provider answering exactly the documented shapes already encoded here.
// FAILS-ON-REVERT: the numeric id was sent as the reference, the verify was
// refused, the refund was marked failed and ops were told to refund by hand.
import { refundInstallmentAttempt } from "../paystackInstallmentWebhook.ts";
import { createPaystackRefund } from "../../paystackRefunds.ts";
import { fakeSupabase } from "./issue_3645_fake_supabase.ts";

Deno.test("F-3: the duplicate-payment refund verifies the transaction by reference, checks its id, and is sent once", async () => {
  const REF = "mingla-inst-4522f300-0000-4000-8000-000000000001-a2";
  const TXN_ID = 4522500010;
  const saved = { mode: Deno.env.get("PAYSTACK_MODE"), key: Deno.env.get("PAYSTACK_SECRET_KEY_TEST") };
  Deno.env.set("PAYSTACK_MODE", "test");
  Deno.env.set("PAYSTACK_SECRET_KEY_TEST", "sk_test_issue4522f3");
  const realFetch = globalThis.fetch;
  const urls: string[] = [];
  const posts: Record<string, unknown>[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    urls.push(`${init?.method ?? "GET"} ${url.replace("https://api.paystack.co", "")}`);
    const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ status: true, data }), { status: 200 }));
    if (url.includes("/transaction/verify/")) {
      const ref = decodeURIComponent(url.split("/transaction/verify/")[1]);
      return ref === REF
        ? ok({ id: TXN_ID, reference: REF, amount: 9000000, currency: "NGN", status: "success" })
        : Promise.resolve(new Response(JSON.stringify({ status: false, message: "Transaction reference not found" }), { status: 400 }));
    }
    if (url.includes("/refund?")) return ok([]);
    if (url.endsWith("/refund") && init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      return ok({ id: 7001, amount: 9000000, status: "pending", currency: "NGN", transaction: { id: TXN_ID, reference: REF } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  const fake = fakeSupabase({
    table: (op) => {
      if (op.table === "order_installment_charge_attempts" && op.kind === "select") {
        return { data: { id: "4522f300-0000-4000-8000-0000000000a1", installment_id: "4522f300-0000-4000-8000-0000000000b1",
          method: "pay_link", state: "refund_due", amount_cents: 9000000, reference: REF, provider_transaction_id: String(TXN_ID) }, error: null };
      }
      if (op.table === "order_installments") {
        return { data: { id: "4522f300-0000-4000-8000-0000000000b1", order_id: "4522f300-0000-4000-8000-0000000000c1", currency: "NGN" }, error: null };
      }
      if (op.table === "refunds" && op.kind === "insert") return { data: { id: "4522f300-0000-4000-8000-0000000000d1" }, error: null };
      return { data: null, error: null };
    },
    rpc: () => ({ data: { ok: true }, error: null }),
  });
  const alerts: string[] = [];
  try {
    const out = await refundInstallmentAttempt(fake.client as never, "4522f300-0000-4000-8000-0000000000a1", {
      createPaystackRefund,
      alertOps: (subject: string) => { alerts.push(subject); return Promise.resolve(); },
      dispatchBuyerEmail: () => Promise.resolve(true),
    } as never);
    assertEquals(out, { ok: true });
    assertEquals(alerts, []);
    assertEquals(urls[0], `GET /transaction/verify/${encodeURIComponent(REF)}`);
    assertEquals(posts.length, 1, "one automatic send");
    assertEquals(posts[0].transaction, REF);
    assertEquals(posts[0].merchant_note, "mingla_inst_dup:4522f300-0000-4000-8000-0000000000a1");
    const outcome = fake.rpcCalls.find((c) => c.name === "record_paystack_refund_outcome");
    assertEquals(outcome?.args.p_transaction_reference, REF);
    // a different transaction behind the same reference is refused, never refunded
    posts.length = 0;
    await createPaystackRefund({ transaction: REF, expectedTransactionId: TXN_ID + 1, merchantNote: "x", currency: "NGN" })
      .then(() => { throw new Error("must refuse"); }, (e) => assertEquals(String(e.message), "Paystack transaction identity mismatch"));
    assertEquals(posts.length, 0);
  } finally {
    globalThis.fetch = realFetch;
    if (saved.mode === undefined) Deno.env.delete("PAYSTACK_MODE"); else Deno.env.set("PAYSTACK_MODE", saved.mode);
    if (saved.key === undefined) Deno.env.delete("PAYSTACK_SECRET_KEY_TEST"); else Deno.env.set("PAYSTACK_SECRET_KEY_TEST", saved.key);
  }
});
