/**
 * ORCH-1006 — pricing-preview parity tests.
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
  it("you-keep floor = base − mingla fee (tax floor 0)", () => {
    expect(r.youKeepFloorCents).toBe(10000 - 150);
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

describe("computePreview — VAT toggle does NOT move buyer (T-1, inclusive)", () => {
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
