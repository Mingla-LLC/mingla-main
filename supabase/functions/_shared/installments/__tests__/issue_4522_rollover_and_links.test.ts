/**
 * issue #4522 slice 6 — the Stripe paths roll a missed payment over before they
 * flag at risk; reminder, notice and dunning emails carry a "Pay toward your
 * balance" link only for a flexible v2 order; a manual charge refuses while a
 * traveler payment is processing.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { rollOverMissedPayment } from "../missedRollover.ts";
import { balanceLinkUrlForOrder } from "../balanceLinks.ts";
import { renderInstallmentReminderEmail } from "../../email/installmentReminderEmail.ts";
import { renderInstallmentDunningEmail } from "../../email/installmentDunningEmail.ts";
import { renderInstallmentPreChargeNoticeEmail } from "../../email/installmentPreChargeNoticeEmail.ts";
import { fakeSupabase } from "./issue_3645_fake_supabase.ts";
import { createInstallmentPI } from "../createInstallmentPI.ts";
import { resetPlanV2SchemaProbeForTests } from "../planV2Schema.ts";
import { handleInstallmentPaymentFailed } from "../../installmentWebhookHandlers.ts";
import { notifyPaystackInstallmentFailure } from "../chargePaystackInstallment.ts";

const read = (path: string) =>
  Deno.readTextFile(new URL(path, import.meta.url));

Deno.test("rollover: true only when the database rolled it over; an error flags at risk", async () => {
  const rolled = fakeSupabase({
    rpc: () => ({ data: { rolledOver: true }, error: null }),
  });
  // deno-lint-ignore no-explicit-any
  assertEquals(await rollOverMissedPayment(rolled.client as any, "i1"), true);
  const legacy = fakeSupabase({
    rpc: () => ({ data: { rolledOver: false }, error: null }),
  });
  // deno-lint-ignore no-explicit-any
  assertEquals(await rollOverMissedPayment(legacy.client as any, "i1"), false);
  const broken = fakeSupabase({
    rpc: () => ({ data: null, error: { message: "boom" } }),
  });
  // deno-lint-ignore no-explicit-any
  assertEquals(await rollOverMissedPayment(broken.client as any, "i1"), false);
});

Deno.test("both Stripe failure paths ask for a rollover before flagging at risk", async () => {
  for (
    const path of [
      "../createInstallmentPI.ts",
      "../../installmentWebhookHandlers.ts",
    ]
  ) {
    const src = await read(path);
    const roll = src.indexOf("rollOverMissedPayment(supabase");
    const flag = src.indexOf("at_risk: true,", roll);
    assert(
      roll > 0 && flag > roll,
      `${path}: rollover precedes the at-risk flag`,
    );
    assertStringIncludes(src, "const willBeAtRisk = lastRetry &&");
  }
});

Deno.test("a balance link is minted only for a flexible v2 order", async () => {
  const flexible = fakeSupabase({
    table: () => ({
      data: { payment_plan_terms: { v: 2, flex_enabled: true } },
      error: null,
    }),
    rpc: () => ({ data: { ok: true }, error: null }),
  });
  const url = await balanceLinkUrlForOrder(
    // deno-lint-ignore no-explicit-any
    flexible.client as any,
    "o1",
    () => "b".repeat(43),
  );
  assertEquals(url?.endsWith(`/pay/balance/${"b".repeat(43)}`), true);
  // #4522 rework F6: the schema probe first, then the link.
  assertEquals(
    flexible.rpcCalls.map((c) => c.name).filter((n) => n !== "issue_4522_plan_v2_enabled"),
    ["issue_4522_issue_balance_link"],
  );
  for (
    const terms of [null, { v: 2, flex_enabled: false }, { deposit_pct: 25 }]
  ) {
    const other = fakeSupabase({
      table: () => ({ data: { payment_plan_terms: terms }, error: null }),
    });
    // deno-lint-ignore no-explicit-any
    assertEquals(await balanceLinkUrlForOrder(other.client as any, "o1"), null);
    assertEquals(other.rpcCalls.length, 0);
  }
});

Deno.test("emails add the balance link only when given one", () => {
  const base = {
    buyerName: "Ada",
    buyerEmail: "a@example.test",
    tripTitle: "Lisbon",
    brandDisplayName: "Brand",
    nextInstallmentAmount: "₦300,000",
    nextInstallmentDueAt: "17 Dec",
    bookingId: "abcd1234",
    unsubscribeUrl: "https://usemingla.com/unsubscribe",
  };
  const without = renderInstallmentReminderEmail(base);
  assertEquals(without.htmlBody.includes("Pay toward your balance"), false);
  const withLink = renderInstallmentReminderEmail({
    ...base,
    balanceUrl: "https://host.usemingla.com/pay/balance/x",
  });
  assertStringIncludes(withLink.htmlBody, "Pay toward your balance");
  assertStringIncludes(
    withLink.textBody,
    "Pay toward your balance: https://host.usemingla.com/pay/balance/x",
  );
  const notice = renderInstallmentPreChargeNoticeEmail({
    buyerName: "Ada",
    tripTitle: "Lisbon",
    brandName: "Brand",
    amountCents: 30000000,
    currency: "NGN",
    dueAt: "2026-12-17T08:00:00Z",
    timezone: "Africa/Lagos",
    cardLast4: null,
    balanceUrl: "https://host.usemingla.com/pay/balance/y",
  });
  assertStringIncludes(notice.html, "Pay toward your balance");
  const dunning = renderInstallmentDunningEmail({
    recipient: { name: "Ada", email: "a@example.test" },
    trip: { title: "Lisbon" },
    installment: {
      ordinal: 1,
      amountCents: 30000000,
      currency: "NGN",
      failureReason: "card_declined",
      retryCount: 1,
      nextRetryAt: "2026-12-20T08:00:00Z",
    },
    brand: { name: "Brand", contactEmail: null },
    order: { shortId: "abcd1234" },
    balanceUrl: "https://host.usemingla.com/pay/balance/z",
  });
  assertStringIncludes(dunning.html, "Pay toward your balance");
  // A non-https value is never rendered as a link.
  assertEquals(
    renderInstallmentReminderEmail({
      ...base,
      balanceUrl: "javascript:alert(1)",
    }).htmlBody.includes("Pay toward your balance"),
    false,
  );
});

Deno.test("send-installment-reminder adds the link; manual charge refuses while a flexible payment is open", async () => {
  assertStringIncludes(
    await read("../../../send-installment-reminder/index.ts"),
    "const balanceUrl = await balanceLinkUrlForOrder(admin, body.orderId);",
  );
  assertStringIncludes(
    await read("../../../manual-charge-installment/index.ts"),
    'return jsonResponse({ ok: false, error: "flex_payment_in_flight" }, 409);',
  );
});

Deno.test("pre-charge and dunning senders mint and pass the optional balance link", async () => {
  const source = await read("../../../ticket-confirmation-dispatch/index.ts");
  assertStringIncludes(
    source,
    'import { balanceLinkUrlForOrder } from "../_shared/installments/balanceLinks.ts";',
  );

  const lifecycleStart = source.indexOf(
    "async function handleInstallmentLifecycleEmail(",
  );
  const dunningStart = source.indexOf(
    "async function handleInstallmentDunning(",
    lifecycleStart,
  );
  const paidInFullStart = source.indexOf(
    "async function handleInstallmentPaidInFull(",
    dunningStart,
  );
  assert(lifecycleStart >= 0 && dunningStart > lifecycleStart);
  assert(paidInFullStart > dunningStart);

  const lifecycle = source.slice(lifecycleStart, dunningStart);
  const dunning = source.slice(dunningStart, paidInFullStart);
  for (
    const [label, handler] of [
      ["pre-charge", lifecycle],
      ["dunning", dunning],
    ] as const
  ) {
    assertStringIncludes(
      handler,
      "const balanceUrl = await balanceLinkUrlForOrder(supabase, orderId);",
      `${label} must mint an eligible order's balance link`,
    );
    assertStringIncludes(
      handler,
      "balanceUrl,",
      `${label} must pass the link to its renderer`,
    );
  }
});

// ── issue #4522 E-1 (SC-8): a late failure for a rolled-over row never flags at risk ──

type Row = Record<string, unknown>;

/**
 * A small stateful database: updates honour their filters, the rollover RPC
 * behaves like `issue_4522_missed_rollover` (a failed row at its last retry
 * with a later open row is superseded and its amount moves to that row).
 */
