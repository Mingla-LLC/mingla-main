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

export interface DiscountReasonCopyInput {
  reason: DiscountCodeReason;
  code: string;
  date?: string | null;
  required?: string | null;
  withName?: string | null;
}
