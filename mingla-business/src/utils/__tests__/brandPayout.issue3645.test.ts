import {
  isBrandChargeReady,
  isBrandPayoutReady,
  payoutGateStatus,
} from "../brandPayout";

describe("brandPayout #3645 charge vs payout", () => {
  test("Stripe active is charge and payout ready when flags absent", () => {
    const brand = {
      stripeStatus: "active" as const,
      paymentProvider: "stripe" as const,
    };
    expect(isBrandChargeReady(brand)).toBe(true);
    expect(isBrandPayoutReady(brand)).toBe(true);
    expect(payoutGateStatus(brand)).toBe("active");
  });

  test("Stripe charges-enabled without payouts can sell but money waits", () => {
    const brand = {
      stripeStatus: "active" as const,
      paymentProvider: "stripe" as const,
      chargesEnabled: true,
      payoutsEnabled: false,
    };
    expect(isBrandChargeReady(brand)).toBe(true);
    expect(isBrandPayoutReady(brand)).toBe(false);
    expect(payoutGateStatus(brand)).toBe("active");
  });

  test("Paystack hold cutover without subaccount can sell but not payout", () => {
    const brand = {
      paymentProvider: "paystack" as const,
      paystackSubaccountCode: null,
      payoutHoldCutoverAt: "2026-09-01T00:00:00Z",
      hasPaystackRecipient: false,
    };
    expect(isBrandChargeReady(brand)).toBe(true);
    expect(isBrandPayoutReady(brand)).toBe(false);
    expect(payoutGateStatus(brand)).toBe("active");
  });

  test("Paystack recipient unlocks payout readiness", () => {
    const brand = {
      paymentProvider: "paystack" as const,
      paystackSubaccountCode: null,
      payoutHoldCutoverAt: "2026-09-01T00:00:00Z",
      hasPaystackRecipient: true,
    };
    expect(isBrandPayoutReady(brand)).toBe(true);
  });

  test("unstamped Paystack without subaccount cannot sell", () => {
    const brand = {
      paymentProvider: "paystack" as const,
      paystackSubaccountCode: null,
      payoutHoldCutoverAt: null,
    };
    expect(isBrandChargeReady(brand)).toBe(false);
    expect(payoutGateStatus(brand)).toBe("not_connected");
  });
});
