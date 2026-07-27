/**
 * payoutBreakdown — PURE derivation layer for the #1180 held-payout receipt.
 *
 * This module contains NO React, NO React Native runtime imports, and NO I/O.
 * It owns:
 *   - the DTO shapes the ledger read-path produces (camelCase mirror of the
 *     B/C/E/F/G/H ledger tables),
 *   - the 12-state release-status presentation dictionary (variant + label +
 *     icon + one-liner) — the ONLY organiser-facing status strings; DB
 *     internals (error_message / attempt_count / OTP / KYC) never surface,
 *   - the gross → bank waterfall derivation (DESIGN §4.4 display law).
 *
 * It is deterministic and golden-testable without a renderer, which is exactly
 * why the DESIGN (§9) keeps the component "dumb" and the arithmetic here.
 *
 * `import type` (Pill/Icon) is erased at compile time — this file pulls in zero
 * RN runtime code, so it runs under the default node/ts-jest suite.
 */

import type { PillVariant } from "../components/ui/Pill";
import type { IconName } from "../components/ui/Icon";

// ---------------------------------------------------------------------------
// DTOs — camelCase mirror of the merged ledger schema (migration 0001 + H).
// ---------------------------------------------------------------------------

/** `brand_payout_releases.status` — the 12 states (migration 0001 CHECK). */
export type PayoutReleaseStatus =
  | "pending"
  | "released"
  | "in_flight"
  | "blocked_kyc"
  | "blocked_balance"
  | "blocked_otp"
  | "blocked_over_cap"
  | "fee_unreconciled"
  | "blocked_anchor"
  | "cancelled_event"
  | "reanchored"
  | "failed";

export const PAYOUT_RELEASE_STATUSES: readonly PayoutReleaseStatus[] = [
  "pending",
  "released",
  "in_flight",
  "blocked_kyc",
  "blocked_balance",
  "blocked_otp",
  "blocked_over_cap",
  "fee_unreconciled",
  "blocked_anchor",
  "cancelled_event",
  "reanchored",
  "failed",
];

export interface BrandPayoutReleaseDTO {
  id: string;
  brandId: string;
  eventId: string | null;
  provider: "stripe" | "paystack";
  /** lowercase ISO-3 (e.g. "gbp", "ngn"). */
  currency: string;
  status: PayoutReleaseStatus;
  anchorEndAt: string;
  releasableAt: string;
  releasedAt: string | null;
  grossCents: number;
  refundedCents: number;
  disputedCents: number;
  minglaFeeCents: number;
  partnerShareCents: number;
  providerFeeCents: number;
  permanentDebtWithheldCents: number;
  temporaryDebtWithheldCents: number;
  maturityRecreditCents: number;
  netReleaseCents: number;
  organiserCashDeliveredCents: number;
  createdAt: string;
}

export interface PayoutTransferLegDTO {
  id: string;
  releaseId: string;
  kind: "organiser" | "partner";
  principalCents: number;
  estimatedFeeCents: number;
  stampDutyCents: number;
  actualFeeCents: number | null;
  actualStampDutyCents: number | null;
  feeVarianceCents: number | null;
  status: string;
}

export type PayoutAdjustmentKind =
  | "post_release_refund"
  | "post_release_dispute"
  | "dispute_reversal"
  | "transfer_fee_debit"
  | "transfer_fee_credit"
  | "maturity_recredit"
  | "debt_writeoff";

export interface PayoutLedgerAdjustmentDTO {
  id: string;
  releaseId: string | null;
  brandId: string;
  currency: string;
  kind: PayoutAdjustmentKind;
  amountCents: number;
  createdAt: string;
}

export interface OrganiserPayoutDebtDTO {
  id: string;
  brandId: string;
  currency: string;
  kind: string;
  principalCents: number;
  recoveredCents: number;
  status: string;
  openedAt: string;
}

export interface BrandPayoutLedger {
  releases: BrandPayoutReleaseDTO[];
  legsByRelease: Record<string, PayoutTransferLegDTO[]>;
  adjustments: PayoutLedgerAdjustmentDTO[];
  openDebts: OrganiserPayoutDebtDTO[];
}

// ---------------------------------------------------------------------------
// 12-state release-status presentation dictionary (DESIGN §4.2).
// Color answers "do I need to act?"; the label + one-liner answer "what is
// happening" — so WCAG "colour is never the only indicator" holds.
// ---------------------------------------------------------------------------

export interface PayoutStatusPresentation {
  variant: PillVariant;
  label: string;
  icon: IconName;
  /** These are settled/persisted states, never a live-ticking signal. */
  livePulse: false;
}

export const PAYOUT_STATUS_PRESENTATION: Record<
  PayoutReleaseStatus,
  PayoutStatusPresentation
