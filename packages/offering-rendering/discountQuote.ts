/**
 * Issue #3872 — the client-safe shape returned by ticket-checkout-create in
 * `mode:"quote"` and inside a checkout_review_required refusal.
 *
 * This module owns no pricing logic. Clients may format these server values,
 * but must never recompute a discounted checkout total.
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

export const ticketQuoteFeesAndTaxCents = (quote: TicketQuote): number =>
  Math.max(0, quote.buyerTotalCents - quote.dueTodayNetCents);

export const checkoutReviewReasonCopy = (
  detail: CheckoutReviewDetail,
): string =>
  detail === "discount_changed"
    ? "Your total changed because a discount ended or ran out."
    : "Something in your order changed. Please review it.";

export interface DiscountReasonCopyInput {
  reason: DiscountCodeReason;
  code: string;
  date?: string | null;
  required?: string | null;
  withName?: string | null;
}

/** Binding copy from #3872 spec v4 §10.6. */
export const discountReasonCopy = ({
  reason,
  code,
  date = null,
  required = null,
  withName = null,
}: DiscountReasonCopyInput): string => {
  switch (reason) {
    case "not_found":
      return "That code doesn't exist.";
    case "paused":
      return `${code} isn't available right now.`;
    case "not_started":
      return `${code} starts ${date ?? "later"}.`;
    case "ended":
      return `${code} has ended.`;
    case "used_up":
      return `${code} has been fully used.`;
    case "buyer_limit":
      return `You've already used ${code}.`;
    case "queue":
      return "Codes can't be used while you're in the queue.";
    case "not_applicable":
      return `${code} isn't valid for these items.`;
    case "min_subtotal":
      return `Add ${required ?? "more"} more to use ${code}.`;
    case "incompatible_better_automatic":
      return `${code} can't be combined with ${withName ?? "this offer"} — you already have the better price.`;
  }
};

export const saleLimitedCopy = (name: string, remaining: number): string =>
  remaining <= 0
    ? `The ${name} price has sold out.`
    : `Only ${remaining} left at the ${name} price.`;

/** Listing-card scarcity copy for an active sale; quantity wins over time. */
export const saleAvailabilityCopy = (
  remaining: number | null | undefined,
  endsAt: string | null | undefined,
  timezone?: string | null,
): string | null => {
  if (typeof remaining === "number" && remaining >= 0 && remaining <= 10) {
    return `Only ${remaining} left at this price`;
  }
  if (typeof endsAt !== "string" || endsAt.length === 0) return null;
  const end = new Date(endsAt);
  if (!Number.isFinite(end.getTime())) return null;
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(timezone ? { timeZone: timezone } : {}),
  };
  try {
    return `Sale ends ${new Intl.DateTimeFormat(undefined, options).format(end)}`;
  } catch {
    delete options.timeZone;
    return `Sale ends ${new Intl.DateTimeFormat(undefined, options).format(end)}`;
  }
};

