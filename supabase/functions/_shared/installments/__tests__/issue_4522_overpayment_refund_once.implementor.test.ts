// MINGLA-INVARIANT: I-4522-OVERPAY-REFUND-ONCE-EDGE | issue #4522 | The overpayment lane never sends a new provider refund while an earlier one is creating or pending: a stored refund id is retrieved, an unanswered attempt is re-sent with its own key inside the key window or found in the provider's refund list after it, and every earlier failed refund is re-read before a new one; refund webhooks resolve overpayment refunds by refund id, Mingla metadata, or (a refund not made by Mingla) the charge.
/**
 * issue #4522 third rework (T3-1 / T3-2 / T3-6 / T3-7 at the edge, T3-3 and
 * T3-8 helpers) — mocked providers and a scripted database, no network.
 *
 * FAILS-ON-REVERT: make the lane send a refund on a "verify" plan, re-create
 * an unanswered attempt after the key window instead of reading the list,
 * skip the prior re-read, drop the metadata attempt number, mark a dashboard
 * refund (no Mingla metadata) as Mingla-made, drop the probe's table fallback,
 * or drop the webhook's short-collection record -> red.
 */
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  applyOverpaymentRefundEvent,
  OVERPAYMENT_FAILURE_LIMIT,
  OVERPAYMENT_MAX_REFUND_PART_MINOR,
  OVERPAYMENT_PAYSTACK_MIN_REFUND_MINOR,
  OVERPAYMENT_PENDING_CEILING_MS,
  overpaymentAlert,
  type OverpaymentRefundDeps,
  type OverpaymentStripe,
  paystackOverpaymentRefundEvent,
  returnOverpayment,
  stripeOverpaymentRefundEvent,
  stripeRefundAnswer,
} from "../overpaymentRefunds.ts";
import { planV2SchemaAvailable, resetPlanV2SchemaProbeForTests } from "../planV2Schema.ts";
import { handleInstallmentPaymentSucceeded } from "../../installmentWebhookHandlers.ts";
import { fakeSupabase } from "./issue_3645_fake_supabase.ts";

type Call = { fn: string; args?: Record<string, unknown> };

/** A scripted database: each RPC answers from its own queue (last answer repeats). */
function scripted(answers: Record<string, Array<Record<string, unknown>>>) {
  const calls: Call[] = [];
  const client = {
    rpc(fn: string, args?: Record<string, unknown>) {
      calls.push({ fn, args });
      const q = answers[fn] ?? [{ ok: true }];
      const data = q.length > 1 ? q.shift() : q[0];
      return Promise.resolve({ data, error: null });
    },
  };
  return { calls, client };
}

interface StripeLog {
  creates: Array<{ amount: unknown; key: string; metadata: Record<string, unknown> }>;
  retrieves: string[];
  lists: string[];
}

function stripe(log: StripeLog, opts: {
  retrieve?: Record<string, { status: string } | Error>;
  create?: { id?: string; status: string } | Error;
  list?: Array<{ id: string; status: string; metadata: Record<string, unknown> }>;
} = {}): OverpaymentStripe {
  return {
    refunds: {
      create: (p, o) => {
        log.creates.push({ amount: p.amount, key: o.idempotencyKey, metadata: p.metadata as Record<string, unknown> });
        const c = opts.create ?? { id: `re_new_${log.creates.length}`, status: "succeeded" };
        return c instanceof Error ? Promise.reject(c) : Promise.resolve({ id: c.id, status: c.status });
      },
      retrieve: (id) => {
        log.retrieves.push(id);
        const r = opts.retrieve?.[id] ?? { status: "pending" };
        return r instanceof Error ? Promise.reject(r) : Promise.resolve({ id, status: r.status });
      },
      list: (p) => {
        log.lists.push(String(p.payment_intent));
        return Promise.resolve({ data: opts.list ?? [] });
      },
    },
  };
}

