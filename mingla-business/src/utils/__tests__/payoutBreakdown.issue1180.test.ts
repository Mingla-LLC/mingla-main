/**
 * #1180 [payout-ui-copy] — implementor happy-path regression suite.
 *
 * Angle: the PURE derivation layer (arithmetic + 12-state dictionary + currency
 * glyph). Runs under the default node/ts-jest config (the REQUIRED
 * mingla-business jest gate, #1062) — zero renderer needed because the DESIGN
 * (§9) keeps the arithmetic pure and golden-testable.
 *
 * The tester's adversarial leg lives elsewhere (render-mount + fee-variance +
 * RLS-role-gap + RN/web parity) per SPEC §8 — a DIFFERENT angle.
 *
 * fails-on-revert anchors (delete the fix line → a test here MUST fail):
 *  - currency.ts `NGN: "en-NG"` → the ₦-glyph assertions fail (render "NGN …").
 *  - payoutBreakdown.ts separate stamp-duty push → NG itemization fails.
 *  - payoutBreakdown.ts fee_unreconciled "Confirming…" branch → confirming fails.
 */

import { formatCurrency } from "../currency";
import {
  buildPayoutWaterfall,
  isRefundAdjustment,
  PAYOUT_RELEASE_STATUSES,
  PAYOUT_STATUS_PRESENTATION,
  payoutStatusA11yLabel,
  payoutStatusOneLiner,
  refundAdjustmentLabel,
  refundAdjustmentSign,
  releaseHeadlineCents,
  sumOutstandingDebtByCurrency,
  type BrandPayoutReleaseDTO,
  type OrganiserPayoutDebtDTO,
  type PayoutReleaseStatus,
  type PayoutTransferLegDTO,
} from "../payoutBreakdown";

const makeRelease = (
  over: Partial<BrandPayoutReleaseDTO> = {},
): BrandPayoutReleaseDTO => ({
  id: "rel_1",
  brandId: "brand_1",
  eventId: "evt_1",
  provider: "stripe",
  currency: "gbp",
  status: "released",
  anchorEndAt: "2026-07-12T20:00:00.000Z",
  releasableAt: "2026-07-15T20:00:00.000Z",
  releasedAt: "2026-07-16T20:00:00.000Z",
  grossCents: 0,
  refundedCents: 0,
  disputedCents: 0,
  minglaFeeCents: 0,
  partnerShareCents: 0,
  providerFeeCents: 0,
  permanentDebtWithheldCents: 0,
  temporaryDebtWithheldCents: 0,
  maturityRecreditCents: 0,
  netReleaseCents: 0,
  organiserCashDeliveredCents: 0,
  createdAt: "2026-07-12T20:00:00.000Z",
  ...over,
});

const makeLeg = (over: Partial<PayoutTransferLegDTO> = {}): PayoutTransferLegDTO => ({
  id: "leg_1",
  releaseId: "rel_1",
  kind: "organiser",
  principalCents: 0,
  estimatedFeeCents: 0,
  stampDutyCents: 0,
  actualFeeCents: null,
  actualStampDutyCents: null,
  feeVarianceCents: null,
  status: "succeeded",
  ...over,
});

const byKey = (
  lines: ReturnType<typeof buildPayoutWaterfall>["lines"],
): Record<string, (typeof lines)[number]> =>
  Object.fromEntries(lines.map((l) => [l.key, l]));

describe("#1180 gross→bank waterfall (Stripe, released)", () => {
  const release = makeRelease({
    currency: "gbp",
    status: "released",
    grossCents: 100000,
    refundedCents: 5000,
    disputedCents: 0,
    minglaFeeCents: 7000,
    partnerShareCents: 0,
    providerFeeCents: 2000,
    netReleaseCents: 86000,
    organiserCashDeliveredCents: 86000,
  });
  const { lines, final } = buildPayoutWaterfall(release, []);
  const map = byKey(lines);

  it("renders every non-zero line, omits zero lines except gross", () => {
    expect(lines.map((l) => l.key)).toEqual([
      "gross",
      "refunds",
      "mingla_fee",
      "provider_fee",
    ]);
    expect(map.gross.valueCents).toBe(100000);
    expect(map.gross.sign).toBeNull();
    expect(map.refunds).toMatchObject({ valueCents: 5000, sign: "−" });
    expect(map.mingla_fee).toMatchObject({ valueCents: 7000, sign: "−" });
    expect(map.provider_fee).toMatchObject({ valueCents: 2000, sign: "−" });
    expect(map.chargebacks).toBeUndefined();
    expect(map.partner_share).toBeUndefined();
  });

  it("final line is 'Cash to your bank' == organiser_cash_delivered_cents", () => {
    expect(final.label).toBe("Cash to your bank");
    expect(final.valueCents).toBe(86000);
    expect(final.confirming).toBe(false);
    expect(formatCurrency(final.valueCents, "gbp", true)).toBe("£860.00");
  });
});