function lifeWorld(opts: { planV2: boolean; laterRow?: boolean; v2Terms?: boolean }) {
  const tables: Record<string, Row[]> = {
    orders: [{
      id: "o1", event_id: "e1", stripe_customer_id_on_connected_account: "cus_1",
      saved_payment_method_id: "pm_1", buyer_user_id: null, buyer_email: "b@example.test",
      at_risk: false, cancelled_at: null,
      ...(opts.v2Terms === true ? { payment_plan_terms: { v: 2, auto_adjust: true } } : {}),
    }],
    order_installments: [
      { id: "r2", order_id: "o1", ordinal: 2, amount_cents: 60_000, referral_share_minor: 0, currency: "USD",
        due_at: "2027-01-15T14:00:00Z", status: "scheduled", retry_count: 2, kind: "scheduled",
        schedule_version: 0, stripe_payment_intent_id: null },
      ...(opts.laterRow === false ? [] : [{
        id: "r3", order_id: "o1", ordinal: 3, amount_cents: 60_000, referral_share_minor: 0, currency: "USD",
        due_at: "2027-02-10T14:00:00Z", status: "scheduled", retry_count: 0, kind: "scheduled",
        schedule_version: 0, stripe_payment_intent_id: null,
      }]),
    ],
    brands: [{ id: "b1", contact_email: null, name: "Brand" }],
    stripe_connect_accounts: [{ brand_id: "b1", stripe_account_id: "acct_1", detached_at: null }],
    audit_log: [],
  };
  const atRiskWrites: Row[] = [];
  const matches = (row: Row, filters: Array<[string, string, unknown]>) =>
    filters.every(([kind, col, val]) =>
      kind === "eq" ? row[col] === val
      : kind === "in" ? (val as unknown[]).includes(row[col])
      : kind === "is" ? (row[col] ?? null) === val
      : true
    );
  function from(table: string) {
    let kind: "select" | "update" | "insert" = "select";
    let values: Row = {};
    const filters: Array<[string, string, unknown]> = [];
    const run = () => {
      const rows = (tables[table] ??= []);
      if (kind === "insert") { rows.push(values); return { data: null, error: null }; }
      const hit = rows.filter((r) => matches(r, filters));
      if (kind === "update") {
        if (table === "orders" && values.at_risk === true) atRiskWrites.push(values);
        for (const r of hit) Object.assign(r, values);
        return { data: hit, error: null };
      }
      if (!opts.planV2 && table === "order_installments" && filters.length === 0) {
        return { data: null, error: { code: "42703", message: "column kind does not exist" } };
      }
      return { data: hit, error: null };
    };
    const chain: Record<string, unknown> = {
      select() { return chain; },
      update(v: Row) { kind = "update"; values = v; return chain; },
      insert(v: Row) { (tables[table] ??= []).push(v); return Promise.resolve({ error: null }); },
      eq(c: string, v: unknown) { filters.push(["eq", c, v]); return chain; },
      in(c: string, v: unknown) { filters.push(["in", c, v]); return chain; },
      is(c: string, v: unknown) { filters.push(["is", c, v]); return chain; },
      limit() { return Promise.resolve(run()); },
      maybeSingle() {
        const r = run();
        return Promise.resolve({ data: (r.data as Row[] | null)?.[0] ?? null, error: r.error });
      },
      then(resolve: (v: unknown) => unknown) { return Promise.resolve(run()).then(resolve); },
    };
    return chain;
  }
  const row = (id: string) => tables.order_installments.find((r) => r.id === id) as Row;
  const rpc = (name: string, args: Row = {}) => {
    if (name === "issue_4522_plan_v2_enabled") {
      return Promise.resolve(opts.planV2
        ? { data: true, error: null }
        : { data: null, error: { code: "42883", message: "function does not exist" } });
    }
    if (name === "issue_4522_missed_rollover") {
      const missed = row(String(args.p_installment_id));
      const later = tables.order_installments.find((r) =>
        r.order_id === missed.order_id && ["scheduled", "failed"].includes(String(r.status)) &&
        String(r.due_at) > String(missed.due_at)
      );
      if (missed.status !== "failed" || Number(missed.retry_count) < 3 || later === undefined) {
        return Promise.resolve({ data: { rolledOver: false, reason: "not_rollable" }, error: null });
      }
      later.amount_cents = Number(later.amount_cents) + Number(missed.amount_cents);
      later.schedule_version = Number(later.schedule_version) + 1;
      missed.status = "superseded";
      return Promise.resolve({ data: { rolledOver: true }, error: null });
    }
    if (name === "claim_order_installment_for_charge") {
      const r = row(String(args.p_installment_id));
      return Promise.resolve({ data: { ok: r.status === "scheduled" }, error: null });
    }
    if (name === "issue_4522_mark_stripe_charge_in_flight") {
      const r = row(String(args.p_installment_id));
      return Promise.resolve({
        data: r.amount_cents === args.p_amount_cents ? { ok: true, marked: true } : { ok: false, reason: "balance_changed" },
        error: null,
      });
    }
    if (name === "resolve_effective_take_rate_bps") {
      return Promise.resolve({ data: [{ effective_take_rate_bps: 150, take_rate_source: "default" }], error: null });
    }
    throw new Error(`unexpected rpc ${name}`);
  };
  const charges: number[] = [];
  const stripe = (decline: boolean, whileConfirming?: () => Promise<unknown>) => ({
    paymentIntents: {
      create(p: Row) { return Promise.resolve({ id: `pi_${charges.length}_${p.amount}`, status: "requires_confirmation" }); },
      async confirm(id: string) {
        if (whileConfirming !== undefined) await whileConfirming();
        if (decline) {
          return Promise.reject(Object.assign(new Error("Your card was declined."), {
            type: "StripeCardError", code: "card_declined", statusCode: 402,
          }));
        }
        charges.push(Number(id.split("_")[2]));
        return Promise.resolve({ id, status: "succeeded" });
      },
      cancel(id: string) { return Promise.resolve({ id, status: "canceled" }); },
    },
    refunds: { create() { return Promise.resolve({}); } },
  });
  const failedEvent = {
    id: "evt_failed", type: "payment_intent.payment_failed",
    data: { object: { id: "pi_decline", last_payment_error: { code: "card_declined", message: "declined" },
      metadata: { mingla_installment_id: "r2", mingla_brand_id: "b1" } } },
  };
  return { client: { rpc, from }, tables, row, atRiskWrites, charges, stripe, failedEvent };
}

