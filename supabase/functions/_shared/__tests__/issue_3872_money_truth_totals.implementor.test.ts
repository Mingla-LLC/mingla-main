// Issue #3872 PR 1 (money truth) — every ticket path stores, as
// buyer_total_cents, the same amount it sends to the payment provider, and
// every path persists a pricing breakdown (F2, F3).
//
// MINGLA-INVARIANT: I-3872-PROVIDER-AMOUNT-EQUALS-BUYER-TOTAL | issue #3872 | On every ticket path the amount sent to the payment provider and the stored buyer_total_cents come from the same pricing breakdown, and that breakdown is persisted.
//
// Fails before #3872: `_shared/orderMoneyTruth.ts` does not exist, the hosted
// and Paystack arms persisted no breakdown, and no webhook recorded what the
// provider charged.

import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildPricingBreakdown,
  computeBuyerSubtotal,
  computeConfigVat,
  type ComputeAllInInput,
  inclusiveVatDivisorForRegion,
} from "../allInPricingEngine.ts";
import {
  explicitTotalsFromBreakdown,
  freeCheckoutBreakdown,
  hostedCheckoutBreakdown,
  persistTicketSessionMoneyTruth,
  recordTicketProviderTotal,
} from "../orderMoneyTruth.ts";

const passBoth = { pass_tax: false, pass_mingla_fee: true, pass_service_fee: true };

function input(
  baseCents: number,
  region: ComputeAllInInput["region"],
  currency: string,
  switches = passBoth,
): ComputeAllInInput {
  return {
    baseCents,
    switches,
    region,
    currency,
    effectiveTakeRateBps: 150,
    takeRateSource: "platform_default",
  };
}

function assertIdentity(t: ReturnType<typeof explicitTotalsFromBreakdown>) {
  assertEquals(t.net_subtotal_cents, t.list_subtotal_cents - t.discount_cents);
  assertEquals(
    t.buyer_total_cents,
    t.net_subtotal_cents + t.buyer_fees_cents + t.tax_cents,
  );
}

Deno.test("hosted Stripe: the line item amount is the stored buyer total (production order 6d25e937 shape)", () => {
  // Base 3000 USD passing the 1.5% Mingla fee and the 3% service fee. Production
  // stored total_cents=3000 while Stripe charged 3135.
  const engine = input(3000, "US", "usd");
  const sub = computeBuyerSubtotal(engine);
  const lineItemUnitAmount = sub.buyerSubtotalCents; // what checkout.sessions.create bills
  const breakdown = hostedCheckoutBreakdown(engine, sub.buyerSubtotalCents);
  const totals = explicitTotalsFromBreakdown(breakdown);
  assertEquals(lineItemUnitAmount, 3135);
  assertEquals(totals.buyer_total_cents, lineItemUnitAmount);
  assertEquals(totals.net_subtotal_cents, 3000);
  assertEquals(totals.buyer_fees_cents, 135);
  assertEquals(totals.tax_cents, 0);
  assertEquals(breakdown.tax_basis, "provider_hosted_checkout");
  // #3645 flat 4.5%: application fee = take-rate (45) + service (90).
  assertEquals(breakdown.application_fee_amount_cents, 135);
  assertIdentity(totals);
});

Deno.test("native Stripe GB inclusive: PaymentIntent amount is the stored buyer total, VAT stays inside", () => {
  const engine = input(2000, "GB", "gbp");
  const sub = computeBuyerSubtotal(engine);
  const amountTotal = sub.buyerSubtotalCents; // Stripe Tax inclusive: total == lines
  const taxInside = amountTotal - Math.round(amountTotal / inclusiveVatDivisorForRegion("GB"));
  const pricingBreakdown = buildPricingBreakdown({
    input: engine,
    amountTotalCents: amountTotal,
    taxCents: taxInside,
    taxBasis: "venue_resolved",
    stripeTaxCalculationId: "taxcalc_test",
  });
  const piAmount = pricingBreakdown.buyer_total_cents; // what paymentIntents.create sends
  const totals = explicitTotalsFromBreakdown(pricingBreakdown);
  assertEquals(totals.buyer_total_cents, piAmount);
  assertEquals(totals.tax_cents, 0);
  assertEquals(pricingBreakdown.components.tax_cents, taxInside);
  assertIdentity(totals);
});

Deno.test("native Stripe US exclusive: tax added on top is the explicit tax_cents", () => {
  const engine = input(5000, "US", "usd");
  const sub = computeBuyerSubtotal(engine);
  const pricingBreakdown = buildPricingBreakdown({
    input: engine,
    amountTotalCents: sub.buyerSubtotalCents + 470,
    taxCents: 470,
    taxBasis: "venue_resolved",
    stripeTaxCalculationId: "taxcalc_us",
  });
  const totals = explicitTotalsFromBreakdown(pricingBreakdown);
  assertEquals(totals.buyer_total_cents, pricingBreakdown.buyer_total_cents);
  assertEquals(totals.tax_cents, 470);
  assertEquals(totals.buyer_fees_cents, sub.buyerSubtotalCents - 5000);
  assertIdentity(totals);
});

