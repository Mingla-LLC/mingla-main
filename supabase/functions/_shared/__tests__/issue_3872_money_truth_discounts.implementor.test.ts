import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildPricingBreakdown,
  type ComputeAllInInput,
} from "../allInPricingEngine.ts";
import {
  explicitTotalsFromBreakdown,
  sessionMoneyTruthPatch,
  withDiscounts,
} from "../orderMoneyTruth.ts";

const input: ComputeAllInInput = {
  baseCents: 4_500,
  switches: {
    pass_tax: false,
    pass_mingla_fee: true,
    pass_service_fee: true,
  },
  region: "GB",
  currency: "GBP",
  effectiveTakeRateBps: 150,
  takeRateSource: "platform_default",
};

const breakdown = buildPricingBreakdown({
  input,
  amountTotalCents: 4_703,
  taxCents: 0,
  taxBasis: "unresolved_flat_absorb",
  stripeTaxCalculationId: null,
});

Deno.test("#3872 money truth writes list, discount and the order identity", () => {
  const totals = explicitTotalsFromBreakdown(
    breakdown,
    "computed_at_checkout",
    5_000,
  );
  assertEquals(totals.list_subtotal_cents, 5_000);
  assertEquals(totals.discount_cents, 500);
  assertEquals(totals.net_subtotal_cents, 4_500);
  assertEquals(
    totals.net_subtotal_cents,
    totals.list_subtotal_cents - totals.discount_cents,
  );
  assertEquals(
    totals.buyer_total_cents,
    totals.net_subtotal_cents + totals.buyer_fees_cents + totals.tax_cents,
  );
  assertEquals(
    sessionMoneyTruthPatch(
      breakdown,
      "computed_at_checkout",
      5_000,
    ).discount_cents,
    500,
  );
});

Deno.test("#3872 money truth rejects a list amount below net", () => {
  assertThrows(
    () =>
      explicitTotalsFromBreakdown(
        breakdown,
        "computed_at_checkout",
        4_499,
      ),
    Error,
    "order_money_truth_invalid_discount",
  );
});

Deno.test("#3872 withDiscounts adds the immutable JSON snapshot", () => {
  const enriched = withDiscounts(breakdown, {
    listSubtotalCents: 5_000,
    discounts: [{
      id: "3872a000-0000-4000-8400-000000000001",
      kind: "code",
      name: "Welcome",
      code: "WELCOME10",
      amountCents: 500,
    }],
  });
  assertEquals(enriched.list_subtotal_cents, 5_000);
  assertEquals(enriched.discount_cents, 500);
  assertEquals(enriched.discounts, [{
    id: "3872a000-0000-4000-8400-000000000001",
    kind: "code",
    name: "Welcome",
    code: "WELCOME10",
    amount_cents: 500,
  }]);
});