> = {
  released: { variant: "live", label: "RELEASED", icon: "check", livePulse: false },
  pending: { variant: "info", label: "HELD", icon: "clock", livePulse: false },
  in_flight: { variant: "info", label: "SENDING", icon: "send", livePulse: false },
  blocked_balance: { variant: "info", label: "PROCESSING", icon: "clock", livePulse: false },
  blocked_otp: { variant: "info", label: "PROCESSING", icon: "clock", livePulse: false },
  blocked_anchor: { variant: "info", label: "PROCESSING", icon: "clock", livePulse: false },
  blocked_over_cap: { variant: "info", label: "SPLITTING", icon: "swap", livePulse: false },
  fee_unreconciled: { variant: "info", label: "CONFIRMING FEES", icon: "clock", livePulse: false },
  reanchored: { variant: "info", label: "RESCHEDULED", icon: "calendar", livePulse: false },
  blocked_kyc: { variant: "warn", label: "ACTION NEEDED", icon: "flag", livePulse: false },
  failed: { variant: "error", label: "NEEDS ATTENTION", icon: "flag", livePulse: false },
  // CANCELLED = GREY/draft (Seth-approved K-ok): terminal, buyers refunded, NOT
  // an organiser error to fix — red would wrongly alarm.
  cancelled_event: { variant: "draft", label: "CANCELLED", icon: "close", livePulse: false },
};

/**
 * The ONLY organiser-facing one-liner per status (DESIGN §4.2 / SPEC §4.3).
 * Never derived from error_message / attempt_count / OTP / KYC internals.
 */
export const payoutStatusOneLiner = (
  status: PayoutReleaseStatus,
  opts: { relativeTime?: string } = {},
): string => {
  switch (status) {
    case "released":
      return `Sent to your bank ${opts.relativeTime ?? "recently"}.`;
    case "pending":
      return "Held until 3 days after your event, then released.";
    case "in_flight":
      return "On its way to your bank.";
    case "blocked_balance":
      return "Waiting for funds to settle — releases automatically.";
    case "blocked_otp":
      return "We're completing a security step on this payout.";
    case "blocked_anchor":
      return "Finalising your event date for this payout.";
    case "blocked_over_cap":
      return "This payout is being sent in parts.";
    case "fee_unreconciled":
      return "We're confirming the exact transfer fee.";
    case "reanchored":
      return "Your event date moved — the release date updated.";
    case "blocked_kyc":
      return "Finish account verification to receive this payout.";
    case "failed":
      return "This payout couldn't be sent. Contact support.";
    case "cancelled_event":
      return "This event was cancelled — buyers were refunded from held funds.";
    default: {
      const _exhaust: never = status;
      return _exhaust;
    }
  }
};

/** Human, sentence-case status for a11y labels ("Action needed", "Held"). */
export const payoutStatusA11yLabel = (status: PayoutReleaseStatus): string => {
  const label = PAYOUT_STATUS_PRESENTATION[status].label;
  return label.charAt(0) + label.slice(1).toLowerCase();
};

// ---------------------------------------------------------------------------
// Gross → bank waterfall (DESIGN §4.4 display law — binding).
// ---------------------------------------------------------------------------

export type WaterfallSign = "−" | "+" | null;
export type WaterfallTone = "primary" | "secondary" | "success";
export type WaterfallQualifier = "estimated" | "confirming";

export interface WaterfallLine {
  key: string;
  label: string;
  /** null ⇒ render the qualifier word ("Confirming…"), never a fabricated number. */
  valueCents: number | null;
  sign: WaterfallSign;
  tone: WaterfallTone;
  qualifier?: WaterfallQualifier;
}

export interface PayoutWaterfall {
  lines: WaterfallLine[];
  final: { label: string; valueCents: number; confirming: boolean };
}

/**
 * Derive the top→bottom deduction waterfall for one release. Omits any zero
 * line except Gross and the final line (DESIGN §4.4).
 *
 * Binding rules encoded here:
 *  - `providerFeeCents` (charge processing) and the NG transfer-leg fee are
 *    DISTINCT lines — never merged/double-counted.
 *  - Bank transfer fee and stamp duty are TWO separate lines.
 *  - NO "partner transfer fee" line — the partner principal is never reduced
 *    by transfer fees (v1.2 model B); only the brand's cash absorbs fees.
 *  - Un-reconciled fee (actual null) → " · estimated". A `fee_unreconciled`
 *    release → "Confirming…" (value null), and the final line reads
 *    "Net to be released · confirming fees" — never a fabricated number.
 */
