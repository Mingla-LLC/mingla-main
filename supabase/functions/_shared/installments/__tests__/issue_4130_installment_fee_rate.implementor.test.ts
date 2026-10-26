// #4130 Wave 2b — instalments charge the brand's effective Mingla fee.
//
// Before: createInstallmentPI and the installment webhook fallback used a
// hard-coded 4.5%, so a brand on a custom rate paid the default on every
// instalment. Now both read resolve_effective_take_rate_bps (the brand's
// override, else the platform default) plus the 3% service fee.
//
// Fails on revert: put `Math.round(installment.amount_cents * 0.045)` back in
// createInstallmentPI, or `Math.round(amountCents * 0.045)` in the webhook
// fallback, and the override cases below fail (400 / 350 expected, 450 seen).

import {
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  installmentFeeCents,
  resolveInstallmentFeeRate,
} from "../installmentFeeRate.ts";
import { createInstallmentPI } from "../createInstallmentPI.ts";
import { handleInstallmentPaymentSucceeded } from "../../installmentWebhookHandlers.ts";

type RpcCall = { name: string; args: Record<string, unknown> };

/** The rate the database would answer for a brand. */
function rateAnswer(bps: number | null, source = "brand_override") {
  return bps === null
    ? { data: null, error: { message: "boom" } }
    : { data: [{ effective_take_rate_bps: bps, take_rate_source: source }], error: null };
}

Deno.test("#4130 resolver: a brand override sets the instalment fee (take + 3% service)", async () => {
  const calls: RpcCall[] = [];
  const db = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve(rateAnswer(100));
    },
  };
  const rate = await resolveInstallmentFeeRate(db as never, "brand_override");
  assertEquals(calls, [{ name: "resolve_effective_take_rate_bps", args: { p_brand_id: "brand_override" } }]);
  assertEquals(rate, { totalBps: 400, takeRateBps: 100, source: "brand_override" });
  assertEquals(installmentFeeCents(10_000, rate), 400);
});

Deno.test("#4130 resolver: the platform default still gives 4.5%", async () => {
  const db = { rpc: () => Promise.resolve(rateAnswer(150, "platform_default")) };
  const rate = await resolveInstallmentFeeRate(db as never, "brand_default");
  assertEquals(rate.source, "platform_default");
  assertEquals(installmentFeeCents(10_000, rate), 450);
});

Deno.test("#4130 resolver: an unreadable rate charges the standard rate, never blocks", async () => {
  for (
    const db of [
      { rpc: () => Promise.resolve(rateAnswer(null)) },
      { rpc: () => Promise.resolve({ data: [], error: null }) },
      { rpc: () => Promise.resolve({ data: [{ effective_take_rate_bps: -5 }], error: null }) },
      { rpc: () => { throw new Error("network"); } },
    ]
  ) {
    const rate = await resolveInstallmentFeeRate(db as never, "brand_x");
    assertEquals(rate.source, "fallback");
    assertEquals(installmentFeeCents(10_000, rate), 450);
  }
  const noBrand = await resolveInstallmentFeeRate({ rpc: () => { throw new Error("unused"); } } as never, null);
  assertEquals(noBrand.totalBps, 450);
});

// ── createInstallmentPI charges the override ──────────────────────────────

class ChargeFakeDb {
  rpcCalls: RpcCall[] = [];
  inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  constructor(private takeBps: number) {}
  rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    if (name === "claim_order_installment_for_charge") {
      return Promise.resolve({ data: { ok: true }, error: null });
    }
    if (name === "resolve_effective_take_rate_bps") {
      return Promise.resolve(rateAnswer(this.takeBps));
    }
    throw new Error(`unexpected rpc ${name}`);
  }
  from(table: string) {
    // deno-lint-ignore no-this-alias
    const db = this;
    const chain = {
      update() { return chain; },
      eq() { return chain; },
      insert(payload: Record<string, unknown>) {
        db.inserts.push({ table, payload });
        return Promise.resolve({ error: null });
      },
      then(resolve: (v: { data: null; error: null }) => void) {
        resolve({ data: null, error: null });
      },
    };
    return chain;
  }
}

function fakeStripe() {
  const creates: Array<Record<string, unknown>> = [];
  return {
    creates,
    paymentIntents: {
      create(params: Record<string, unknown>) {
        creates.push(params);
        return Promise.resolve({ id: "pi_4130", status: "requires_confirmation" });
      },
      confirm() {
        return Promise.resolve({ id: "pi_4130", status: "succeeded" });
      },
      cancel() {
        return Promise.resolve({});
      },
    },
    refunds: { create: () => Promise.resolve({}) },
  };
}

