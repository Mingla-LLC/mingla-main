// MINGLA-INVARIANT: I-4522-OVERPAY-REFUND-ONCE-EDGE | issue #4522 | The overpayment lane never sends a new provider refund while one is creating or pending: an unanswered Stripe attempt is re-sent as the identical request or found on the charge, an unanswered Paystack attempt is never re-sent (only looked for in the transaction's refund list, then handed to ops), only the provider's refusal of the refund itself marks it failed, and every refund already on the charge is adopted before a new one; refund webhooks resolve by refund id, Mingla metadata, or the charge.
/**
 * issue #4522 third rework (T3-1 / T3-2 / T3-6 / T3-7 at the edge, T3-3 and
 * T3-8 helpers) — mocked providers and a scripted database, no network.
 *
 * FAILS-ON-REVERT: make the lane send a refund on a "verify" plan, re-create
 * an unanswered attempt after the key window instead of reading the list,
 * re-send an unanswered Paystack attempt (rework 7),
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
  /** T4-1: what the provider remembers per idempotency key: the first request and its answer. */
  keys: Map<string, { sig: string; answer: { id?: string; status: string } }>;
  /** Re-sends the provider refused because the parameters differed from the first use of the key. */
  idempotencyErrors: string[];
}

/**
 * Stripe's documented idempotency rule (T4-1): a key reused with the SAME
 * parameters replays the first answer; with DIFFERENT parameters it is
 * refused (HTTP 400, idempotency_error). `lostAnswer` creates the refund and
 * then loses the response, as a timeout after the provider acted.
 */