const cronCharge = (
  w: ReturnType<typeof lifeWorld>,
  id: string,
  decline: boolean,
  whileConfirming?: () => Promise<unknown>,
) =>
  createInstallmentPI({
    installmentId: id, brandId: "b1",
    supabase: w.client as never, stripe: w.stripe(decline, whileConfirming) as never,
  });

Deno.test("E-1: cron rolls the last decline over, then the payment_failed webhook (twice) leaves at_risk false and the cron charges the rolled row", async () => {
  resetPlanV2SchemaProbeForTests();
  const w = lifeWorld({ planV2: true });
  const declined = await cronCharge(w, "r2", true);
  assertEquals(declined.outcome, "failed");
  assertEquals(w.row("r2").status, "superseded");
  assertEquals(w.row("r3").amount_cents, 120_000);
  // the real provider always sends payment_failed for the same decline, and may resend it
  // deno-lint-ignore no-explicit-any
  await handleInstallmentPaymentFailed(w.client as any, w.failedEvent as any);
  // deno-lint-ignore no-explicit-any
  await handleInstallmentPaymentFailed(w.client as any, w.failedEvent as any);
  assertEquals(w.atRiskWrites, []);
  assertEquals(w.tables.orders[0].at_risk, false);
  assertEquals(w.row("r2").status, "superseded");
  const late = w.tables.audit_log.filter((a) => a.action === "tr3.installment_failed_webhook");
  assertEquals(late.length, 2);
  // a late signal for a closed row writes nothing and sends no second dunning email
  for (const a of late) assertEquals((a.after as Row).late_for_status, "superseded");
  // the rolled-up row is still charged by the cron, for the rolled amount
  const collected = await cronCharge(w, "r3", false);
  assertEquals(collected.outcome, "collected");
  assertEquals(w.charges, [120_000]);
  resetPlanV2SchemaProbeForTests();
});