Deno.test("Paystack: the initialized amount (psBuyerTotalCents) is the stored buyer total, with and without passed VAT", () => {
  for (const passTax of [true, false]) {
    const switches = { ...passBoth, pass_tax: passTax };
    const engine = input(6_000_000, "NG", "NGN", switches);
    const sub = computeBuyerSubtotal(engine);
    const { taxCents, buyerTotalCents } = computeConfigVat(
      sub.buyerSubtotalCents,
      750,
      passTax,
    );
    const psBreakdown = buildPricingBreakdown({
      input: engine,
      amountTotalCents: buyerTotalCents,
      taxCents,
      taxBasis: "config_vat",
      stripeTaxCalculationId: null,
    });
    const totals = explicitTotalsFromBreakdown(psBreakdown);
    assertEquals(totals.buyer_total_cents, buyerTotalCents);
    assertEquals(totals.tax_cents, passTax ? taxCents : 0);
    assertEquals(totals.buyer_fees_cents, 270_000);
    assertIdentity(totals);
  }
});

Deno.test("installment deposit: the deposit charge is the stored buyer total", () => {
  // The session RPC sets the base to the deposit for installment plans.
  const engine = input(2500, "US", "usd");
  const sub = computeBuyerSubtotal(engine);
  const breakdown = hostedCheckoutBreakdown(engine, sub.buyerSubtotalCents);
  assertEquals(explicitTotalsFromBreakdown(breakdown).buyer_total_cents, sub.buyerSubtotalCents);
});

Deno.test("free: all totals are zero and a breakdown exists", () => {
  const breakdown = freeCheckoutBreakdown({
    region: "GB",
    currency: "gbp",
    switches: passBoth,
    effectiveTakeRateBps: 150,
    takeRateSource: "platform_default",
  });
  const totals = explicitTotalsFromBreakdown(breakdown);
  assertEquals(totals.buyer_total_cents, 0);
  assertEquals(totals.buyer_fees_cents, 0);
  assertEquals(breakdown.application_fee_amount_cents, 0);
  assertIdentity(totals);
});

Deno.test("a breakdown whose parts do not add up is refused, never persisted", () => {
  const engine = input(1000, "US", "usd");
  const broken = hostedCheckoutBreakdown(engine, 900); // charged below the subtotal
  assertThrows(() => explicitTotalsFromBreakdown(broken));
});

// deno-lint-ignore no-explicit-any
function fakeClient(opts: { updateError?: unknown; rpcError?: unknown; rpcData?: unknown } = {}) {
  const updates: Array<{ table: string; patch: Record<string, unknown>; filters: string[] }> = [];
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      const entry = { table, patch: {} as Record<string, unknown>, filters: [] as string[] };
      const chain = {
        update(patch: Record<string, unknown>) {
          entry.patch = patch;
          updates.push(entry);
          return chain;
        },
        eq(col: string, val: unknown) {
          entry.filters.push(`eq:${col}=${val}`);
          return chain;
        },
        is(col: string, val: unknown) {
          entry.filters.push(`is:${col}=${val}`);
          return Promise.resolve({ error: opts.updateError ?? null });
        },
      };
      return chain;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcs.push({ name, args });
      return Promise.resolve({ data: opts.rpcData ?? { outcome: "reconciled" }, error: opts.rpcError ?? null });
    },
  };
  return { client, updates, rpcs };
}

Deno.test("persistTicketSessionMoneyTruth writes the totals and breakdown to the unfinalized session", async () => {
  const engine = input(3000, "US", "usd");
  const breakdown = hostedCheckoutBreakdown(engine, computeBuyerSubtotal(engine).buyerSubtotalCents);
  const { client, updates } = fakeClient();
  const ok = await persistTicketSessionMoneyTruth(client, "sess_1", breakdown);
  assert(ok);
  assertEquals(updates.length, 1);
  assertEquals(updates[0].table, "ticket_checkout_sessions");
  assertEquals(updates[0].patch.buyer_total_cents, 3135);
  assertEquals(updates[0].patch.pricing_source, "computed_at_checkout");
  assert(updates[0].patch.pricing_breakdown !== null);
  assertEquals(updates[0].filters, ["eq:id=sess_1", "is:order_id=null"]);
});

Deno.test("persistTicketSessionMoneyTruth is non-fatal when the write fails", async () => {
  const engine = input(3000, "US", "usd");
  const breakdown = hostedCheckoutBreakdown(engine, computeBuyerSubtotal(engine).buyerSubtotalCents);
  const { client } = fakeClient({ updateError: { message: "column does not exist" } });
  assertEquals(await persistTicketSessionMoneyTruth(client, "sess_1", breakdown), false);
});