function stripe(log: StripeLog, opts: {
  retrieve?: Record<string, { status: string } | Error>;
  create?: { id?: string; status: string } | Error;
  lostAnswer?: boolean;
  list?: Array<{ id: string; status: string; metadata: Record<string, unknown> }> | Error;
} = {}): OverpaymentStripe {
  return {
    refunds: {
      create: (p, o) => {
        log.creates.push({ amount: p.amount, key: o.idempotencyKey, metadata: p.metadata as Record<string, unknown> });
        const sig = JSON.stringify(p);
        const seen = log.keys.get(o.idempotencyKey);
        if (seen !== undefined) {
          if (seen.sig !== sig) {
            log.idempotencyErrors.push(o.idempotencyKey);
            return Promise.reject(Object.assign(
              new Error("Keys for idempotent requests can only be used with the same parameters they were first used with."),
              { statusCode: 400, type: "StripeIdempotencyError", rawType: "idempotency_error" },
            ));
          }
          return Promise.resolve({ ...seen.answer });
        }
        const c = opts.create ?? { id: `re_new_${log.creates.length}`, status: "succeeded" };
        if (c instanceof Error) return Promise.reject(c);
        log.keys.set(o.idempotencyKey, { sig, answer: { id: c.id, status: c.status } });
        if (opts.lostAnswer === true) return Promise.reject(new Error("socket hang up (the provider created it)"));
        return Promise.resolve({ id: c.id, status: c.status });
      },
      retrieve: (id) => {
        log.retrieves.push(id);
        const r = opts.retrieve?.[id] ?? { status: "pending" };
        return r instanceof Error ? Promise.reject(r) : Promise.resolve({ id, status: r.status });
      },
      list: (p) => {
        log.lists.push(String(p.payment_intent));
        if (opts.list instanceof Error) return Promise.reject(opts.list);
        return Promise.resolve({ data: opts.list ?? [], has_more: false });
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

const newLog = (): StripeLog => ({ creates: [], retrieves: [], lists: [], keys: new Map(), idempotencyErrors: [] });
const outcomes = (db: ReturnType<typeof scripted>) =>
  db.calls.filter((c) => c.fn === "issue_4522_finish_overpayment_refund")
    .map((c) => `${c.args?.p_attempt_no}:${c.args?.p_outcome}:${c.args?.p_provider_refund_id ?? "-"}`);

Deno.test("T3 constants mirror the SQL", async () => {
  const sql = await Deno.readTextFile(new URL(
    "../../../../migrations/20281125044522_issue_4522_flex_payments.sql",
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

Deno.test("rework 7 Paystack: a stored refund is looked up by id; an unanswered one is only looked for, NEVER re-sent", async () => {
  const ps = { ...plan, provider: "paystack", providerRef: "mingla-inst-flex-l1", currency: "NGN" };
  const note = "mingla_overpay_refund:op-1:2";
  const run = async (listed: Array<{ id: string; amount: number; status: string; merchantNote: string }> | null | Error) => {
    const looked: string[] = [];
    const sent: unknown[] = [];
    const asked: unknown[] = [];
    const db = scripted({
      issue_4522_begin_overpayment_refund: [{ ...ps, action: "verify", attempts: [
        { attemptNo: 1, state: "pending", amountMinor: 10200, providerRefundId: "rfd_1" },
        { attemptNo: 2, state: "creating", amountMinor: 5000, providerRefundId: null, idempotencyKey: note },
      ] }],
      issue_4522_finish_overpayment_refund: [{ ok: true, state: "refund_pending" }],
    });
    const outcome = await returnOverpayment(deps(db, stripe(newLog()), [], {
      getPaystackRefund: (id: string) => {
        looked.push(id);
        return Promise.resolve({ id, amount: 10200, status: "processing", currency: "NGN", integration: null, transaction: "x", replayed: true });
      },
      listPaystackRefunds: (p) => {
        asked.push(p);
        return listed instanceof Error ? Promise.reject(listed) : Promise.resolve(listed);
      },
      // deno-lint-ignore no-explicit-any
      createPaystackRefund: ((p: unknown) => { sent.push(p); return Promise.reject(new Error("must not be called")); }) as any,
    }), "op-1");
    return { outcome, looked, sent, asked, recorded: outcomes(db) };
  };
  // listed with its merchant note and amount: adopted by its id
  const found = await run([{ id: "rfd_9", amount: 5000, status: "pending", merchantNote: "other" },
    { id: "rfd_2", amount: 5000, status: "processed", merchantNote: note }]);
  assertEquals([found.outcome, found.looked, found.sent, found.recorded],
    ["pending", ["rfd_1"], [], ["1:pending:rfd_1", "2:succeeded:rfd_2"]]);
  assertEquals(found.asked, [{ transaction: "mingla-inst-flex-l1", currency: "NGN" }]);
  // not listed yet, a full page, an unreadable list: stays open (unknown), nothing sent
  for (const listed of [[], [{ id: "rfd_3", amount: 4999, status: "pending", merchantNote: note }], null, new Error("down")]) {
    const r = await run(listed);
    assertEquals([r.outcome, r.sent, r.recorded], ["unknown", [], ["1:pending:rfd_1", "2:unknown:-"]]);
  }
});

Deno.test("rework 7 Paystack: an unconfirmed refund goes to ops once with the charge, owed amount, when sent and what to do", async () => {
  const ps = { ...plan, provider: "paystack", providerRef: "ps_ref_7", currency: "NGN", refundMinor: 500000, remainingMinor: 500000 };
  const attempt = { attemptNo: 1, state: "creating", amountMinor: 500000, providerRefundId: null,
    idempotencyKey: "mingla_overpay_refund:op-1:1", createdAt: "2028-11-25T10:00:00+00:00" };
  const db = scripted({
    issue_4522_begin_overpayment_refund: [{ ...ps, action: "verify", alertOps: true, alertKind: "provider_refund_unconfirmed", attempts: [attempt] }],
    issue_4522_finish_overpayment_refund: [{ ok: true, state: "needs_ops" }],
  });
  const alerts: Array<{ s: string; p: string[] }> = [];
  const sent: unknown[] = [];
  const outcome = await returnOverpayment(deps(db, stripe(newLog()), [], {
    listPaystackRefunds: () => Promise.resolve([]),
    // deno-lint-ignore no-explicit-any
    createPaystackRefund: ((p: unknown) => { sent.push(p); return Promise.reject(new Error("must not be called")); }) as any,
    alertOps: (s, p) => { alerts.push({ s, p }); return Promise.resolve(); },
  }), "op-1");
  assertEquals([outcome, sent.length, alerts.length], ["unknown", 0, 1]);
  assertEquals(alerts[0].s, "Trip overpayment refund not confirmed by the provider");
  const copy = alerts[0].p.join(" ");
  for (const part of ["Charge (paystack): ps_ref_7", "Still owed back to the traveler: 500000 (NGN minor units)",
    "Refund sent: 500000 (NGN minor units) at 2028-11-25T10:00:00+00:00", "check the provider dashboard",
    "If no refund exists, use issue_4522_resolve_overpayment_by_ops(<overpayment>, 'retry', <your user id>)",
    "If one exists, do nothing: Mingla keeps checking and adopts it automatically"]) {
    assert(copy.includes(part), `${part} :: ${copy}`);
  }
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

// ── T4-1 (fourth rework): a lost answer must never become a second refund ──

const OPU = "8f8f8f8f-1111-4222-8333-444455556666";

Deno.test("T4-1 lost answer: the re-send is the IDENTICAL request, so the provider replays it — one refund, never failed", async () => {
  const log = newLog();
  const created = { ...create(1), refundId: "9a9a9a9a-0000-4000-8000-000000000001" };
  // pass 1: the provider creates re_1 but the answer is lost
  let db = scripted({ issue_4522_begin_overpayment_refund: [created],
    issue_4522_finish_overpayment_refund: [{ ok: true, state: "refund_pending" }] });
  assertEquals(await returnOverpayment(deps(db, stripe(log, { create: { id: "re_1", status: "succeeded" }, lostAnswer: true })), "op-1"),
    "unknown");
  assertEquals(outcomes(db), ["1:unknown:-"]);
  // pass 2 (inside the key window): verify re-sends from the STORED attempt row (refund id included)
  db = scripted({
    issue_4522_begin_overpayment_refund: [verify([{ attemptNo: 1, state: "creating", amountMinor: 30000, providerRefundId: null,
      idempotencyKey: "mingla_overpay_refund:op-1:1", refundId: "9a9a9a9a-0000-4000-8000-000000000001", withinKeyWindow: true }]),
      { ok: true, done: true, state: "refunded" }],
    issue_4522_finish_overpayment_refund: [{ ok: true, state: "refunded" }],
  });
  assertEquals(await returnOverpayment(deps(db, stripe(log)), "op-1"), "succeeded");
  assertEquals(log.idempotencyErrors, [], "the provider refused a re-send whose parameters differed");
  assertEquals(log.keys.size, 1, "exactly one refund exists at the provider");
  assertEquals(log.creates.length, 2);
  assertEquals(log.creates[1], log.creates[0]);
  assertEquals(outcomes(db), ["1:succeeded:re_1"]);
});

Deno.test("T4-1 an unknown re-send is looked up on the charge; inside the key window it never becomes failed", async () => {
  const attempt = (within: boolean) => verify([{ attemptNo: 1, state: "creating", amountMinor: 30000, providerRefundId: null,
    idempotencyKey: "mingla_overpay_refund:op-1:1", refundId: "rf-1", withinKeyWindow: within }]);
  const idem = Object.assign(new Error("idempotency"), { statusCode: 400, type: "StripeIdempotencyError", rawType: "idempotency_error" });
  // listed with our metadata: adopted by its id
  let db = scripted({ issue_4522_begin_overpayment_refund: [attempt(true)],
    issue_4522_finish_overpayment_refund: [{ ok: true, state: "refund_pending" }] });
  let log = newLog();
  await returnOverpayment(deps(db, stripe(log, { create: idem, list: [
    { id: "re_found", status: "pending", metadata: { mingla_overpayment_id: "op-1", mingla_overpayment_attempt: "1" } }] })), "op-1");
  assertEquals(outcomes(db), ["1:pending:re_found"]);
  // not listed, inside the window: stays open (unknown); unreadable list: unknown
  for (const list of [[], new Error("list down")]) {
    db = scripted({ issue_4522_begin_overpayment_refund: [attempt(true)],
      issue_4522_finish_overpayment_refund: [{ ok: true, state: "refund_pending" }] });
    log = newLog();
    assertEquals(await returnOverpayment(deps(db, stripe(log, { create: idem, list })), "op-1"), "unknown");
    assertEquals(outcomes(db), ["1:unknown:-"]);
  }
});

Deno.test("T4-1 before any new attempt the charge's refunds are adopted; an unreadable list creates nothing", async () => {
  const reconcile = { ...plan, overpaymentId: OPU, action: "reconcile" };
  const listed = [
    { id: "re_ours", status: "succeeded", metadata: { mingla_overpayment_id: OPU, mingla_overpayment_attempt: "1" } },
    { id: "re_dash", status: "succeeded", metadata: {} },
  ];
  const db = scripted({
    issue_4522_begin_overpayment_refund: [reconcile, { ok: true, done: true, state: "refunded" }],
    issue_4522_overpayment_refund_event: [{ handled: true, results: [] }],
  });
  const log = newLog();
  assertEquals(await returnOverpayment(deps(db, stripe(log, { list: listed })), OPU), "done");
  assertEquals(log.creates, []);
  assertEquals(db.calls.filter((c) => c.fn === "issue_4522_begin_overpayment_refund").map((c) => c.args?.p_reconciled), [false, true]);
  const events = db.calls.filter((c) => c.fn === "issue_4522_overpayment_refund_event").map((c) => c.args);
  assertEquals(events.map((e) => [e?.p_provider_refund_id, e?.p_overpayment_id, e?.p_attempt_no, e?.p_mingla_created, e?.p_payment_ref]), [
    ["re_ours", OPU, 1, true, "pi_flex"],
    ["re_dash", null, null, false, "pi_flex"],
  ]);
  // the list cannot be read: nothing is created, the plan is not asked to reserve
  const db2 = scripted({ issue_4522_begin_overpayment_refund: [reconcile, create(1)] });
  const log2 = newLog();
  assertEquals(await returnOverpayment(deps(db2, stripe(log2, { list: new Error("down") })), OPU), "unknown");
  assertEquals(log2.creates, []);
  assertEquals(db2.calls.filter((c) => c.fn === "issue_4522_begin_overpayment_refund").length, 1);
});

Deno.test("T4-1 Paystack: the transaction's refunds are adopted before a new attempt (merchant note names ours)", async () => {
  const reconcile = { ...plan, overpaymentId: OPU, provider: "paystack", providerRef: "mingla-inst-flex-l1", currency: "NGN",
    action: "reconcile" };
  const db = scripted({
    issue_4522_begin_overpayment_refund: [reconcile, { ok: true, done: true }],
    issue_4522_overpayment_refund_event: [{ handled: true, results: [] }],
  });
  const asked: unknown[] = [];
  await returnOverpayment(deps(db, stripe(newLog()), [], {
    listPaystackRefunds: (p) => {
      asked.push(p);
      return Promise.resolve([{ id: "rfd_7", amount: 10200, status: "processed", merchantNote: `mingla_overpay_refund:${OPU}:1` }]);
    },
  }), OPU);
  assertEquals(asked, [{ transaction: "mingla-inst-flex-l1", currency: "NGN" }]);
  const e = db.calls.find((c) => c.fn === "issue_4522_overpayment_refund_event")?.args;
  assertEquals([e?.p_provider, e?.p_provider_refund_id, e?.p_status, e?.p_overpayment_id, e?.p_attempt_no, e?.p_amount_minor],
    ["paystack", "rfd_7", "succeeded", OPU, 1, 10200]);
  // a full page (null) or a failed read: nothing created
  for (const answer of [null, new Error("down")]) {
    const db2 = scripted({ issue_4522_begin_overpayment_refund: [reconcile, create(1)] });
    const sent: unknown[] = [];
    assertEquals(await returnOverpayment(deps(db2, stripe(newLog()), [], {
      listPaystackRefunds: () => answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer),
      // deno-lint-ignore no-explicit-any
      createPaystackRefund: ((p: unknown) => { sent.push(p); return Promise.reject(new Error("must not be called")); }) as any,
    }), OPU), "unknown");
    assertEquals(sent, []);
  }
});

Deno.test("T4-1 a second sweep while another worker is sending does nothing (busy)", async () => {
  const db = scripted({ issue_4522_begin_overpayment_refund: [{ ok: false, reason: "busy" }] });
  const log = newLog();
  assertEquals(await returnOverpayment(deps(db, stripe(log)), "op-1"), "skipped");
  assertEquals([log.creates.length, log.lists.length, log.retrieves.length], [0, 0, 0]);
});

Deno.test("T4-1 a late refund that went past the amount: one alert with the exact extra amount", async () => {
  const db = scripted({ issue_4522_overpayment_refund_event: [{ handled: true, results: [{ ok: true, state: "needs_ops",
    alertOps: true, alertKind: "provider_refunded_more", overRefundedMinor: 30000, overpaymentId: OPU, orderId: "order-1",
    currency: "USD", providerRef: "pi_flex", remainingMinor: 0 }] }] });
  const alerts: Array<{ s: string; p: string[] }> = [];
  assertEquals(await applyOverpaymentRefundEvent(db.client,
    stripeOverpaymentRefundEvent({ id: "re_1", status: "succeeded", amount: 30000, payment_intent: "pi_flex",
      metadata: { mingla_overpayment_id: OPU, mingla_overpayment_attempt: "1" } }),
    (s, p) => { alerts.push({ s, p }); return Promise.resolve(); }), true);
  assertEquals(alerts.length, 1);
  assertEquals(alerts[0].s, "Trip overpayment refunded more than owed");
  assert(alerts[0].p[0].includes("refunded 30000 (USD minor units) more than this overpayment"), alerts[0].p[0]);
});

Deno.test("T5-1 a second Paystack refund for one attempt is never silent: one alert naming the charge, owed and refunded", async () => {
  const extra = { alertOps: true, alertKind: "provider_refunded_more", overRefundedMinor: 500000, refundMinor: 500000,
    refundedMinor: 1000000, state: "needs_ops" };
  // (a) worker A's create answer arrives late, naming a refund other than the one recorded.
  const db = scripted({
    issue_4522_begin_overpayment_refund: [{ ...create(1, 500000), provider: "paystack", providerRef: "ps_ref_1",
      currency: "NGN", refundMinor: 500000, remainingMinor: 500000 }],
    issue_4522_finish_overpayment_refund: [{ ok: false, reason: "provider_refund_id_mismatch", attemptNo: 1, ...extra }],
  });
  const alerts: Array<{ s: string; p: string[] }> = [];
  const outcome = await returnOverpayment(deps(db, stripe(newLog()), [], {
    createPaystackRefund: () => Promise.resolve({ id: "9002", status: "pending" } as never),
    alertOps: (s, p) => { alerts.push({ s, p }); return Promise.resolve(); },
  }), "op-1");
  assertEquals(outcome, "needs_ops");
  assertEquals(alerts.length, 1);
  const copy = alerts[0].p.join(" ");
  assert(copy.includes("Charge (paystack): ps_ref_1"), copy);
  assert(copy.includes("Owed back to the traveler for this overpayment: 500000 (NGN minor units)"), copy);
  assert(copy.includes("Refunded to the traveler on the charge for it: 1000000 (NGN minor units)"), copy);
  // (b) the duplicate's webhook: alerted when the database records it, silent on its replay.
  const hook = scripted({ issue_4522_overpayment_refund_event: [
    { handled: true, matchedBy: "none", results: [{ ...extra, overpaymentId: OPU, orderId: "order-1", currency: "NGN",
      providerRef: "ps_ref_1" }] },
    { handled: true, matchedBy: "none", results: [] },
  ] });
  const hooked: string[] = [];
  const event = paystackOverpaymentRefundEvent("refund.processed", "9004", `mingla_overpay_refund:${OPU}:1`, "ps_ref_1", 500000);
  const push = (s: string, p: string[]) => { hooked.push(`${s} | ${p.join(" ")}`); return Promise.resolve(); };
  assertEquals(await applyOverpaymentRefundEvent(hook.client, event, push), true);
  assertEquals(await applyOverpaymentRefundEvent(hook.client, event, push), true);
  assertEquals(hooked.length, 1);
  assert(hooked[0].includes("Refunded to the traveler on the charge for it: 1000000 (NGN minor units)"), hooked[0]);
});

Deno.test("T6-3 the refunded-more alert names the ops action; T6-2 its numbers name what is pending and never say '0 more'", () => {
  const base = { ...plan, provider: "paystack", providerRef: "ps_ref_1", currency: "NGN", refundMinor: 500000 };
  const more = overpaymentAlert("provider_refunded_more",
    { ...base, overRefundedMinor: 500000, refundedMinor: 1000000, pendingMinor: 500000 }, null)!.paragraphs.join(" ");
  assert(more.includes("issue_4522_resolve_overpayment_by_ops(<overpayment>, 'retry', <your user id>)"), more);
  assert(more.includes("Do not use 'refunded_by_hand' for this case"), more);
  assert(more.includes("Of that, 500000 (NGN minor units) is still pending at the provider"), more);
  const notMore = overpaymentAlert("provider_refunded_more",
    { ...base, overRefundedMinor: 0, refundedMinor: 500000, pendingMinor: 0 }, null)!.paragraphs.join(" ");
  assert(!notMore.includes("refunded 0 ("), notMore);
  assert(notMore.includes("has not been refunded more than this overpayment"), notMore);
  assert(!notMore.includes("still pending at the provider and may yet fail"), notMore);
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
