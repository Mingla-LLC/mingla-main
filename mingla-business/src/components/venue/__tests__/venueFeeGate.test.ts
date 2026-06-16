/**
 * META-ORCH-1148 sub-ORCH 2.0 — paid-fee readiness gate unit tests.
 *
 * Fails-on-revert anchor I-PROPOSED-1148-PAID-FEE-REQUIRES-CHARGES-ENABLED: a
 * PAID reservation fee may NOT be enabled unless the brand's payout rail is
 * ready (Stripe charges enabled OR a Paystack subaccount). Removing the gate
 * (returning true unconditionally) flips T-7 → FAIL.
 */

import {
  brandPayoutReadiness,
  canEnablePaidReservationFee,
} from "../venueFeeGate";

describe("canEnablePaidReservationFee", () => {
  it("T-7 — blocked when NO Stripe charges and NO Paystack subaccount", () => {
    expect(
      canEnablePaidReservationFee({
        stripeChargesEnabled: false,
        hasPaystackSubaccount: false,
      }),
    ).toBe(false);
  });

  it("allowed when Stripe charges are enabled", () => {
    expect(
      canEnablePaidReservationFee({
        stripeChargesEnabled: true,
        hasPaystackSubaccount: false,
      }),
    ).toBe(true);
  });

  it("allowed when a Paystack subaccount is connected (Nigeria rail)", () => {
    expect(
      canEnablePaidReservationFee({
        stripeChargesEnabled: false,
        hasPaystackSubaccount: true,
      }),
    ).toBe(true);
  });
});

describe("brandPayoutReadiness", () => {
  it("stripeStatus active → charges enabled", () => {
    const r = brandPayoutReadiness({ stripeStatus: "active" });
    expect(r.stripeChargesEnabled).toBe(true);
  });

  it("stripeStatus not active → charges NOT enabled", () => {
    for (const s of ["not_connected", "onboarding", "restricted", undefined]) {
      const r = brandPayoutReadiness({ stripeStatus: s });
      expect(r.stripeChargesEnabled).toBe(false);
    }
  });

  it("non-empty paystackSubaccountCode → has subaccount", () => {
    expect(
      brandPayoutReadiness({ paystackSubaccountCode: "ACCT_x" })
        .hasPaystackSubaccount,
    ).toBe(true);
    expect(
      brandPayoutReadiness({ paystackSubaccountCode: "" }).hasPaystackSubaccount,
    ).toBe(false);
    expect(
      brandPayoutReadiness({ paystackSubaccountCode: null }).hasPaystackSubaccount,
    ).toBe(false);
  });

  it("T-7 end-to-end — unready brand cannot enable a paid fee", () => {
    const brand = { stripeStatus: "onboarding", paystackSubaccountCode: null };
    expect(canEnablePaidReservationFee(brandPayoutReadiness(brand))).toBe(false);
  });
});
