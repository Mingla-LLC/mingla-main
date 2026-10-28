/**
 * Issue #3872 — the client-safe shape returned by ticket-checkout-create in
 * mode quote and inside a checkout_review_required refusal.
 *
 * This module is types only. Clients render server values and never recompute
 * a discounted checkout total.
 */

export type DiscountCodeReason =
  | "not_found"
  | "paused"
  | "not_started"
  | "ended"
  | "used_up"
  | "buyer_limit"
  | "queue"
  | "not_applicable"
  | "min_subtotal"
  | "incompatible_better_automatic";

export interface TicketQuoteDiscount {
  discountId: string;
  kind: "code" | "automatic" | "sale_price";
  name: string;
  code: string | null;
  amountMinor: number;
  units: number;
}

export interface TicketQuoteLine {
  ticketTypeId: string;
  ticketName: string;
  quantity: number;
  listUnitCents: number;
  netUnitCents: number;
  lineListCents: number;
  lineNetCents: number;
  discountCents: number;
  discounts: TicketQuoteDiscount[];
}

export interface TicketQuoteCodeOutcome {
  status: "none" | "applied" | "rejected";
  reason: DiscountCodeReason | null;
  required: number | null;
  with: string | null;
  replaced: string[];
}

export interface TicketQuoteNotice {
  type: "sale_limited";
  discountId: string;
  lineRef: string;
  remaining: number;
}

export interface InstallmentChargeSchedule {
  currency: string;
  payments: Array<{
    ordinal: number;
    dueAt: string;
    buyerTotalCents: number;
    feesCents: number;
    taxCents: number;
  }>;
}

export function decodeInstallmentChargeSchedule(
  value: unknown,
): InstallmentChargeSchedule | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.currency !== "string" ||
    !/^[A-Za-z]{3}$/.test(row.currency) ||
    !Array.isArray(row.payments) ||
    row.payments.length === 0
  ) return undefined;
  const payments: InstallmentChargeSchedule["payments"] = [];
  const ordinals = new Set<number>();
  for (const item of row.payments) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return undefined;
    }
    const payment = item as Record<string, unknown>;
    if (
      !Number.isInteger(payment.ordinal) || Number(payment.ordinal) < 1 ||
      ordinals.has(Number(payment.ordinal)) ||
      typeof payment.dueAt !== "string" ||
      !Number.isInteger(payment.buyerTotalCents) ||
      !Number.isInteger(payment.feesCents) ||
      !Number.isInteger(payment.taxCents) ||
      Number(payment.buyerTotalCents) < 0 ||
      Number(payment.feesCents) < 0 || Number(payment.taxCents) < 0 ||
      !Number.isFinite(Date.parse(payment.dueAt))
    ) return undefined;
    ordinals.add(Number(payment.ordinal));
    payments.push({
      ordinal: Number(payment.ordinal),
      dueAt: payment.dueAt,
      buyerTotalCents: Number(payment.buyerTotalCents),
      feesCents: Number(payment.feesCents),
      taxCents: Number(payment.taxCents),
    });
  }
  payments.sort((a, b) => a.ordinal - b.ordinal);
  return { currency: row.currency.toUpperCase(), payments };
}

/** Sum only the server-locked charge envelope; this is display math, not repricing. */
export function installmentPlanBuyerTotal(
  depositBuyerTotalCents: unknown,
  schedule: InstallmentChargeSchedule | undefined,
): number | undefined {
  if (
    schedule === undefined || !Number.isInteger(depositBuyerTotalCents) ||
    Number(depositBuyerTotalCents) < 0
  ) return undefined;
  return Number(depositBuyerTotalCents) + schedule.payments.reduce(
    (sum, payment) => sum + payment.buyerTotalCents,
    0,
  );
}

export interface TicketQuote {
  kind: "quote";
  currency: string;
  lines: TicketQuoteLine[];
  listSubtotalCents: number;
  discountCents: number;
  netSubtotalCents: number;
  dueTodayNetCents: number;
  dueTodayListCents: number;
  installmentSchedule: unknown;
  discounts: TicketQuoteDiscount[];
  codeOutcome: TicketQuoteCodeOutcome;
  notices: TicketQuoteNotice[];
  quoteDigest: string;
  quoteListDigest: string;
  feesCents: number;
  taxCents: number | null;
  buyerTotalCents: number;
  calculationId: string | null;
  subtotalCents: number;
  totalCents: number;
  installmentChargeSchedule?: InstallmentChargeSchedule;
  planTotalBuyerCents?: number;
}

export type CheckoutReviewDetail =
  | "discount_changed"
  | "price_changed"
  | "lines"
  | "fingerprint"
  | "discount_code_invalid";

export interface TicketCheckoutReview {
  kind: "review_required";
  detail: CheckoutReviewDetail;
  quote: TicketQuote | null;
  previousTotalCents: number | null;
}

export interface DiscountReasonCopyInput {
  reason: DiscountCodeReason;
  code: string;
  date?: string | null;
  required?: string | null;
  withName?: string | null;
}