export const buildPayoutWaterfall = (
  release: BrandPayoutReleaseDTO,
  legs: readonly PayoutTransferLegDTO[] = [],
): PayoutWaterfall => {
  const lines: WaterfallLine[] = [];

  // Gross — always rendered.
  lines.push({
    key: "gross",
    label: "Gross sales",
    valueCents: release.grossCents,
    sign: null,
    tone: "primary",
  });

  const pushDeduction = (key: string, label: string, cents: number): void => {
    if (cents > 0) {
      lines.push({ key, label, valueCents: cents, sign: "−", tone: "secondary" });
    }
  };

  pushDeduction("refunds", "Refunds", release.refundedCents);
  pushDeduction("chargebacks", "Chargebacks / disputes", release.disputedCents);
  pushDeduction("mingla_fee", "Mingla fee", release.minglaFeeCents);
  pushDeduction("partner_share", "Partner share", release.partnerShareCents);
  pushDeduction("provider_fee", "Payment processing fee", release.providerFeeCents);

  // NG transfer legs — ORGANISER legs only (partner principal is never a fee).
  const organiserLegs = legs.filter((leg) => leg.kind === "organiser");
  const confirming = release.status === "fee_unreconciled";
  if (organiserLegs.length > 0) {
    if (confirming) {
      // No fabricated number — the exact fee is still being confirmed.
      lines.push({
        key: "transfer_fee",
        label: "Bank transfer fee",
        valueCents: null,
        sign: "−",
        tone: "secondary",
        qualifier: "confirming",
      });
      lines.push({
        key: "stamp_duty",
        label: "Stamp duty",
        valueCents: null,
        sign: "−",
        tone: "secondary",
        qualifier: "confirming",
      });
    } else {
      const feeUsingEstimate = organiserLegs.some((leg) => leg.actualFeeCents == null);
      const dutyUsingEstimate = organiserLegs.some(
        (leg) => leg.actualStampDutyCents == null,
      );
      const transferFeeCents = organiserLegs.reduce(
        (sum, leg) => sum + (leg.actualFeeCents ?? leg.estimatedFeeCents),
        0,
      );
      const stampDutyCents = organiserLegs.reduce(
        (sum, leg) => sum + (leg.actualStampDutyCents ?? leg.stampDutyCents),
        0,
      );
      if (transferFeeCents > 0) {
        const line: WaterfallLine = {
          key: "transfer_fee",
          label: "Bank transfer fee",
          valueCents: transferFeeCents,
          sign: "−",
          tone: "secondary",
        };
        if (feeUsingEstimate) line.qualifier = "estimated";
        lines.push(line);
      }
      if (stampDutyCents > 0) {
        const line: WaterfallLine = {
          key: "stamp_duty",
          label: "Stamp duty",
          valueCents: stampDutyCents,
          sign: "−",
          tone: "secondary",
        };
        if (dutyUsingEstimate) line.qualifier = "estimated";
        lines.push(line);
      }
    }
  }

  const debtWithheldCents =
    release.permanentDebtWithheldCents + release.temporaryDebtWithheldCents;
  pushDeduction("debt_withheld", "Debt withheld", debtWithheldCents);

  if (release.maturityRecreditCents > 0) {
    lines.push({
      key: "recredit",
      label: "Recredit (postponed event)",
      valueCents: release.maturityRecreditCents,
      sign: "+",
      tone: "success",
    });
  }

  const isReleased = release.status === "released";
  const final = {
    label: isReleased ? "Cash to your bank" : "Net to be released",
    valueCents: isReleased
      ? release.organiserCashDeliveredCents
      : release.netReleaseCents,
    confirming,
  };

  return { lines, final };
};

/** Value shown in the collapsed row header (DESIGN §2.2). */
export const releaseHeadlineCents = (release: BrandPayoutReleaseDTO): number =>
  release.status === "released"
    ? release.organiserCashDeliveredCents
    : release.netReleaseCents;

// ---------------------------------------------------------------------------
// Refund history + outstanding-debt helpers.
// ---------------------------------------------------------------------------

/** Adjustment kinds that render in the refund-history list (SPEC §4.6 / SC-6). */
export const REFUND_ADJUSTMENT_KINDS: readonly PayoutAdjustmentKind[] = [
  "post_release_refund",
  "post_release_dispute",
  "dispute_reversal",
];

export const isRefundAdjustment = (kind: PayoutAdjustmentKind): boolean =>
  REFUND_ADJUSTMENT_KINDS.includes(kind);

export const refundAdjustmentLabel = (kind: PayoutAdjustmentKind): string => {
  switch (kind) {
    case "post_release_refund":
      return "Refund";
    case "post_release_dispute":
      return "Chargeback";
    case "dispute_reversal":
      return "Chargeback reversed";
    default:
      return "Adjustment";
  }
};

/** `dispute_reversal` credits money back (+); refunds/disputes debit (−). */
export const refundAdjustmentSign = (kind: PayoutAdjustmentKind): "−" | "+" =>
  kind === "dispute_reversal" ? "+" : "−";

export const outstandingDebtCents = (debt: OrganiserPayoutDebtDTO): number =>
  Math.max(0, debt.principalCents - debt.recoveredCents);

/**
 * Total still-owed debt per currency (open debts only). Returns one entry per
 * currency so the banner can render each (debts can span rails/currencies).
 */
export const sumOutstandingDebtByCurrency = (
  debts: readonly OrganiserPayoutDebtDTO[],
): Array<{ currency: string; cents: number }> => {
  const byCurrency = new Map<string, number>();
  for (const debt of debts) {
    if (debt.status !== "open") continue;
    const owed = outstandingDebtCents(debt);
    if (owed <= 0) continue;
    byCurrency.set(debt.currency, (byCurrency.get(debt.currency) ?? 0) + owed);
  }
  return [...byCurrency.entries()].map(([currency, cents]) => ({ currency, cents }));
};