describe("#1180 NG transfer-leg itemization (reconciled)", () => {
  const release = makeRelease({
    currency: "ngn",
    provider: "paystack",
    status: "released",
    grossCents: 5000000,
    minglaFeeCents: 250000,
    partnerShareCents: 1000000,
    providerFeeCents: 75000,
    netReleaseCents: 3665200,
    organiserCashDeliveredCents: 3665200,
  });
  const legs: PayoutTransferLegDTO[] = [
    makeLeg({ kind: "organiser", estimatedFeeCents: 5000, actualFeeCents: 4800, stampDutyCents: 5000, actualStampDutyCents: 5000 }),
    // Partner leg — MUST be ignored (partner principal never reduced by fees).
    makeLeg({ id: "leg_2", kind: "partner", estimatedFeeCents: 3000, actualFeeCents: 3000, stampDutyCents: 5000, actualStampDutyCents: 5000 }),
  ];
  const { lines } = buildPayoutWaterfall(release, legs);
  const map = byKey(lines);

  it("transfer fee + stamp duty are SEPARATE lines from ONLY organiser legs", () => {
    expect(map.transfer_fee).toMatchObject({ valueCents: 4800, sign: "−" });
    expect(map.stamp_duty).toMatchObject({ valueCents: 5000, sign: "−" });
    // reconciled (actual present) => NO estimated qualifier
    expect(map.transfer_fee.qualifier).toBeUndefined();
    expect(map.stamp_duty.qualifier).toBeUndefined();
  });

  it("has NO 'partner transfer fee' line; partner_share is the routed principal, not reduced by legs", () => {
    for (const line of lines) {
      expect(line.label.toLowerCase()).not.toContain("partner transfer");
    }
    expect(map.partner_share.valueCents).toBe(1000000);
  });

  it("provider (charge) fee and transfer fee are distinct, never merged", () => {
    expect(map.provider_fee.valueCents).toBe(75000);
    expect(map.transfer_fee.valueCents).toBe(4800);
  });

  it("NGN formats with the ₦ glyph (currency.ts en-NG mapping)", () => {
    expect(formatCurrency(4800, "ngn", true)).toBe("₦48.00");
    expect(formatCurrency(5000000, "ngn", true)).toContain("₦");
  });
});

describe("#1180 estimated vs confirming NG fees (never a fabricated number)", () => {
  it("actual null (not fee_unreconciled) → value = estimate + ' · estimated' qualifier", () => {
    const release = makeRelease({ currency: "ngn", status: "in_flight", grossCents: 100000, netReleaseCents: 90000 });
    const legs = [makeLeg({ kind: "organiser", estimatedFeeCents: 5000, actualFeeCents: null, stampDutyCents: 5000, actualStampDutyCents: null })];
    const map = byKey(buildPayoutWaterfall(release, legs).lines);
    expect(map.transfer_fee).toMatchObject({ valueCents: 5000, qualifier: "estimated" });
    expect(map.stamp_duty).toMatchObject({ valueCents: 5000, qualifier: "estimated" });
  });

  it("fee_unreconciled → 'Confirming…' (valueCents null) + final 'Net to be released · confirming'", () => {
    const release = makeRelease({ currency: "ngn", status: "fee_unreconciled", grossCents: 100000, netReleaseCents: 90000 });
    const legs = [makeLeg({ kind: "organiser", estimatedFeeCents: 5000, stampDutyCents: 5000 })];
    const { lines, final } = buildPayoutWaterfall(release, legs);
    const map = byKey(lines);
    expect(map.transfer_fee).toMatchObject({ valueCents: null, qualifier: "confirming" });
    expect(map.stamp_duty).toMatchObject({ valueCents: null, qualifier: "confirming" });
    expect(final.label).toBe("Net to be released");
    expect(final.confirming).toBe(true);
    expect(final.valueCents).toBe(90000);
  });
});

describe("#1180 debt withheld + maturity recredit lines", () => {
  const release = makeRelease({
    status: "released",
    grossCents: 100000,
    minglaFeeCents: 5000,
    permanentDebtWithheldCents: 8000,
    temporaryDebtWithheldCents: 2000,
    maturityRecreditCents: 3000,
    netReleaseCents: 88000,
    organiserCashDeliveredCents: 88000,
  });
  const map = byKey(buildPayoutWaterfall(release, []).lines);

  it("debt withheld sums permanent + temporary as a single − line", () => {
    expect(map.debt_withheld).toMatchObject({ valueCents: 10000, sign: "−" });
  });

  it("recredit is a + / success line", () => {
    expect(map.recredit).toMatchObject({ valueCents: 3000, sign: "+", tone: "success" });
  });
});