Deno.test("recordTicketProviderTotal sends the provider amount and tax; skips an unknown amount; never throws", async () => {
  const ok = fakeClient();
  await recordTicketProviderTotal(ok.client, {
    checkoutSessionId: "sess_2",
    provider: "stripe",
    providerTotalCents: 3400,
    providerTaxCents: 265,
  });
  assertEquals(ok.rpcs, [{
    name: "issue_3872_record_ticket_provider_total",
    args: {
      p_checkout_session_id: "sess_2",
      p_provider: "stripe",
      p_provider_total_cents: 3400,
      p_provider_tax_cents: 265,
    },
  }]);
  const skipped = fakeClient();
  assertEquals(
    await recordTicketProviderTotal(skipped.client, {
      checkoutSessionId: "sess_3",
      provider: "paystack",
      providerTotalCents: null,
    }),
    null,
  );
  assertEquals(skipped.rpcs.length, 0);
  const failing = fakeClient({ rpcError: { message: "function does not exist" } });
  assertEquals(
    await recordTicketProviderTotal(failing.client, {
      checkoutSessionId: "sess_4",
      provider: "stripe",
      providerTotalCents: 1000,
    }),
    null,
  );
});

// ---------------------------------------------------------------------------
// Source binding: each path persists the breakdown built from the variable it
// sends to the provider, BEFORE the provider call; each webhook records the
// provider amount BEFORE finalize.
// ---------------------------------------------------------------------------
const create = await Deno.readTextFile(
  new URL("../../ticket-checkout-create/index.ts", import.meta.url),
);
const stripeRouter = await Deno.readTextFile(
  new URL("../stripeWebhookRouter.ts", import.meta.url),
);
const paystackRouter = await Deno.readTextFile(
  new URL("../paystackWebhookRouter.ts", import.meta.url),
);

function indexOrFail(src: string, needle: string, from = 0): number {
  const i = src.indexOf(needle, from);
  assert(i >= 0, `missing: ${needle}`);
  return i;
}

Deno.test("source: hosted Stripe persists the breakdown of buyerSubtotalCents before checkout.sessions.create and bills that amount", () => {
  const built = indexOrFail(
    create,
    "hostedCheckoutBreakdown(\n        engineInput,\n        buyerSubtotal.buyerSubtotalCents,",
  );
  const persisted = indexOrFail(create, "hostedBreakdown,", built);
  const providerCall = indexOrFail(create, "stripeWeb.checkout.sessions.create(", persisted);
  const unitAmount = indexOrFail(create, "unit_amount: buyerSubtotal.buyerSubtotalCents", providerCall);
  assert(built < persisted && persisted < providerCall && providerCall < unitAmount);
});

Deno.test("source: native Stripe persists pricingBreakdown before the PaymentIntent for pricingBreakdown.buyer_total_cents", () => {
  const persisted = indexOrFail(
    create,
    "persistTicketSessionMoneyTruth(\n      supabase,\n      checkoutSessionId,\n      pricingBreakdown,",
  );
  const piAmount = indexOrFail(create, "amount: pricingBreakdown.buyer_total_cents,", persisted);
  assert(persisted < piAmount);
});

Deno.test("source: Paystack persists psBreakdown (built on psBuyerTotalCents) before initializing that amount", () => {
  const built = indexOrFail(create, "amountTotalCents: psBuyerTotalCents,");
  const persisted = indexOrFail(
    create,
    "persistTicketSessionMoneyTruth(\n        supabase,\n        checkoutSessionId,\n        psBreakdown,",
    built,
  );
  const init = indexOrFail(create, "amountSubunits: psBuyerTotalCents,", persisted);
  assert(built < persisted && persisted < init);
});

Deno.test("source: the free arm persists zero totals before finalize", () => {
  const persisted = indexOrFail(create, "freeCheckoutBreakdown({");
  const finalize = indexOrFail(create, "\"biz_ticket_checkout_finalize\"", persisted);
  assert(persisted < finalize);
});

Deno.test("source: both webhooks record the provider amount before finalize", () => {
  const stripeRecord = indexOrFail(stripeRouter, "await recordTicketProviderTotal(supabase, {");
  const stripeFinalize = indexOrFail(stripeRouter, "\"biz_ticket_checkout_finalize\"", stripeRecord);
  assert(stripeRecord < stripeFinalize);
  assert(stripeRouter.includes("providerTotalCents: providerChargedCents ??"));
  const psRecord = indexOrFail(paystackRouter, "await recordTicketProviderTotal(supabase, {");
  const psFinalize = indexOrFail(paystackRouter, "\"biz_ticket_checkout_finalize\"", psRecord);
  assert(psRecord < psFinalize);
  assert(paystackRouter.includes("providerTotalCents: verifiedAmount,"));
});