const plan = {
  ok: true, done: false, overpaymentId: "op-1", orderId: "order-1", installmentId: "flex-1", brandId: "brand-1",
  provider: "stripe", providerRef: "pi_flex", currency: "USD", refundMinor: 30000, remainingMinor: 30000,
};
const verify = (attempts: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => ({
  ...plan, action: "verify", attempts, ...extra,
});
const create = (n: number, amount = 30000) => ({
  ...plan, action: "create", attemptNo: n, amountMinor: amount, refundId: `rf-${n}`,
  idempotencyKey: `mingla_overpay_refund:op-1:${n}`,
});

function deps(db: ReturnType<typeof scripted>, s: OverpaymentStripe, alerts: string[] = [], extra: Partial<OverpaymentRefundDeps> = {}): OverpaymentRefundDeps {
  return {
    supabase: db.client,
    stripe: () => s,
    stripeAccountForBrand: () => Promise.resolve("acct_1"),
    createPaystackRefund: () => Promise.reject(new Error("unused")),
    alertOps: (subject) => {
      alerts.push(subject);
      return Promise.resolve();
    },
    ...extra,
  };
}

const newLog = (): StripeLog => ({ creates: [], retrieves: [], lists: [] });
const outcomes = (db: ReturnType<typeof scripted>) =>
  db.calls.filter((c) => c.fn === "issue_4522_finish_overpayment_refund")
    .map((c) => `${c.args?.p_attempt_no}:${c.args?.p_outcome}:${c.args?.p_provider_refund_id ?? "-"}`);

Deno.test("T3 constants mirror the SQL", async () => {
  const sql = await Deno.readTextFile(new URL(
    "../../../../migrations/20281123044522_issue_4522_flex_payments.sql",
    import.meta.url,
  ));
  assertEquals(OVERPAYMENT_PENDING_CEILING_MS, 7 * 24 * 3600 * 1000);
  assert(sql.includes("AS $fn$ SELECT interval '7 days' $fn$;"));
  assertEquals(OVERPAYMENT_FAILURE_LIMIT, 3);
  assert(sql.includes("AS $fn$ SELECT 3 $fn$;"));
  assertEquals(OVERPAYMENT_PAYSTACK_MIN_REFUND_MINOR, 5000);
  assert(sql.includes("SELECT CASE WHEN p_provider = 'paystack' THEN 5000 ELSE 1 END::bigint"));
  assertEquals(OVERPAYMENT_MAX_REFUND_PART_MINOR, 2147483647);
  assert(sql.includes("AS $fn$ SELECT 2147483647::bigint $fn$;"));
});

Deno.test("T3-1 every Stripe refund status: succeeded returns, failed/canceled fail, the rest stays open", () => {
  for (
    const [status, expected] of [
      ["succeeded", "succeeded"], ["failed", "failed"], ["canceled", "failed"],
      ["pending", "pending"], ["requires_action", "pending"], [null, "pending"], ["something_new", "pending"],
    ] as const
  ) assertEquals(stripeRefundAnswer(status), expected, String(status));
});

Deno.test("T3-1 a pending refund is retrieved by its stored id on every pass and NEVER re-created", async () => {
  for (const status of ["pending", "requires_action"]) {
    const db = scripted({
      issue_4522_begin_overpayment_refund: [verify([{ attemptNo: 1, state: "pending", amountMinor: 30000,
        providerRefundId: "re_1", idempotencyKey: "mingla_overpay_refund:op-1:1", withinKeyWindow: false }])],
      issue_4522_finish_overpayment_refund: [{ ok: true, state: "refund_pending" }],
    });
    const log = newLog();
    for (let pass = 0; pass < 3; pass++) {
      assertEquals(await returnOverpayment(deps(db, stripe(log, { retrieve: { re_1: { status } } })), "op-1"), "pending");
    }
    assertEquals(log.creates, [], status);
    assertEquals(log.retrieves, ["re_1", "re_1", "re_1"]);
    assertEquals(outcomes(db), ["1:pending:re_1", "1:pending:re_1", "1:pending:re_1"]);
  }
});

Deno.test("T3-1 the stored refund settles: succeeded -> returned; failed/canceled -> the next attempt only after a re-read", async () => {
  const db = scripted({
    issue_4522_begin_overpayment_refund: [
      verify([{ attemptNo: 1, state: "pending", amountMinor: 30000, providerRefundId: "re_1" }]),
      { ...plan, ok: true, done: true, state: "refunded" },
    ],
    issue_4522_finish_overpayment_refund: [{ ok: true, state: "refunded" }],
  });
  const log = newLog();
  assertEquals(await returnOverpayment(deps(db, stripe(log, { retrieve: { re_1: { status: "succeeded" } } })), "op-1"), "succeeded");
  assertEquals(log.creates, []);

  for (const status of ["failed", "canceled"]) {
    const db2 = scripted({
      issue_4522_begin_overpayment_refund: [
        verify([{ attemptNo: 1, state: "pending", amountMinor: 30000, providerRefundId: "re_1" }]),
        { ...plan, action: "verify_prior", attempts: [{ attemptNo: 1, state: "failed", amountMinor: 30000, providerRefundId: "re_1" }] },
        create(2),
      ],
      issue_4522_finish_overpayment_refund: [{ ok: true, state: "refund_failed" }, { ok: true, state: "refunded" }],
    });
    const log2 = newLog();
    const outcome = await returnOverpayment(deps(db2, stripe(log2, { retrieve: { re_1: { status } } })), "op-1");
    assertEquals(outcome, "succeeded", status);
    // re_1 read twice (verify, then the prior re-read), then ONE new refund with key :2
    assertEquals(log2.retrieves, ["re_1", "re_1"]);
    assertEquals(log2.creates.map((c) => c.key), ["mingla_overpay_refund:op-1:2"]);
    assertEquals(log2.creates[0].metadata.mingla_overpayment_attempt, "2");
    const begins = db2.calls.filter((c) => c.fn === "issue_4522_begin_overpayment_refund").map((c) => c.args?.p_verified_through);
    assertEquals(begins, [null, null, 1]);
  }
});

Deno.test("T3-1 a prior refund the provider now reports live blocks a new one; an unreadable one too", async () => {
  for (const [answer, expected] of [[{ status: "succeeded" }, "pending"], [new Error("timeout"), "unknown"]] as const) {
    const db = scripted({
      issue_4522_begin_overpayment_refund: [
        { ...plan, action: "verify_prior", attempts: [{ attemptNo: 1, state: "failed", amountMinor: 30000, providerRefundId: "re_1" }] },
        create(2),
      ],
    });
    const log = newLog();
    assertEquals(await returnOverpayment(deps(db, stripe(log, { retrieve: { re_1: answer } })), "op-1"), expected);
    assertEquals(log.creates, []);
  }
});

Deno.test("T3-1 an unanswered attempt: same key inside the window, the refund list after it (found / never created)", async () => {
  const unanswered = (within: boolean) =>
    verify([{ attemptNo: 1, state: "creating", amountMinor: 30000, providerRefundId: null,
      idempotencyKey: "mingla_overpay_refund:op-1:1", withinKeyWindow: within }]);
  // inside the window: re-sent with ITS key (the provider replays or creates it once)
  let db = scripted({ issue_4522_begin_overpayment_refund: [unanswered(true)],
    issue_4522_finish_overpayment_refund: [{ ok: true, state: "refund_pending" }] });
  let log = newLog();
  assertEquals(await returnOverpayment(deps(db, stripe(log, { create: { id: "re_9", status: "pending" } })), "op-1"), "pending");
  assertEquals(log.creates.map((c) => c.key), ["mingla_overpay_refund:op-1:1"]);
  assertEquals(log.lists, []);
  assertEquals(outcomes(db), ["1:pending:re_9"]);
  // after the window: never re-sent; read from the list by metadata
  db = scripted({ issue_4522_begin_overpayment_refund: [unanswered(false)],
    issue_4522_finish_overpayment_refund: [{ ok: true, state: "refund_pending" }] });
  log = newLog();
  await returnOverpayment(deps(db, stripe(log, { list: [
    { id: "re_other", status: "succeeded", metadata: { mingla_overpayment_id: "op-1", mingla_overpayment_attempt: "2" } },
    { id: "re_mine", status: "pending", metadata: { mingla_overpayment_id: "op-1", mingla_overpayment_attempt: "1" } },
  ] })), "op-1");
  assertEquals(log.creates, []);
  assertEquals(log.lists, ["pi_flex"]);
  assertEquals(outcomes(db), ["1:pending:re_mine"]);
  // not in the list: it was never created (failed, a new attempt may follow)
  db = scripted({ issue_4522_begin_overpayment_refund: [unanswered(false), { ok: false, reason: "retry_not_due" }],
    issue_4522_finish_overpayment_refund: [{ ok: true, state: "refund_failed" }] });
  log = newLog();
  assertEquals(await returnOverpayment(deps(db, stripe(log, { list: [] })), "op-1"), "failed");
  assertEquals(log.creates, []);
  assertEquals(outcomes(db), ["1:not_found:-"]);
});

Deno.test("T3-1 pending past the ceiling: ops is told once, plainly, never to refund by hand", async () => {
  const db = scripted({
    issue_4522_begin_overpayment_refund: [verify([{ attemptNo: 1, state: "pending", amountMinor: 30000, providerRefundId: "re_1" }],
      { alertOps: true, alertKind: "refund_pending_too_long" })],
    issue_4522_finish_overpayment_refund: [{ ok: true, state: "refund_pending" }],
  });
  const alerts: string[] = [];
  const log = newLog();
  await returnOverpayment(deps(db, stripe(log), alerts), "op-1");
  assertEquals(alerts, ["Trip overpayment refund still pending at the provider"]);
  const copy = overpaymentAlert("refund_pending_too_long", plan, null)!.paragraphs.join(" ");
  assert(copy.includes("Do NOT refund it by hand"));
  assertEquals(log.creates, []);
});

Deno.test("T3-2 the stop alert says exactly what is safe: retries stopped, refund exactly the amount, it is matched", () => {
  const copy = overpaymentAlert("refund_failed_repeatedly", { ...plan, remainingMinor: 30000 }, "card_closed")!;
  const text = copy.paragraphs.join(" ");
  assertEquals(copy.subject, "Trip overpayment refund stopped after 3 refusals");
  for (const needle of ["STOPPED", "refund exactly 30000 (USD minor units)", "matches that refund", "Do not refund more",
    "issue_4522_resolve_overpayment_by_ops", "pi_flex"]) assert(text.includes(needle), needle);
  assert(!text.includes("It is retried automatically"));
  const small = overpaymentAlert("below_provider_minimum", { ...plan, provider: "paystack", currency: "NGN",
    remainingMinor: 3000, minRefundMinor: 5000 } as never, null)!;
  assertEquals(small.subject, "Trip overpayment below the provider's minimum refund");
  assert(small.paragraphs.join(" ").includes("Nothing will be retried"));
});

Deno.test("T3-7 below the minimum: the plan stops for ops; no provider call; one alert", async () => {
  const db = scripted({ issue_4522_begin_overpayment_refund: [{ ...plan, ok: false, reason: "needs_ops",
    needsOpsReason: "below_provider_minimum", alertOps: true, alertKind: "below_provider_minimum", minRefundMinor: 5000,
    remainingMinor: 3000 }] });
  const alerts: string[] = [];
  const log = newLog();
  assertEquals(await returnOverpayment(deps(db, stripe(log), alerts), "op-1"), "needs_ops");
  assertEquals([log.creates.length, log.retrieves.length], [0, 0]);
  assertEquals(alerts.length, 1);
});

Deno.test("T3-6 a large overpayment goes back in parts within one pass", async () => {
  const db = scripted({
    issue_4522_begin_overpayment_refund: [create(1, 2147483647), create(2, 852516353), { ok: true, done: true }],
    issue_4522_finish_overpayment_refund: [{ ok: true, state: "held" }, { ok: true, state: "refunded" }],
  });
  const log = newLog();
  assertEquals(await returnOverpayment(deps(db, stripe(log)), "op-1"), "succeeded");
  assertEquals(log.creates.map((c) => c.amount), [2147483647, 852516353]);
});

Deno.test("T3-1 Paystack: a stored refund is looked up by id; an unanswered one re-sent with its merchant note", async () => {
  const ps = { ...plan, provider: "paystack", providerRef: "mingla-inst-flex-l1", currency: "NGN" };
  const looked: string[] = [];
  const sent: Array<Record<string, unknown>> = [];
  const db = scripted({
    issue_4522_begin_overpayment_refund: [{ ...ps, action: "verify", attempts: [
      { attemptNo: 1, state: "pending", amountMinor: 10200, providerRefundId: "rfd_1" },
      { attemptNo: 2, state: "creating", amountMinor: 5000, providerRefundId: null, idempotencyKey: "mingla_overpay_refund:op-1:2" },
    ] }],
    issue_4522_finish_overpayment_refund: [{ ok: true, state: "refund_pending" }],
  });
  const outcome = await returnOverpayment(deps(db, stripe(newLog()), [], {
    getPaystackRefund: (id: string) => {
      looked.push(id);
      return Promise.resolve({ id, amount: 10200, status: "processing", currency: "NGN", integration: null, transaction: "x", replayed: true });
    },
    // deno-lint-ignore no-explicit-any
    createPaystackRefund: ((p: Record<string, unknown>) => {
      sent.push(p);
      return Promise.resolve({ id: "rfd_2", amount: 5000, status: "processed", currency: "NGN", integration: null, transaction: "x", replayed: true });
    }) as any,
  }), "op-1");
  assertEquals(outcome, "pending");
  assertEquals(looked, ["rfd_1"]);
  assertEquals(sent, [{ transaction: "mingla-inst-flex-l1", merchantNote: "mingla_overpay_refund:op-1:2", amountSubunits: 5000, currency: "NGN" }]);
  assertEquals(outcomes(db), ["1:pending:rfd_1", "2:succeeded:rfd_2"]);
});

Deno.test("T3-1 / T3-2 refund webhooks: our refund by metadata; a dashboard refund is not Mingla-made", () => {
  const ours = stripeOverpaymentRefundEvent({ id: "re_1", status: "succeeded", amount: 30000, payment_intent: "pi_flex",
    metadata: { mingla_overpayment_id: "8f8f8f8f-1111-4222-8333-444455556666", mingla_overpayment_attempt: "2" } });
  assertEquals([ours.overpaymentId, ours.attemptNo, ours.minglaCreated, ours.status],
    ["8f8f8f8f-1111-4222-8333-444455556666", 2, true, "succeeded"]);
  const dashboard = stripeOverpaymentRefundEvent({ id: "re_d", status: "pending", amount: 60000, payment_intent: "pi_flex", metadata: {} });
  assertEquals([dashboard.overpaymentId, dashboard.minglaCreated, dashboard.status, dashboard.paymentRef],
    [null, false, "pending", "pi_flex"]);
  const cancel = stripeOverpaymentRefundEvent({ id: "re_c", status: "succeeded", amount: 50000, payment_intent: "pi_flex",
    metadata: { mingla_refund_id: "x", mingla_cancel_refund: "true" } });
  assertEquals(cancel.minglaCreated, true);
  const psOurs = paystackOverpaymentRefundEvent("refund.processed", "rfd_1",
    "mingla_overpay_refund:8f8f8f8f-1111-4222-8333-444455556666:3", "mingla-inst-x-l1", 5000);
  assertEquals([psOurs.overpaymentId, psOurs.attemptNo, psOurs.status, psOurs.minglaCreated],
    ["8f8f8f8f-1111-4222-8333-444455556666", 3, "succeeded", true]);
  const psDash = paystackOverpaymentRefundEvent("refund.pending", "rfd_9", "", "mingla-inst-x-l1", 5000);
  assertEquals([psDash.minglaCreated, psDash.status], [false, "pending"]);
  assertEquals(paystackOverpaymentRefundEvent("refund.failed", "rfd_9", "", "r", 1).status, "failed");
});

Deno.test("T3-2 applyOverpaymentRefundEvent passes the event and alerts once when the database says so", async () => {
  const db = scripted({ issue_4522_overpayment_refund_event: [{ handled: true, results: [{ ok: true, state: "needs_ops",
    alertOps: true, alertKind: "provider_reversed_refund", overpaymentId: "op-1", orderId: "order-1", currency: "USD",
    providerRef: "pi_flex", remainingMinor: 30000 }] }] });
  const alerts: string[] = [];
  const handled = await applyOverpaymentRefundEvent(db.client,
    stripeOverpaymentRefundEvent({ id: "re_1", status: "failed", amount: 30000, payment_intent: "pi_flex", metadata: {} }),
    (s) => {
      alerts.push(s);
      return Promise.resolve();
    });
  assertEquals(handled, true);
  assertEquals(db.calls[0].args, { p_provider: "stripe", p_provider_refund_id: "re_1", p_payment_ref: "pi_flex",
    p_amount_minor: 30000, p_status: "failed", p_overpayment_id: null, p_attempt_no: null, p_mingla_created: false });
  assertEquals(alerts, ["Trip overpayment refund reversed by the provider"]);
  const none = scripted({ issue_4522_overpayment_refund_event: [{ handled: false }] });
  assertEquals(await applyOverpaymentRefundEvent(none.client,
    stripeOverpaymentRefundEvent({ id: "re_2", status: "succeeded", amount: 1, payment_intent: "pi_x", metadata: {} }),
    () => Promise.resolve()), false);
});

Deno.test("T3-8 a schema probe that keeps failing is answered by reading the table, every time", async () => {
  const probe = (rpcError: { code: string; message: string }, tableError: { code: string; message: string } | null) => ({
    rpc: () => Promise.resolve({ data: null, error: rpcError }),
    from: () => ({ select: () => ({ limit: () => Promise.resolve({ data: [], error: tableError }) }) }),
  });
  resetPlanV2SchemaProbeForTests();
  assertEquals(await planV2SchemaAvailable(probe({ code: "XX000", message: "injected" }, null) as never), true);
  resetPlanV2SchemaProbeForTests();
  assertEquals(await planV2SchemaAvailable(probe({ code: "57014", message: "timeout" }, { code: "42703", message: "no kind" }) as never), false);
  resetPlanV2SchemaProbeForTests();
  await assertRejects(() => planV2SchemaAvailable(probe({ code: "XX000", message: "a" }, { code: "08006", message: "b" }) as never));
  resetPlanV2SchemaProbeForTests();
});

Deno.test("T3-3 the success webhook records a short Stripe charge for what it collected ($300 on a $450 row)", async () => {
  resetPlanV2SchemaProbeForTests();
  const ID = "45220000-0000-4000-8000-00000000a3a3";
  let rowAmount = 45000;
  const fake = fakeSupabase({
    rpc: (name, args) => {
      if (name === "issue_4522_record_short_collection") {
        const short = rowAmount - Number(args.p_received_minor);
        rowAmount = Number(args.p_received_minor);
        return { data: { ok: true, shortMinor: short }, error: null };
      }
      if (name === "record_order_installment_provider_sale") return { data: { ok: true }, error: null };
      if (name === "issue_3645_clear_at_risk_if_settled") return { data: null, error: null };
      if (name === "issue_4522_claim_paid_in_full_notice") return { data: false, error: null };
      return { data: true, error: null };
    },
    table: (op) => {
      if (op.table === "order_installments" && op.kind === "update") {
        return { data: { id: ID, order_id: "order-3", ordinal: 2, amount_cents: rowAmount, kind: "scheduled" }, error: null };
      }
      if (op.table === "order_installments" && op.kind === "select" && op.columns === "amount_cents") {
        return { data: { amount_cents: rowAmount }, error: null };
      }
      return { data: null, error: null, count: 1 };
    },
  });
  await handleInstallmentPaymentSucceeded(fake.client as never, {
    id: "evt_1", type: "payment_intent.succeeded",
    data: { object: { id: "pi_row", amount: 30000, amount_received: 30000, latest_charge: "ch_1", application_fee_amount: 0,
      metadata: { mingla_installment_id: ID, mingla_brand_id: "b" } } },
  } as never);
  const short = fake.rpcCalls.find((c) => c.name === "issue_4522_record_short_collection");
  assertEquals(short?.args, { p_installment_id: ID, p_received_minor: 30000, p_provider_ref: "pi_row" });
  const audit = fake.tableOps.find((o) => o.kind === "insert" && JSON.stringify(o.values ?? {}).includes("tr3.installment_collected"));
  assert(audit === undefined || JSON.stringify(audit.values).includes("30000"));
  // the provider sale is recorded on the $300 the provider collected, not $450
  const order = fake.rpcCalls.map((c) => c.name);
  assert(order.indexOf("issue_4522_record_short_collection") < order.indexOf("record_order_installment_provider_sale"));
  resetPlanV2SchemaProbeForTests();
});