Deno.test("E-1 mirror: the webhook rolls over first, then the cron's own decline handling leaves at_risk false", async () => {
  resetPlanV2SchemaProbeForTests();
  const w = lifeWorld({ planV2: true });
  // the webhook for this decline lands while the cron is still waiting on its confirm
  const declined = await cronCharge(w, "r2", true, async () => {
    // deno-lint-ignore no-explicit-any
    await handleInstallmentPaymentFailed(w.client as any, w.failedEvent as any);
    assertEquals(w.row("r2").status, "superseded");
  });
  assertEquals(declined.outcome, "failed");
  assertEquals(w.atRiskWrites, []);
  assertEquals(w.tables.orders[0].at_risk, false);
  assertEquals((await cronCharge(w, "r3", false)).outcome, "collected");
  assertEquals(w.charges, [120_000]);
  resetPlanV2SchemaProbeForTests();
});

Deno.test("E-1: with no later row the last decline still flags at risk (SC-8)", async () => {
  resetPlanV2SchemaProbeForTests();
  const w = lifeWorld({ planV2: true, laterRow: false });
  assertEquals((await cronCharge(w, "r2", true)).outcome, "at_risk_flagged");
  assertEquals(w.tables.orders[0].at_risk, true);
  resetPlanV2SchemaProbeForTests();
});

