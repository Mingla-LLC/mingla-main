import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildPricingBreakdown,
  type ComputeAllInInput,
  computeBuyerSubtotal,
  computeConfigVat,
} from "../../_shared/allInPricingEngine.ts";
import {
  explicitTotalsFromBreakdown,
  hostedCheckoutBreakdown,
  sessionMoneyTruthPatch,
  withDiscounts,
} from "../../_shared/orderMoneyTruth.ts";
import { computeVenueOrderMoney } from "../../_shared/venueOrderPricing.ts";

const switches = {
  pass_tax: false,
  pass_mingla_fee: true,
  pass_service_fee: true,
};
const discount = [{
  id: "3872c000-0000-4000-8400-000000000001",
  kind: "code",
  name: "Ten percent",
  code: "TEN",
  amountCents: 500,
}];

function input(
  baseCents: number,
  region: ComputeAllInInput["region"],
  currency: string,
): ComputeAllInInput {
  return {
    baseCents,
    switches,
    region,
    currency,
    effectiveTakeRateBps: 150,
    takeRateSource: "platform_default",
    serviceFeeBps: 300,
  };
}

function assertRail(
  name: string,
  providerAmount: number,
  breakdown: ReturnType<typeof withDiscounts>,
  expectedNet: number,
): void {
  const persisted = sessionMoneyTruthPatch(
    breakdown,
    "computed_at_checkout",
    breakdown.list_subtotal_cents,
  );
  assertEquals(
    providerAmount,
    breakdown.buyer_total_cents,
    `${name}: provider`,
  );
  assertEquals(
    providerAmount,
    persisted.buyer_total_cents,
    `${name}: persisted`,
  );
  assertEquals(persisted.net_subtotal_cents, expectedNet, `${name}: net`);
  assertEquals(
    persisted.list_subtotal_cents - persisted.discount_cents,
    persisted.net_subtotal_cents,
    `${name}: list identity`,
  );
}

Deno.test("#3872 cross-rail discount money remains one identity", () => {
  const net = 4_500;
  const list = 5_000;
  const stripeInput = input(net, "US", "USD");
  const stripeSubtotal = computeBuyerSubtotal(stripeInput);
  const hosted = withDiscounts(
    hostedCheckoutBreakdown(stripeInput, stripeSubtotal.buyerSubtotalCents),
    { listSubtotalCents: list, discounts: discount },
  );
  assertRail("hosted", stripeSubtotal.buyerSubtotalCents, hosted, net);

  const native = withDiscounts(
    buildPricingBreakdown({
      input: stripeInput,
      amountTotalCents: stripeSubtotal.buyerSubtotalCents,
      taxCents: 0,
      taxBasis: "unresolved_flat_absorb",
      stripeTaxCalculationId: null,
    }),
    { listSubtotalCents: list, discounts: discount },
  );
  assertRail("native", native.buyer_total_cents, native, net);

  const paystackInput = input(net, "NG", "NGN");
  const paystackSubtotal = computeBuyerSubtotal(paystackInput);
  const vat = computeConfigVat(paystackSubtotal.buyerSubtotalCents, 750, true);
  const paystack = withDiscounts(
    buildPricingBreakdown({
      input: paystackInput,
      amountTotalCents: vat.buyerTotalCents,
      taxCents: vat.taxCents,
      taxBasis: "config_vat",
      stripeTaxCalculationId: null,
    }),
    { listSubtotalCents: list, discounts: discount },
  );
  assertRail("paystack", vat.buyerTotalCents, paystack, net);

  for (const name of ["v1 plan", "v2 plan"]) {
    const dueNet = 1_125;
    const dueList = 1_250;
    const planInput = input(dueNet, "US", "USD");
    const planSubtotal = computeBuyerSubtotal(planInput);
    const plan = withDiscounts(
      hostedCheckoutBreakdown(planInput, planSubtotal.buyerSubtotalCents),
      {
        listSubtotalCents: dueList,
        discounts: [{ ...discount[0], amountCents: 125 }],
      },
    );
    assertRail(name, planSubtotal.buyerSubtotalCents, plan, dueNet);
  }

  const venueMoney = computeVenueOrderMoney({
    subtotalCents: net,
    serviceChargeBps: 0,
    tipBps: null,
    tipFlatCents: null,
    switches,
    region: "US",
    currency: "USD",
    effectiveTakeRateBps: 150,
    takeRateSource: "platform_default",
    serviceFeeBps: 300,
  });
  const venue = withDiscounts(venueMoney.pricingBreakdown, {
    listSubtotalCents: list,
    discounts: discount,
  });
  assertRail("venue", venueMoney.totalCents, venue, net);

  const deposit = withDiscounts(native, {
    listSubtotalCents: list,
    discounts: discount,
  });
  assertRail("deposit", deposit.buyer_total_cents, deposit, net);

  const freeInput = input(0, "US", "USD");
  const free = withDiscounts(
    buildPricingBreakdown({
      input: freeInput,
      amountTotalCents: 0,
      taxCents: 0,
      taxBasis: "unresolved_flat_absorb",
      stripeTaxCalculationId: null,
    }),
    {
      listSubtotalCents: list,
      discounts: [{ ...discount[0], amountCents: list }],
    },
  );
  assertRail("free", 0, free, 0);
  assertEquals(
    explicitTotalsFromBreakdown(free, "computed_at_checkout", list)
      .discount_cents,
    list,
  );
});
