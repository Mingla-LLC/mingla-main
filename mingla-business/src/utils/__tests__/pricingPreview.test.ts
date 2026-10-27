/**
 * ORCH-1006 — pricing-preview parity tests.
 * [TEST-MOD-APPROVED #3645] The approved flat host take is now 4.5%.
 *
 * Pins the client preview mirror to the engine's worked example and the
 * integer-bps contract. If these drift from `_shared/allInPricingEngine.ts`,
 * the authoring "Buyer pays" chip would lie — fail loud.
 */

import { computePreview, feeFromBps } from "../pricingPreview";
import {
  DEFAULT_TAKE_RATE_BPS,
  MINGLA_SERVICE_FEE_BPS,
} from "../../constants/pricing";

describe("feeFromBps", () => {
  it("is integer round(base × bps / 10000) and matches the engine", () => {
    expect(feeFromBps(10000, 150)).toBe(150); // £100 @ 1.50% = £1.50
    expect(feeFromBps(10000, 300)).toBe(300); // £100 @ 3.00% = £3.00
    expect(feeFromBps(2999, 300)).toBe(90); // round(89.97) = 90
  });
  it("guards non-positive / non-finite base", () => {
    expect(feeFromBps(0, 300)).toBe(0);
    expect(feeFromBps(-100, 300)).toBe(0);
    expect(feeFromBps(Number.NaN, 300)).toBe(0);
  });
});

describe("computePreview — all absorbed (default brand posture)", () => {
  const r = computePreview({
    baseCents: 10000,
    switches: { passTax: false, passMinglaFee: false, passServiceFee: false },
    effectiveTakeRateBps: DEFAULT_TAKE_RATE_BPS,
  });
  it("buyer pays the bare base (nothing added on top)", () => {
    expect(r.buyerPaysCents).toBe(10000);
  });
  it("the brand eats both fees (absorbed split)", () => {
    expect(r.absorbed.miglaFeeCents).toBe(150);
    expect(r.absorbed.serviceFeeCents).toBe(300);
    expect(r.passed.miglaFeeCents).toBe(0);
    expect(r.passed.serviceFeeCents).toBe(0);
  });
  it("you keep = buyer total minus Mingla's application fee", () => {
    expect(r.youKeepCents).toBe(10000 - 150 - 300);
  });
});

describe("computePreview — fees passed to buyer", () => {
  const r = computePreview({
    baseCents: 10000,
    switches: { passTax: false, passMinglaFee: true, passServiceFee: true },
    effectiveTakeRateBps: DEFAULT_TAKE_RATE_BPS,
  });
  it("buyer pays base + mingla + service", () => {
    expect(r.buyerPaysCents).toBe(10000 + 150 + 300);
  });
  it("service fee constant matches the engine launch default", () => {
    expect(MINGLA_SERVICE_FEE_BPS).toBe(300);
    expect(r.passed.serviceFeeCents).toBe(300);
  });
});

describe("computePreview — Stripe-tax markets preserve inclusive preview behavior", () => {
  const base = {
    baseCents: 5000,
    effectiveTakeRateBps: DEFAULT_TAKE_RATE_BPS,
  };
  it("buyer pays identical whether VAT is passed or absorbed", () => {
    const absorbed = computePreview({
      ...base,
      switches: { passTax: false, passMinglaFee: false, passServiceFee: false },
    });
    const passed = computePreview({
      ...base,
      switches: { passTax: true, passMinglaFee: false, passServiceFee: false },
    });
    expect(passed.buyerPaysCents).toBe(absorbed.buyerPaysCents);
  });
});

describe("computePreview — Nigeria configured VAT", () => {
  const base = {
    baseCents: 190_000_000,
    effectiveTakeRateBps: DEFAULT_TAKE_RATE_BPS,
    serviceFeeBps: MINGLA_SERVICE_FEE_BPS,
    vatRateBps: 750,
  };

  it("shows the exact no-VAT buyer total and connected payout", () => {
    const result = computePreview({
      ...base,
      switches: {
        passTax: false,
        passMinglaFee: false,
        passServiceFee: false,
      },
    });

    expect(result.taxCents).toBe(14_250_000);
    expect(result.buyerPaysCents).toBe(190_000_000);
    expect(result.youKeepCents).toBe(181_450_000);
    expect(result.absorbed.taxCents).toBe(14_250_000);
  });

  it("adds 7.5% on top and keeps passed VAT in the connected payout", () => {
    const result = computePreview({
      ...base,
      switches: {
        passTax: true,
        passMinglaFee: false,
        passServiceFee: false,
      },
    });

    expect(result.buyerPaysCents).toBe(204_250_000);
    expect(result.youKeepCents).toBe(195_700_000);
    expect(result.passed.taxCents).toBe(14_250_000);
  });

  it("calculates VAT on the fee-grossed buyer subtotal like the engine", () => {
    const result = computePreview({
      ...base,
      switches: {
        passTax: true,
        passMinglaFee: true,
        passServiceFee: true,
      },
    });

    expect(result.taxCents).toBe(14_891_250);
    expect(result.buyerPaysCents).toBe(213_441_250);
    expect(result.youKeepCents).toBe(204_891_250);
  });
});