async function chargeOne(takeBps: number, amountCents: number) {
  const db = new ChargeFakeDb(takeBps);
  const stripe = fakeStripe();
  const result = await createInstallmentPI({
    installmentId: "inst_4130",
    brandId: "brand_4130",
    supabase: db as never,
    stripe: stripe as never,
    installment: {
      id: "inst_4130",
      order_id: "order_4130",
      ordinal: 2,
      amount_cents: amountCents,
      currency: "USD",
      due_at: new Date().toISOString(),
      status: "scheduled",
      retry_count: 0,
      stripe_payment_intent_id: null,
    },
    order: {
      id: "order_4130",
      event_id: "event_4130",
      stripe_customer_id_on_connected_account: "cus_4130",
      saved_payment_method_id: "pm_4130",
      buyer_user_id: null,
      buyer_email: "buyer@example.test",
      at_risk: false,
    },
    brand: { id: "brand_4130", contact_email: null, name: "Brand" },
    stripeAccount: { brand_id: "brand_4130", stripe_account_id: "acct_4130" },
  });
  return { result, db, stripe };
}

Deno.test("#4130 createInstallmentPI: a brand on a 1% take is charged 4% on the instalment", async () => {
  const { result, db, stripe } = await chargeOne(100, 10_000);
  assertEquals(result.ok, true);
  assertEquals(stripe.creates.length, 1);
  assertEquals(stripe.creates[0].application_fee_amount, 400);
  assertEquals(
    db.rpcCalls.find((c) => c.name === "resolve_effective_take_rate_bps")?.args,
    { p_brand_id: "brand_4130" },
  );
});

Deno.test("#4130 createInstallmentPI: the default brand is still charged 4.5%", async () => {
  const { stripe } = await chargeOne(150, 10_000);
  assertEquals(stripe.creates[0].application_fee_amount, 450);
});

Deno.test("#4130 createInstallmentPI: a 0% take still collects the 3% service fee", async () => {
  const { stripe } = await chargeOne(0, 10_000);
  assertEquals(stripe.creates[0].application_fee_amount, 300);
});

// ── the webhook fallback records the override ──────────────────────────────

class WebhookFakeDb {
  rpcCalls: RpcCall[] = [];
  row: Record<string, unknown> | null = null;
  constructor(private takeBps: number) {}
  rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    if (name === "resolve_effective_take_rate_bps") {
      return Promise.resolve(rateAnswer(this.takeBps));
    }
    if (name === "record_order_installment_provider_sale") {
      return Promise.resolve({ data: { ok: true }, error: null });
    }
    throw new Error(`unexpected rpc ${name}`);
  }
  from(_table: string) {
    // deno-lint-ignore no-this-alias
    const db = this;
    const chain = {
      update() { return chain; },
      select() { return chain; },
      eq() { return chain; },
      in() { return chain; },
      insert() { return Promise.resolve({ error: null }); },
      maybeSingle() {
        db.row = {
          id: "inst_4130",
          order_id: "order_4130",
          ordinal: 2,
          amount_cents: 10_000,
        };
        return Promise.resolve({ data: db.row, error: null });
      },
      then(resolve: (v: { count: number; error: null }) => void) {
        resolve({ count: 1, error: null });
      },
    };
    return chain;
  }
}

function succeeded(extra: Record<string, unknown> = {}) {
  return {
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_4130",
        latest_charge: "ch_4130",
        metadata: { mingla_installment_id: "inst_4130", mingla_brand_id: "brand_4130" },
        ...extra,
      },
    },
  };
}

Deno.test("#4130 webhook: with no fee on the PaymentIntent, the brand override is recorded", async () => {
  const db = new WebhookFakeDb(50);
  await handleInstallmentPaymentSucceeded(db as never, succeeded());
  const sale = db.rpcCalls.find((c) => c.name === "record_order_installment_provider_sale");
  assertEquals(sale?.args.p_application_fee_amount_cents, 350);
  assertEquals(
    db.rpcCalls.find((c) => c.name === "resolve_effective_take_rate_bps")?.args,
    { p_brand_id: "brand_4130" },
  );
});

Deno.test("#4130 webhook: the fee Stripe actually took wins over any rate", async () => {
  const db = new WebhookFakeDb(50);
  await handleInstallmentPaymentSucceeded(db as never, succeeded({ application_fee_amount: 777 }));
  const sale = db.rpcCalls.find((c) => c.name === "record_order_installment_provider_sale");
  assertEquals(sale?.args.p_application_fee_amount_cents, 777);
  assertEquals(db.rpcCalls.some((c) => c.name === "resolve_effective_take_rate_bps"), false);
});