Deno.test("E-1: a legacy (pre-#4522 schema) order keeps main's at-risk behaviour exactly", async () => {
  resetPlanV2SchemaProbeForTests();
  const w = lifeWorld({ planV2: false });
  assertEquals((await cronCharge(w, "r2", true)).outcome, "at_risk_flagged");
  assertEquals(w.tables.orders[0].at_risk, true);
  assertEquals(w.row("r2").status, "failed");
  w.tables.orders[0].at_risk = false;
  // the late webhook for that same decline flags it too, as on main
  // deno-lint-ignore no-explicit-any
  await handleInstallmentPaymentFailed(w.client as any, w.failedEvent as any);
  assertEquals(w.tables.orders[0].at_risk, true);
  resetPlanV2SchemaProbeForTests();
});

// ── issue #4522 (D-7): one buyer email per missed payment on a v2 order ──

/** Every ticket-confirmation-dispatch call the code makes, in order. */
async function withDispatchLog<T>(run: (sent: Row[]) => Promise<T>): Promise<T> {
  const sent: Row[] = [];
  const realFetch = globalThis.fetch;
  const prevUrl = Deno.env.get("SUPABASE_URL");
  const prevKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.set("SUPABASE_URL", "http://dispatch.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-test");
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/functions/v1/ticket-confirmation-dispatch")) {
      sent.push(JSON.parse(String(init?.body ?? "{}")));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }
    return realFetch(input, init);
  }) as typeof fetch;
  try {
    return await run(sent);
  } finally {
    globalThis.fetch = realFetch;
    if (prevUrl === undefined) Deno.env.delete("SUPABASE_URL"); else Deno.env.set("SUPABASE_URL", prevUrl);
    if (prevKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", prevKey);
  }
}

const dunningFor = (sent: Row[], id: string) =>
  sent.filter((b) => b.kind === "installment_dunning" && b.installmentId === id);

