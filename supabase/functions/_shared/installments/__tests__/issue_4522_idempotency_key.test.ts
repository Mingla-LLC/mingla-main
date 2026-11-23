/**
 * issue #4522 — I-4522-5: a changed instalment amount never reuses a Stripe
 * idempotency key. Version 0 keeps today's key byte for byte (SC-9).
 */
// MINGLA-INVARIANT: I-4522-5 | issue #4522 | A rebalanced instalment row's Stripe idempotency key carries its schedule version, so a changed amount never reuses a key; version 0 keeps the legacy key.
import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  flexPaymentIdempotencyKey,
  installmentIdempotencyKey,
  installmentKeyVersionSuffix,
} from "../installmentIdempotencyKey.ts";
import { resetPlanV2SchemaProbeForTests } from "../planV2Schema.ts";
import { createInstallmentPI } from "../createInstallmentPI.ts";

const source = await Deno.readTextFile(
  new URL("../createInstallmentPI.ts", import.meta.url),
);

Deno.test("version 0 keeps the legacy key; a rebalanced row adds :v<n>", () => {
  assertEquals(
    installmentIdempotencyKey({ orderId: "o1", ordinal: 2, retryCount: 1 }),
    "installment:o1:2:1",
  );
  assertEquals(
    installmentIdempotencyKey({
      orderId: "o1",
      ordinal: 2,
      retryCount: 1,
      scheduleVersion: 0,
    }),
    "installment:o1:2:1",
  );
  assertEquals(
    installmentIdempotencyKey({
      orderId: "o1",
      ordinal: 2,
      retryCount: 0,
      scheduleVersion: 1,
    }),
    "installment:o1:2:0:v1",
  );
  assertEquals(installmentKeyVersionSuffix(null), "");
  assertEquals(installmentKeyVersionSuffix(3), ":v3");
  assertEquals(
    flexPaymentIdempotencyKey("o1", "client-key-1"),
    "flex:o1:client-key-1",
  );
});

Deno.test("createInstallmentPI builds its key with the version suffix and reads the version", () => {
  assertMatch(
    source,
    /`installment:\$\{installment\.order_id\}:\$\{installment\.ordinal\}:\$\{installment\.retry_count\}` \+\n\s+installmentKeyVersionSuffix\(installment\.schedule_version\);/,
  );
  assertMatch(
    source,
    /retry_count, stripe_payment_intent_id, schedule_version"/,
  );
});

// ── I-4522-CHARGE-IS-WHAT-IS-OWED: the Stripe confirm waits for the mark ────

