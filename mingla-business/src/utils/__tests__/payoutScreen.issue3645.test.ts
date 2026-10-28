import {
  PAYOUT_STATE_COPY,
  parseBrandPayoutScreen,
  payoutWaterfallMath,
  type PayoutScreenReleaseDTO,
} from "../payoutScreen";
import { computePreview } from "../pricingPreview";

const release = (
  patch: Partial<PayoutScreenReleaseDTO> = {},
): PayoutScreenReleaseDTO => ({
  id: "release-1",
  eventId: "event-1",
  offeringName: "Sat Night Jazz",
  provider: "paystack",
  currency: "ngn",
  ledgerStatus: "released",
  hostState: "paid",
  dueAt: "2026-10-21T04:00:00.000Z",
  releasedAt: "2026-10-22T04:00:00.000Z",
  grossCents: 6_270_000,
  refundedCents: 0,
  disputedCents: 0,
  minglaFeeCents: 90_000,
  partnerShareCents: 0,
  permanentDebtWithheldCents: 0,
  temporaryDebtWithheldCents: 0,
  maturityRecreditCents: 0,
  netReleaseCents: 6_180_000,
  cashToBankCents: 6_170_000,
  transferFeeCreditCents: 10_000,
  transferFeeCents: 5_000,
  stampDutyCents: 5_000,
  salesCount: 1,
  lastSaleAt: "2026-10-20T04:00:00.000Z",
  bankMask: "••••9999",
  olderPricing: true,
  items: [],
  ...patch,
});

describe("#3645 payout-screen money truth", () => {
  test.each([
    ["Nightlifefemzy", 6_270_000, 90_000, 6_180_000, 6_170_000, 10_000],
    ["Wise Productions", 5_225_000, 75_000, 5_150_000, 5_140_000, 10_000],
    ["Sailing Crusaders", 5_747_500, 82_500, 5_665_000, 5_655_000, 10_000],
    ["Ctrl", 2_664_750, 38_250, 2_626_500, 2_619_000, 7_500],
  ])("%s reconciles stored Paystack net and cash without processing", (
    _brand,
    grossCents,
    minglaFeeCents,
    netReleaseCents,
    cashToBankCents,
    bankCostCents,
  ) => {
    const row = release({
      grossCents,
      minglaFeeCents,
      netReleaseCents,
      cashToBankCents,
      transferFeeCents: bankCostCents,
      stampDutyCents: 0,
      transferFeeCreditCents: bankCostCents,
    });
    expect(payoutWaterfallMath(row)).toEqual({
      computedHostNetCents: netReleaseCents,
      computedCashToBankCents: cashToBankCents,
      hostNetReconciles: true,
      cashReconciles: true,
    });
  });

  test.each([
    ["Salsa4Life", 3_135, 45, 3_090, "late_on_us"],
    ["Lantern Room", 300, 5, 295, "waiting_for_bank"],
  ] as const)("%s reconciles Stripe host net and has the approved state", (
    _brand,
    grossCents,
    minglaFeeCents,
    netReleaseCents,
    hostState,
  ) => {
    const row = release({
      provider: "stripe",
      currency: "usd",
      ledgerStatus: hostState === "late_on_us" ? "blocked_balance" : "pending",
      hostState,
      grossCents,
      minglaFeeCents,
      netReleaseCents,
      cashToBankCents: 0,
      transferFeeCents: 0,
      stampDutyCents: 0,
    });
    expect(payoutWaterfallMath(row).hostNetReconciles).toBe(true);
    expect(PAYOUT_STATE_COPY[hostState].label).toBe(
      hostState === "late_on_us" ? "Late, on us" : "Waiting for your bank",
    );
  });

  test("parser ignores raw provider fees and drops unrecognised ledger states", () => {
    const parsed = parseBrandPayoutScreen({
      currency: "ngn",
      lifetime_sales_cents: { NGN: 6_270_000, USD: 400 },
      releases: [{
        id: "release-1",
        offering_name: "Jazz",
        provider: "paystack",
        currency: "ngn",
        ledger_status: "released",
        host_state: "paid",
        due_at: "2026-10-21T04:00:00.000Z",
        gross_cents: 6_270_000,
        mingla_fee_cents: 90_000,
        provider_fee_cents: 104_050,
        net_release_cents: 6_180_000,
        cash_to_bank_cents: 6_170_000,
      }, {
        id: "bad",
        offering_name: "Bad state",
        provider: "stripe",
        currency: "usd",
        ledger_status: "mystery",
        host_state: "paid",
        due_at: "2026-10-21T04:00:00.000Z",
      }],
    });
    expect(parsed?.releases).toHaveLength(1);
    expect(parsed?.lifetimeSalesCents).toEqual({ NGN: 6_270_000, USD: 400 });
    expect(parsed?.releases[0]).not.toHaveProperty("providerFeeCents");
    expect(parsed?.releases[0]?.netReleaseCents).toBe(6_180_000);
  });

  test.each([
    [undefined],
    [null],
    [[]],
    [{ ngn: 100 }],
    [{ NGN: -1 }],
    [{ NGN: 1.5 }],
    [{ NGN: Number.MAX_SAFE_INTEGER + 1 }],
    [{ NGN: "100" }],
  ])("parser fails closed for malformed lifetime_sales_cents %#", (value) => {
    expect(parseBrandPayoutScreen({
      currency: "ngn",
      lifetime_sales_cents: value,
      releases: [],
    })).toBeNull();
  });

  test("all actionable states have exactly one next-step kind", () => {
    expect(PAYOUT_STATE_COPY.waiting_for_bank.action).toBe("bank");
    expect(PAYOUT_STATE_COPY.needs_you.action).toBe("verify");
    expect(PAYOUT_STATE_COPY.couldnt_send.action).toBe("bank");
    expect(PAYOUT_STATE_COPY.paused.action).toBe("support");
    expect(PAYOUT_STATE_COPY.late_on_us.action).toBe("support");
  });

  test("₦20,000 pricing preview shows ₦20,000 when buyers cover 4.5% and ₦19,100 when the host covers it", () => {
    const buyersCover = computePreview({
      baseCents: 2_000_000,
      effectiveTakeRateBps: 150,
      serviceFeeBps: 300,
      switches: { passTax: false, passMinglaFee: true, passServiceFee: true },
    });
    const hostCovers = computePreview({
      baseCents: 2_000_000,
      effectiveTakeRateBps: 150,
      serviceFeeBps: 300,
      switches: { passTax: false, passMinglaFee: false, passServiceFee: false },
    });
    expect(buyersCover.youKeepCents).toBe(2_000_000);
    expect(hostCovers.youKeepCents).toBe(1_910_000);
  });
});