Deno.test("D-7: cron first, then payment_failed twice: one email for the rolled-over row, not at risk", async () => {
  resetPlanV2SchemaProbeForTests();
  const w = lifeWorld({ planV2: true, v2Terms: true });
  await withDispatchLog(async (sent) => {
    assertEquals((await cronCharge(w, "r2", true)).outcome, "failed");
    // deno-lint-ignore no-explicit-any
    await handleInstallmentPaymentFailed(w.client as any, w.failedEvent as any);
    // deno-lint-ignore no-explicit-any
    await handleInstallmentPaymentFailed(w.client as any, w.failedEvent as any);
    assertEquals(w.row("r2").status, "superseded");
    assertEquals(w.row("r3").amount_cents, 120_000);
    assertEquals(w.tables.orders[0].at_risk, false);
    assertEquals(dunningFor(sent, "r2").length, 1);
  });
  resetPlanV2SchemaProbeForTests();
});

// FAILS ON REVERT (this and the next): the cron and the webhook each sent a
// dunning email for the same decline — 2 emails, both rendered "at risk" for a
// rolled-over row (the dispatcher read retry_count 3 with no next retry).
Deno.test("D-7: webhook first while the cron waits on its confirm: one email, sent by the webhook", async () => {
  resetPlanV2SchemaProbeForTests();
  const w = lifeWorld({ planV2: true, v2Terms: true });
  await withDispatchLog(async (sent) => {
    const declined = await cronCharge(w, "r2", true, async () => {
      // deno-lint-ignore no-explicit-any
      await handleInstallmentPaymentFailed(w.client as any, w.failedEvent as any);
      assertEquals(w.row("r2").status, "superseded");
      assertEquals(dunningFor(sent, "r2").length, 1);
    });
    assertEquals(declined.outcome, "failed");
    // a duplicate delivery afterwards changes nothing
    // deno-lint-ignore no-explicit-any
    await handleInstallmentPaymentFailed(w.client as any, w.failedEvent as any);
    assertEquals(w.tables.orders[0].at_risk, false);
    assertEquals(w.row("r3").amount_cents, 120_000);
    assertEquals(dunningFor(sent, "r2").length, 1);
    const counted = w.tables.audit_log.filter((a) => (a.after as Row).already_counted === true);
    assertEquals(counted.length, 1);
  });
  resetPlanV2SchemaProbeForTests();
});

Deno.test("D-7: a v2 booking truly at risk (no later row) gets the at-risk email exactly once", async () => {
  resetPlanV2SchemaProbeForTests();
  const w = lifeWorld({ planV2: true, v2Terms: true, laterRow: false });
  await withDispatchLog(async (sent) => {
    assertEquals((await cronCharge(w, "r2", true)).outcome, "at_risk_flagged");
    // deno-lint-ignore no-explicit-any
    await handleInstallmentPaymentFailed(w.client as any, w.failedEvent as any);
    assertEquals(w.tables.orders[0].at_risk, true);
    assertEquals(w.row("r2").status, "failed");
    assertEquals(w.row("r2").retry_count, 3);
    assertEquals(dunningFor(sent, "r2").length, 1);
  });
  resetPlanV2SchemaProbeForTests();
});

Deno.test("D-7: an older-plan order keeps main's behaviour exactly (cron and webhook each email)", async () => {
  resetPlanV2SchemaProbeForTests();
  const w = lifeWorld({ planV2: true, laterRow: false });
  await withDispatchLog(async (sent) => {
    assertEquals((await cronCharge(w, "r2", true)).outcome, "at_risk_flagged");
    // deno-lint-ignore no-explicit-any
    await handleInstallmentPaymentFailed(w.client as any, w.failedEvent as any);
    assertEquals(w.tables.orders[0].at_risk, true);
    assertEquals(dunningFor(sent, "r2").length, 2);
  });
  resetPlanV2SchemaProbeForTests();
});