function chargeWorld(markAnswer: Record<string, unknown>, opts: {
  confirmError?: Error;
  claimAnswer?: Record<string, unknown>;
  schemaMissing?: boolean;
} = {}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const stripeCalls: string[] = [];
  const updates: Record<string, unknown>[] = [];
  const supabase = {
    rpc(name: string, args: Record<string, unknown> = {}) {
      rpcCalls.push({ name, args });
      if (name === "issue_4522_plan_v2_enabled") {
        return Promise.resolve(opts.schemaMissing === true
          ? { data: null, error: { code: "42883", message: "function does not exist" } }
          : { data: true, error: null });
      }
      if (name === "claim_order_installment_for_charge") {
        return Promise.resolve({ data: opts.claimAnswer ?? { ok: true }, error: null });
      }
      if (name === "issue_4522_mark_stripe_charge_in_flight") return Promise.resolve({ data: markAnswer, error: null });
      if (name === "resolve_effective_take_rate_bps") {
        return Promise.resolve({ data: [{ effective_take_rate_bps: 150, take_rate_source: "default" }], error: null });
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from() {
      const chain = {
        update(payload: Record<string, unknown>) { updates.push(payload); return chain; },
        eq() { return chain; },
        insert() { return Promise.resolve({ error: null }); },
        then(resolve: (v: { data: null; error: null }) => void) { resolve({ data: null, error: null }); },
      };
      return chain;
    },
  };
  const stripe = {
    paymentIntents: {
      create(params: Record<string, unknown>) {
        stripeCalls.push(`create:${params.amount}`);
        return Promise.resolve({ id: "pi_new", status: "requires_confirmation" });
      },
      confirm() {
        stripeCalls.push("confirm");
        return opts.confirmError !== undefined
          ? Promise.reject(opts.confirmError)
          : Promise.resolve({ id: "pi_new", status: "succeeded" });
      },
      cancel() { stripeCalls.push("cancel"); return Promise.resolve({ id: "pi_new", status: "canceled" }); },
    },
    refunds: { create() { stripeCalls.push("refund"); return Promise.resolve({}); } },
  };
  const input = {
    installmentId: "inst_1",
    brandId: "brand_1",
    supabase: supabase as never,
    stripe: stripe as never,
    installment: {
      id: "inst_1", order_id: "order_1", ordinal: 2, amount_cents: 15000, referral_share_minor: 0,
      currency: "USD", due_at: "2026-11-20T09:00:00Z", status: "scheduled", retry_count: 0,
      schedule_version: 1, stripe_payment_intent_id: null,
    },
    order: {
      id: "order_1", event_id: "event_1", stripe_customer_id_on_connected_account: "cus_1",
      saved_payment_method_id: "pm_1", buyer_user_id: null, buyer_email: "b@example.test", at_risk: false,
    },
    brand: { id: "brand_1", contact_email: null, name: "Brand" },
    stripeAccount: { brand_id: "brand_1", stripe_account_id: "acct_1" },
  };
  return { input, rpcCalls, stripeCalls, updates };
}

Deno.test("I-4522-CHARGE-IS-WHAT-IS-OWED: the row is marked in flight for the PaymentIntent's exact amount before it is confirmed", async () => {
  resetPlanV2SchemaProbeForTests();
  const w = chargeWorld({ ok: true, marked: true });
  const result = await createInstallmentPI(w.input as never);
  assertEquals(result.outcome, "collected");
  const mark = w.rpcCalls.find((c) => c.name === "issue_4522_mark_stripe_charge_in_flight");
  assertEquals(mark?.args, {
    p_installment_id: "inst_1", p_payment_intent_id: "pi_new", p_amount_cents: 15000, p_schedule_version: 1,
  });
  assertEquals(w.stripeCalls, ["create:15000", "confirm"]);
  // the mark replaces the pre-confirm re-claim; the post-confirm claim stays
  assertEquals(w.rpcCalls.filter((c) => c.name === "claim_order_installment_for_charge").length, 2);
});

Deno.test("I-4522-CHARGE-IS-WHAT-IS-OWED: a row that changed since its amount was read is never confirmed", async () => {
  resetPlanV2SchemaProbeForTests();
  const w = chargeWorld({ ok: false, reason: "balance_changed", amount_cents: 20000, schedule_version: 2 });
  const result = await createInstallmentPI(w.input as never);
  assertEquals(result, { ok: false, error: "balance_changed", outcome: "skipped", reason: "balance_changed", chargeId: "pi_new" });
  assertEquals(w.stripeCalls, ["create:15000", "cancel"]);
  // skipped, not failed: no failure written, no retry spent, no dunning
  assertEquals(w.updates.length, 0);
});

// ── rework 9 (T8-2): an unknown confirm answer leaves the marked row in flight ──
// FAILS-ON-REVERT: mark the row failed on any confirm error again (drop the
// isDefiniteStripeDecline / confirmSent branch in createInstallmentPI) -> red.
const failedUpdates = (w: ReturnType<typeof chargeWorld>) => w.updates.filter((u) => u.status === "failed");

Deno.test("rework 9 T8-2: a confirm whose answer is lost (network, 5xx, 409, 429) keeps the marked row in flight, never failed", async () => {
  const errors = [
    new Error("socket hang up"),
    Object.assign(new Error("An error occurred with our connection to Stripe."), { type: "StripeConnectionError" }),
    Object.assign(new Error("api error"), { type: "StripeAPIError", statusCode: 500 }),
    Object.assign(new Error("in use"), { type: "StripeIdempotencyError", statusCode: 409 }),
    Object.assign(new Error("rate"), { type: "StripeRateLimitError", statusCode: 429 }),
    Object.assign(new Error("state"), { type: "StripeInvalidRequestError", statusCode: 400, code: "payment_intent_unexpected_state" }),
  ];
  for (const confirmError of errors) {
    resetPlanV2SchemaProbeForTests();
    const w = chargeWorld({ ok: true, marked: true }, { confirmError });
    const result = await createInstallmentPI(w.input as never);
    assertEquals([result.outcome, result.reason], ["unknown", "confirm_answer_unknown"], confirmError.message);
    assertEquals(w.stripeCalls, ["create:15000", "confirm"]);
    assertEquals(failedUpdates(w).length, 0, "an unknown answer never marks the row failed");
  }
});

Deno.test("rework 9 T8-2: only the card's refusal (a card error) marks the row failed", async () => {
  resetPlanV2SchemaProbeForTests();
  const w = chargeWorld({ ok: true, marked: true }, {
    confirmError: Object.assign(new Error("Your card was declined."), { type: "StripeCardError", statusCode: 402, code: "card_declined" }),
  });
  const result = await createInstallmentPI(w.input as never);
  assertEquals(result.outcome, "failed");
  assertEquals(failedUpdates(w).length, 1);
});

Deno.test("rework 9 T8-2: before the #4522 schema (main's database) a lost confirm answer is handled exactly as main does (failed)", async () => {
  resetPlanV2SchemaProbeForTests();
  const w = chargeWorld({ ok: true, marked: true }, { confirmError: new Error("socket hang up"), schemaMissing: true });
  const result = await createInstallmentPI(w.input as never);
  assertEquals(result.outcome, "failed");
  assertEquals(failedUpdates(w).length, 1);
  assertEquals(w.rpcCalls.some((c) => c.name === "issue_4522_mark_stripe_charge_in_flight"), false);
  resetPlanV2SchemaProbeForTests();
});

// ── rework 9 (T8-5): the "too small to charge" ops alert on the card path ──
// FAILS-ON-REVERT: drop alertUnchargeableRemainder from createInstallmentPI's claim refusal -> red.
Deno.test("rework 9 T8-5: a claim refused as below the provider minimum alerts ops once and never calls Stripe", async () => {
  for (const alertOps of [true, false]) {
    resetPlanV2SchemaProbeForTests();
    const w = chargeWorld({ ok: true, marked: true }, {
      claimAnswer: { ok: false, reason: "below_provider_minimum", alertOps, remainingMinor: 49, order_id: "order_1", currency: "USD" },
    });
    const alerts: Array<{ subject: string; paragraphs: string[] }> = [];
    const result = await createInstallmentPI({
      ...(w.input as Record<string, unknown>),
      alertOps: (subject: string, paragraphs: string[]) => { alerts.push({ subject, paragraphs }); return Promise.resolve(); },
    } as never);
    assertEquals([result.outcome, result.reason], ["skipped", "below_provider_minimum"]);
    assertEquals(w.stripeCalls, []);
    assertEquals(alerts.map((a) => a.subject), alertOps ? ["A trip balance is too small to charge"] : []);
    if (alertOps) assertMatch(alerts[0].paragraphs.join(" "), /order_1; amount: 49 USD/);
  }
});

// ── Pass 5 (F-4 / T9-3, same defect on main): a success webhook that lands
// before the worker's post-confirm re-check is the charge applied, never a
// refund. One in-memory row shared by the real worker (createInstallmentPI),
// the real webhook handler and the real read-back (reconcileMarkedStripeCharges).
// FAILS-ON-REVERT: the worker refunded the whole charge while the row stayed
// "collected" (traveler refunded AND host paid).
import { handleInstallmentPaymentSucceeded } from "../../installmentWebhookHandlers.ts";
import { reconcileMarkedStripeCharges } from "../flexReclaim.ts";

type Row = Record<string, unknown>;

function settleWorld(opts: { main?: boolean; cancelDuringConfirm?: boolean } = {}) {
  const row: Row = {
    id: "inst_1", order_id: "order_1", ordinal: 2, amount_cents: 15000, kind: "scheduled", status: "scheduled",
    stripe_payment_intent_id: null, stripe_charge_id: null, cancelled_at: null, collected_at: null,
    payout_accounting_state: "not_ready", application_fee_amount_cents: null, failed_at: null,
  };
  const stripeCalls: string[] = [];
  const collectedWrites: string[] = [];
  const audits: string[] = [];
  const missing = { code: "42703", message: "column order_installments.kind does not exist" };
  const matches = (filters: Array<[string, string, unknown]>) =>
    filters.every(([kind, col, val]) =>
      kind === "eq" ? row[col] === val
      : kind === "in" ? (val as unknown[]).includes(row[col])
      : kind === "is" ? row[col] === val
      : true
    );
  const claim = () =>
    ["scheduled", "failed"].includes(String(row.status)) && row.cancelled_at === null
      ? { ok: true }
      : row.cancelled_at !== null
      ? { ok: false, reason: "order_cancelled" }
      : { ok: false, reason: "installment_not_chargeable", status: row.status };
  const supabase = {
    rpc(name: string, _args: Record<string, unknown> = {}) {
      const ok = (data: unknown) => Promise.resolve({ data, error: null });
      switch (name) {
        case "issue_4522_plan_v2_enabled":
          return opts.main === true
            ? Promise.resolve({ data: null, error: { code: "42883", message: "function does not exist" } })
            : ok(true);
        case "claim_order_installment_for_charge": return ok(claim());
        case "issue_4522_mark_stripe_charge_in_flight": {
          const c = claim();
          if (c.ok) row.stripe_payment_intent_id = _args.p_payment_intent_id;
          return ok(c.ok ? { ...c, marked: true } : c);
        }
        case "resolve_effective_take_rate_bps":
          return ok([{ effective_take_rate_bps: 150, take_rate_source: "default" }]);
        case "issue_4522_record_short_collection": return ok({ ok: true, shortMinor: 0 });
        case "record_order_installment_provider_sale":
          row.payout_accounting_state = "ready";
          row.application_fee_amount_cents = _args.p_application_fee_amount_cents;
          return ok({ ok: true });
        case "issue_3645_clear_at_risk_if_settled": return ok(null);
        case "issue_4522_claim_paid_in_full_notice": return ok(false);
        default: throw new Error(`unexpected rpc ${name}`);
      }
    },
    from(table: string) {
      const op = { kind: "select", columns: "", values: null as Row | null, filters: [] as Array<[string, string, unknown]>, head: false };
      const run = () => {
        if (table === "audit_log") {
          audits.push(String((op.values as Row)?.action ?? ""));
          return { data: null, error: null };
        }
        if (table !== "order_installments") return { data: null, error: null };
        if (opts.main === true && op.columns.includes("kind")) return { data: null, error: missing };
        if (op.kind === "update") {
          if (!matches(op.filters)) return { data: null, error: null };
          if (op.values?.status === "collected") collectedWrites.push(String(op.values.stripe_payment_intent_id));
          Object.assign(row, op.values);
          return { data: { ...row }, error: null };
        }
        if (op.head) return { data: null, error: null, count: 1 };
        return { data: matches(op.filters) ? { ...row } : null, error: null };
      };
      const chain: Record<string, unknown> = {};
      const f = (kind: string) => (col: string, val: unknown) => { op.filters.push([kind, col, val]); return chain; };
      Object.assign(chain, {
        select(columns?: string, o?: { head?: boolean }) { if (op.kind === "select") op.columns = columns ?? "*"; if (o?.head) op.head = true; return chain; },
        update(values: Row) { op.kind = "update"; op.values = values; return chain; },
        insert(values: Row) { op.kind = "insert"; op.values = values; return Promise.resolve(run()); },
        eq: f("eq"), in: f("in"), is: f("is"), neq: f("neq"), limit: () => chain, order: () => chain,
        maybeSingle: () => Promise.resolve(run()),
        single: () => Promise.resolve(run()),
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) { return Promise.resolve(run()).then(resolve, reject); },
      });
      return chain;
    },
  };
  const succeededPi = () => ({
    id: "pi_new", object: "payment_intent", status: "succeeded", amount: 15000, amount_received: 15000,
    application_fee_amount: 225, latest_charge: "ch_new",
    metadata: { mingla_installment_id: "inst_1", mingla_order_id: "order_1", mingla_brand_id: "brand_1" },
  });
  const webhook = () =>
    handleInstallmentPaymentSucceeded(supabase as never, { type: "payment_intent.succeeded", data: { object: succeededPi() } });
  const readBack = () =>
    reconcileMarkedStripeCharges({
      supabase: supabase as never,
      stripe: () => ({
        paymentIntents: {
          retrieve: () => { stripeCalls.push("retrieve"); return Promise.resolve(succeededPi()); },
          cancel: () => { stripeCalls.push("cancel"); return Promise.reject(new Error("no")); },
        },
      }) as never,
      stripeAccountFor: () => Promise.resolve("acct_1"),
      settleStripe: async (pi) => { await handleInstallmentPaymentSucceeded(supabase as never, { type: "payment_intent.succeeded", data: { object: pi } }); },
      failStripe: () => Promise.resolve(),
    }, [{ installmentId: "inst_1", orderId: "order_1", paymentIntentId: String(row.stripe_payment_intent_id ?? "pi_new"), marked: true, pastCeiling: false }]);
  let duringConfirm: () => Promise<unknown> = () => Promise.resolve();
  const stripe = {
    paymentIntents: {
      create(params: Row) { stripeCalls.push(`create:${params.amount}`); return Promise.resolve({ id: "pi_new", status: "requires_confirmation" }); },
      async confirm() {
        stripeCalls.push("confirm");
        await duringConfirm();
        if (opts.cancelDuringConfirm === true) { row.status = "cancelled"; row.cancelled_at = "2026-11-23T00:00:00Z"; }
        return { id: "pi_new", status: "succeeded" };
      },
      cancel() { stripeCalls.push("cancel"); return Promise.resolve({ id: "pi_new", status: "canceled" }); },
    },
    refunds: { create() { stripeCalls.push("refund"); return Promise.resolve({ id: "re_1" }); } },
  };
  const alerts: string[] = [];
  const input = {
    installmentId: "inst_1", brandId: "brand_1", supabase: supabase as never, stripe: stripe as never,
    alertOps: (subject: string) => { alerts.push(subject); return Promise.resolve(); },
    installment: {
      id: "inst_1", order_id: "order_1", ordinal: 2, amount_cents: 15000, referral_share_minor: 0,
      currency: "USD", due_at: "2026-11-20T09:00:00Z", status: "scheduled", retry_count: 0,
      schedule_version: 0, stripe_payment_intent_id: null,
    },
    order: {
      id: "order_1", event_id: "event_1", stripe_customer_id_on_connected_account: "cus_1",
      saved_payment_method_id: "pm_1", buyer_user_id: null, buyer_email: "b@example.test", at_risk: false,
    },
    brand: { id: "brand_1", contact_email: null, name: "Brand" },
    stripeAccount: { brand_id: "brand_1", stripe_account_id: "acct_1" },
  };
  return {
    row, stripeCalls, collectedWrites, audits, alerts, webhook, readBack,
    run: (during: () => Promise<unknown>) => { duringConfirm = during; return createInstallmentPI(input as never); },
  };
}

const prevSuppressedLog = console.log;
Deno.test("F-4: every interleaving of {worker re-check, success webhook, read-back}: one charge, zero refunds, row collected once", async () => {
  const savedEnv = Deno.env.get("SUPABASE_URL");
  Deno.env.delete("SUPABASE_URL"); // no email dispatch in this test
  console.log = () => {};
  try {
    const orders: Array<[string, (w: ReturnType<typeof settleWorld>) => Promise<unknown>, (w: ReturnType<typeof settleWorld>) => Promise<unknown>]> = [
      ["webhook before the re-check", (w) => w.webhook(), async () => {}],
      ["webhook after the worker", async () => {}, (w) => w.webhook()],
      ["read-back before the re-check, webhook after", (w) => w.readBack(), (w) => w.webhook()],
      ["webhook before the re-check, read-back and a duplicate webhook after", (w) => w.webhook(), async (w) => { await w.readBack(); await w.webhook(); }],
      ["webhook and read-back both before the re-check", async (w) => { await w.webhook(); await w.readBack(); }, async () => {}],
    ];
    for (const main of [false, true]) {
      for (const [label, during, after] of orders) {
        if (main && label.includes("read-back")) continue; // no marked rows to read back on main's database
        resetPlanV2SchemaProbeForTests();
        const w = settleWorld({ main });
        const result = await w.run(() => during(w));
        await after(w);
        const tag = `${main ? "main db" : "v2 db"}: ${label}`;
        assertEquals(result.outcome, "collected", tag);
        assertEquals(w.stripeCalls.filter((c) => c === "confirm").length, 1, tag);
        assertEquals(w.stripeCalls.filter((c) => c === "refund").length, 0, tag);
        assertEquals([w.row.status, w.row.stripe_payment_intent_id, w.row.stripe_charge_id], ["collected", "pi_new", "ch_new"], tag);
        assertEquals(w.collectedWrites, ["pi_new"], `${tag}: collected exactly once`);
        assertEquals(w.row.payout_accounting_state, "ready", tag);
        assertEquals(w.alerts, [], tag);
      }
    }
  } finally {
    console.log = prevSuppressedLog;
    if (savedEnv !== undefined) Deno.env.set("SUPABASE_URL", savedEnv);
    resetPlanV2SchemaProbeForTests();
  }
});

Deno.test("F-4: a charge that truly cannot be applied (cancelled during the charge) is refunded once, the row stays cancelled, ops alerted once", async () => {
  for (const main of [false, true]) {
    resetPlanV2SchemaProbeForTests();
    const w = settleWorld({ main, cancelDuringConfirm: true });
    const result = await w.run(() => Promise.resolve());
    assertEquals([result.outcome, result.reason], ["skipped", "cancelled_during_charge_refunded"]);
    assertEquals(w.stripeCalls.filter((c) => c === "refund").length, 1);
    assertEquals(w.row.status, "cancelled");
    assertEquals(w.alerts, ["A trip payment was refunded as soon as it was taken"]);
    assertEquals(w.audits.includes("tr3.installment_cancelled_during_charge_refunded"), true);
  }
  resetPlanV2SchemaProbeForTests();
});
