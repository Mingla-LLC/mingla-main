// Issue #3645 — each later Paystack payment is priced by the deposit's engine.
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildPricingBreakdown,
  computeBuyerSubtotal,
  computeConfigVat,
  MINGLA_SERVICE_FEE_BPS,
  type PricingSwitches,
} from "../../allInPricingEngine.ts";
import {
  computePaystackInstallmentCharges,
  installmentChargePlanJson,
  installmentChargeScheduleEnvelope,
  PaystackInstallmentPricingError,
} from "../paystackInstallmentPricing.ts";

function depositEngine(base: number, switches: PricingSwitches, vatBps: number) {
  const input = {
    baseCents: base, switches, region: "NG" as const, currency: "NGN" as const,
    effectiveTakeRateBps: 150, takeRateSource: "platform_default" as const, serviceFeeBps: MINGLA_SERVICE_FEE_BPS,
  };
  const sub = computeBuyerSubtotal(input);
  const vat = computeConfigVat(sub.buyerSubtotalCents, vatBps, switches.pass_tax);
  const breakdown = buildPricingBreakdown({
    input, amountTotalCents: vat.buyerTotalCents, taxCents: vat.taxCents, taxBasis: "config_vat",
    stripeTaxCalculationId: null,
  });
  return { ...vat, fee: breakdown.application_fee_amount_cents, breakdown };
}

const SWITCHES: PricingSwitches[] = [];
for (const pass_tax of [true, false]) {
  for (const pass_mingla_fee of [true, false]) {
    for (const pass_service_fee of [true, false]) SWITCHES.push({ pass_tax, pass_mingla_fee, pass_service_fee });
  }
}

Deno.test("#3645 pricing: every later payment equals the deposit engine on its net (all switch combinations, VAT 750 bps)", () => {
  for (const switches of SWITCHES) {
    const charges = computePaystackInstallmentCharges({
      installments: [{ ordinal: 1, amountCents: 255_000_000 }, { ordinal: 2, amountCents: 85_000_001 }],
      switches, effectiveTakeRateBps: 150, takeRateSource: "platform_default", vatRateBps: 750,
    });
    for (const c of charges) {
      const expected = depositEngine(c.netCents, switches, 750);
      assertEquals(c.buyerTotalCents, expected.buyerTotalCents, JSON.stringify(switches));
      assertEquals(c.taxCents, expected.taxCents);
      assertEquals(c.applicationFeeCents, expected.fee);
      assertEquals(c.breakdown, expected.breakdown);
      assert(c.buyerTotalCents >= c.netCents || !switches.pass_mingla_fee);
    }
  }
});

Deno.test("#3645 pricing: zero VAT and per-payment rounding are independent per payment", () => {
  const sw = { pass_tax: true, pass_mingla_fee: true, pass_service_fee: true };
  const [a, b] = computePaystackInstallmentCharges({
    installments: [{ ordinal: 1, amountCents: 333_333 }, { ordinal: 2, amountCents: 333_334 }],
    switches: sw, effectiveTakeRateBps: 150, takeRateSource: "platform_default", vatRateBps: 0,
  });
  assertEquals(a.taxCents, 0);
  assertEquals(a.buyerTotalCents, depositEngine(333_333, sw, 0).buyerTotalCents);
  assertEquals(b.buyerTotalCents, depositEngine(333_334, sw, 0).buyerTotalCents);
});

Deno.test("#3645 pricing: any payment below NGN 50 all-in is refused", () => {
  const err = assertThrows(() =>
    computePaystackInstallmentCharges({
      installments: [{ ordinal: 1, amountCents: 1_000_000 }, { ordinal: 2, amountCents: 4_000 }],
      switches: { pass_tax: false, pass_mingla_fee: false, pass_service_fee: false },
      effectiveTakeRateBps: 150, takeRateSource: "platform_default", vatRateBps: 0,
    }), PaystackInstallmentPricingError);
  assertEquals((err as PaystackInstallmentPricingError).code, "installment_amount_below_minimum");
  // Exactly 5000 kobo passes.
  const [ok] = computePaystackInstallmentCharges({
    installments: [{ ordinal: 1, amountCents: 5_000 }],
    switches: { pass_tax: false, pass_mingla_fee: false, pass_service_fee: false },
    effectiveTakeRateBps: 150, takeRateSource: "platform_default", vatRateBps: 0,
  });
  assertEquals(ok.buyerTotalCents, 5_000);
});

Deno.test("#3645 pricing: plan JSON and buyer envelope shapes", () => {
  const charges = computePaystackInstallmentCharges({
    installments: [{ ordinal: 1, amountCents: 500_000 }],
    switches: { pass_tax: true, pass_mingla_fee: true, pass_service_fee: true },
    effectiveTakeRateBps: 150, takeRateSource: "platform_default", vatRateBps: 750,
  });
  const plan = installmentChargePlanJson(charges);
  assertEquals(plan.currency, "NGN");
  assertEquals(plan.engineVersion, 1);
  assertEquals(plan.payments[0].netCents, 500_000);
  const env = installmentChargeScheduleEnvelope(charges, new Map([[1, "2027-03-01T12:00:00.000Z"]]));
  const p = env.payments[0];
  assertEquals(p.dueAt, "2027-03-01T12:00:00.000Z");
  assertEquals(p.feesCents + p.taxCents + 500_000, p.buyerTotalCents);
});