Deno.test("D-7: a rolled-over row's dunning is the 'moved to later payments' notice, never at risk", async () => {
  const source = await read("../../../ticket-confirmation-dispatch/index.ts");
  const start = source.indexOf("async function handleInstallmentDunning(");
  const superseded = source.indexOf('if (inst.status === "superseded") {', start);
  const render = source.indexOf("renderInstallmentDunningEmail({", start);
  assert(start > 0 && superseded > start && render > superseded,
    "a superseded row is routed before the dunning email is rendered");
  assertStringIncludes(source.slice(superseded, render),
    "return await handleMissedRolloverNotice(supabase, orderId, order, inst);");
  const { renderInstallmentMissedRolloverEmail } = await import("../../email/installmentMissedRolloverEmail.ts");
  const notice = renderInstallmentMissedRolloverEmail({
    buyerName: "Ada",
    tripTitle: "Lisbon",
    brandName: "Brand",
    ordinal: 2,
    amountCents: 60_000,
    currency: "USD",
    nextPayment: { amountCents: 120_000, dueAt: "2027-02-10T14:00:00Z" },
    timezone: "America/New_York",
    balanceUrl: null,
  });
  assertEquals(notice.subject, "Payment 2 for Lisbon moved to your later payments");
  assertStringIncludes(notice.text, "We couldn't collect $600.00 for payment 2 of Lisbon");
  assertStringIncludes(notice.text, "Your next payment is $1,200.00, due on");
  for (const part of [notice.subject, notice.html, notice.text]) {
    assertEquals(/at risk/i.test(part), false);
  }
});

// FAILS ON REVERT: the second provider sent its dunning email with a fresh pay
// link for a closed row and a "didn't go through" push — two notices, and the
// email rendered "at risk".
Deno.test("D-7 second provider: a rolled-over failure sends one email, no pay link, no push", async () => {
  const emails: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const pushes: unknown[] = [];
  const hosts: unknown[] = [];
  const fake = fakeSupabase({
    table: (op) => op.table === "order_installments" && op.kind === "select"
      ? {
        data: {
          id: "r2", order_id: "o1", ordinal: 2, currency: "NGN", buyer_total_cents: 30_600_000,
          amount_cents: 30_000_000, planned_application_fee_cents: 0, referral_share_minor: 0,
          orders: { id: "o1", event_id: "e1", buyer_user_id: "u1", buyer_name: "Ada Buyer",
            events: { id: "e1", title: "Lagos", brand_id: "b1",
              brands: { id: "b1", name: "Brand", paystack_subaccount_code: null, payout_hold_cutover_at: null } } },
        },
        error: null,
      }
      : { data: null, error: null },
    rpc: () => ({ data: null, error: { message: "no pay link for a closed row" } }),
  });
  const deps = {
    dispatchBuyerEmail: (kind: string, payload: Record<string, unknown>) => {
      emails.push({ kind, payload });
      return Promise.resolve(true);
    },
    sendBuyerPush: (p: unknown) => {
      pushes.push(p);
      return Promise.resolve(true);
    },
    notifyHost: (p: unknown) => {
      hosts.push(p);
      return Promise.resolve();
    },
  };
  await notifyPaystackInstallmentFailure(fake.client as never, "r2",
    { outcome: "failed", retry_count: 3, next_retry_at: null, rolled_over: true, failure_reason: "card_declined" },
    deps as never);
  assertEquals(emails.map((e) => e.kind), ["installment_dunning"]);
  assertEquals(emails[0].payload.installmentId, "r2");
  assertEquals(emails[0].payload.actionUrl, null);
  assertEquals(pushes.length, 0);
  assertEquals(fake.rpcCalls.length, 0);
  // Pass 5 — the host is told the rollover, never "We'll try again".
  // FAILS-ON-REVERT: the host alert said "We'll try again." after a rollover.
  const rolled = hosts[0] as { title: string; body: string };
  assertEquals(rolled.title, "Missed payment moved to later payments");
  assertEquals(rolled.body.includes("try again"), false);
  assertEquals(rolled.body.includes("moved to the traveler's later payments"), true);
  // a failure that did not roll over is unchanged: email + push
  await notifyPaystackInstallmentFailure(fake.client as never, "r2",
    { outcome: "failed", retry_count: 1, next_retry_at: "2027-01-16T08:00:00Z", failure_reason: "card_declined" },
    deps as never);
  assertEquals(emails.length, 2);
  assertEquals(pushes.length, 1);
  assertEquals((hosts[1] as { body: string }).body.includes("We'll try again on 2027-01-16"), true);
});