describe("#1180 12-state release-status dictionary", () => {
  const FORBIDDEN = ["error_message", "attempt_count", "otp", "kyc"];

  it("covers exactly 12 states, all livePulse:false, no internals leaked", () => {
    expect(PAYOUT_RELEASE_STATUSES).toHaveLength(12);
    for (const status of PAYOUT_RELEASE_STATUSES) {
      const p = PAYOUT_STATUS_PRESENTATION[status];
      expect(p.livePulse).toBe(false);
      expect(p.label.length).toBeGreaterThan(0);
      const oneLiner = payoutStatusOneLiner(status).toLowerCase();
      for (const bad of FORBIDDEN) expect(oneLiner).not.toContain(bad);
    }
  });

  it("maps the load-bearing states to their exact variant + label", () => {
    expect(PAYOUT_STATUS_PRESENTATION.released).toMatchObject({ variant: "live", label: "RELEASED" });
    expect(PAYOUT_STATUS_PRESENTATION.pending).toMatchObject({ variant: "info", label: "HELD" });
    expect(PAYOUT_STATUS_PRESENTATION.blocked_kyc).toMatchObject({ variant: "warn", label: "ACTION NEEDED" });
    expect(PAYOUT_STATUS_PRESENTATION.failed).toMatchObject({ variant: "error", label: "NEEDS ATTENTION" });
    expect(PAYOUT_STATUS_PRESENTATION.fee_unreconciled).toMatchObject({ variant: "info", label: "CONFIRMING FEES" });
    // CANCELLED = GREY/draft (Seth-approved K-ok), NOT red.
    expect(PAYOUT_STATUS_PRESENTATION.cancelled_event).toMatchObject({ variant: "draft", label: "CANCELLED" });
  });

  it("released one-liner threads the relative time; a11y label is sentence-case", () => {
    expect(payoutStatusOneLiner("released", { relativeTime: "2h ago" })).toBe("Sent to your bank 2h ago.");
    expect(payoutStatusA11yLabel("blocked_kyc")).toBe("Action needed");
    expect(payoutStatusOneLiner("cancelled_event")).toContain("buyers were refunded from held funds");
  });
});

describe("#1180 refund history + outstanding debt helpers", () => {
  it("classifies refund kinds and signs (dispute_reversal credits back)", () => {
    expect(isRefundAdjustment("post_release_refund")).toBe(true);
    expect(isRefundAdjustment("transfer_fee_debit")).toBe(false);
    expect(refundAdjustmentSign("post_release_refund")).toBe("−");
    expect(refundAdjustmentSign("dispute_reversal")).toBe("+");
    expect(refundAdjustmentLabel("post_release_dispute")).toBe("Chargeback");
  });

  it("sums open debt per currency (closed excluded, principal − recovered)", () => {
    const debts: OrganiserPayoutDebtDTO[] = [
      { id: "d1", brandId: "b", currency: "ngn", kind: "post_release_refund", principalCents: 10000, recoveredCents: 4000, status: "open", openedAt: "2026-07-01T00:00:00Z" },
      { id: "d2", brandId: "b", currency: "ngn", kind: "post_release_dispute", principalCents: 5000, recoveredCents: 0, status: "open", openedAt: "2026-07-02T00:00:00Z" },
      { id: "d3", brandId: "b", currency: "ngn", kind: "post_release_refund", principalCents: 9000, recoveredCents: 9000, status: "closed", openedAt: "2026-07-03T00:00:00Z" },
    ];
    expect(sumOutstandingDebtByCurrency(debts)).toEqual([{ currency: "ngn", cents: 11000 }]);
  });
});

describe("#1180 releaseHeadlineCents", () => {
  it("released → cash delivered; non-terminal → net", () => {
    expect(releaseHeadlineCents(makeRelease({ status: "released", organiserCashDeliveredCents: 500, netReleaseCents: 900 }))).toBe(500);
    expect(releaseHeadlineCents(makeRelease({ status: "pending", organiserCashDeliveredCents: 0, netReleaseCents: 900 }))).toBe(900);
  });
});

describe("#1180 currency glyph (non-GBP)", () => {
  it("USD → $, GBP → £", () => {
    const usd: PayoutReleaseStatus = "released";
    void usd;
    expect(formatCurrency(9900, "usd", true)).toBe("$99.00");
    expect(formatCurrency(9900, "gbp", true)).toBe("£99.00");
  });
});
