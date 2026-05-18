// ORCH-0788 — Buyer lifecycle email adapters.
//
// Translates `ticket_order_notifications.payload` shapes (written by
// refund-order, cancel-order, cancel-trip-booking, and the Stripe webhook
// refund handler) into the existing `GenericBodyInput` shape consumed by
// `_shared/email/genericBody.ts`. Lets the dispatcher route by
// `payload.template_key` without extending the EmailVariant union.
//
// Per SPEC §5: no PDF attachment, no calendar links, no SMS — refund and
// cancel notifications are email-only, generic-shape, branded shell.
// Sender override to EMAIL_SENDERS.tickets (vs the variant's default
// system) keeps the buyer in the same email thread as the original
// purchase confirmation.
//
// Per SPEC §5.1: NO double-escape. `_shared/email/genericBody.ts` already
// runs `escapeHtml` on title + every paragraph internally (lines 21, 38).
// Adapters here pass plain trimmed strings — escaping happens inside the
// renderer. Double-escaping would render literal `&amp;` to buyers.
//
// I-PROPOSED-BA NOTIFICATION_TEMPLATE_KEY_DISPATCHED: every value enqueued
// by a writer MUST be addressed here or the dispatcher's default branch
// flips the row to `failed_terminal` with `unknown_template_key:<value>`.
//
// ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] extension:
// Both payload shapes carry optional Tr4 fields (cancelledBy, tierPct,
// installmentBreakdown, refundAmountCents, refundIssued). When cancelledBy
// is present, the body branches between buyer-self-cancel and operator-
// cancel copy per DESIGN_ORCH-0875 §5.3 templates D-1/D-2/D-3/D-4.
// When cancelledBy is absent, existing ORCH-0787/ORCH-0788 callers get
// the original generic copy unchanged (backward-compatible).

import { formatMoneyFromCents } from "./currency.ts";
import type { GenericBodyInput } from "./types.ts";

export interface InstallmentBreakdownRow {
  ordinal: number;       // 0 = deposit; 1+ = installment number
  paid_cents: number;
  refund_cents: number;
  currency: string;
}

export interface RefundIssuedPayloadShape {
  template_key: "buyer_refund_issued";
  amount_cents: number;
  currency: string;
  refund_lines?: Array<{
    order_line_item_id: string;
    quantity: number;
    amount_cents: number;
  }>;
  reason?: string;
  is_full_refund?: boolean;
  stripe_refund_id?: string;
  source?: string;
  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] extensions (all optional —
  // backward-compatible with ORCH-0787 [refund-order] callers):
  cancelledBy?: "buyer" | "operator";
  tierPct?: number;            // 0-100
  refundAmountCents?: number;  // alias for amount_cents in Tr4 cancel flow
  installmentBreakdown?: InstallmentBreakdownRow[];
  refundIssued?: boolean;      // false when 0% tier applied
  stripe_refund_ids?: string[]; // Tr4 multi-PI refund — array of all refund IDs
}

export interface OrderCancelledPayloadShape {
  template_key: "buyer_order_cancelled";
  reason?: string;
  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] extensions (all optional):
  cancelledBy?: "buyer" | "operator";
  tierPct?: number;
  refundAmountCents?: number;
  currency?: string;
  installmentBreakdown?: InstallmentBreakdownRow[];
  refundIssued?: boolean;
}

export interface BuyerContext {
  buyerName: string | null;
  eventTitle: string;
  brandName: string;
  orderShortId: string;
  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] extensions (optional):
  organizerEmail?: string | null;  // brand contact email for "Contact organizer at..." link
  cardLast4?: string | null;       // card ending in •••• xxxx (Tr4 design §5.3)
}

function trimmedReason(reason: string | undefined): string | null {
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function greeting(buyerName: string | null): string {
  if (!buyerName || buyerName.trim().length === 0) return "Hi,";
  return `Hi ${buyerName.trim()},`;
}

// ORCH-0875 helper: builds the "card ending in •••• 4242" phrase or a
// fallback when last4 is unknown.
function cardEndingPhrase(cardLast4: string | null | undefined): string {
  if (typeof cardLast4 === "string" && cardLast4.length === 4) {
    return `to your card ending in •••• ${cardLast4}`;
  }
  return `to your original payment method`;
}

// ORCH-0875 helper: builds the optional installment breakdown paragraph block.
// Returns lines to append to the paragraphs array; returns empty array when
// no breakdown present.
function installmentBreakdownLines(
  breakdown: InstallmentBreakdownRow[] | undefined,
): string[] {
  if (!breakdown || breakdown.length === 0) return [];
  // Filter to rows with actual refund (>0); skip rows that paid 0 (won't-be-charged
  // future installments are handled separately in the cancel message). Sort by
  // ordinal asc so deposit (0) appears first.
  const refundedRows = breakdown
    .filter((r) => r.refund_cents > 0)
    .sort((a, b) => a.ordinal - b.ordinal);
  if (refundedRows.length === 0) return [];
  const lines: string[] = ["Refund breakdown:"];
  for (const row of refundedRows) {
    const label = row.ordinal === 0 ? "Deposit refund" : `Installment ${row.ordinal} refund`;
    const amount = formatMoneyFromCents(row.refund_cents, row.currency);
    lines.push(`  ${label}: ${amount}`);
  }
  return lines;
}

// ORCH-0875 helper: builds the "won't be charged" line for future scheduled
// installments that are being cancelled. Driven by breakdown rows with
// paid_cents > 0 = collected; the cancel-trip-booking RPC payload does NOT
// include scheduled rows in installmentBreakdown (they live in installments_to_cancel
// which we pass as a count). For v1 we keep this simple — if Tr4 cancel email
// wants to surface the count, the caller passes a separate field. Skip for now.

export function refundIssuedToGenericBody(
  payload: RefundIssuedPayloadShape,
  context: BuyerContext,
): GenericBodyInput {
  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] branch: when cancelledBy
  // is present, render templates D-3 (buyer) or D-4 (operator) per DESIGN
  // §5.3. Otherwise render the original ORCH-0787 [refund-order] copy.
  if (payload.cancelledBy === "buyer" || payload.cancelledBy === "operator") {
    return refundIssuedToGenericBodyTr4(payload, context);
  }

  // Original ORCH-0787 [refund-order] path — unchanged.
  const isFull = payload.is_full_refund === true;
  const amount = formatMoneyFromCents(payload.amount_cents, payload.currency);
  const reason = trimmedReason(payload.reason);

  const title = isFull
    ? `Your refund for ${context.eventTitle} is on the way`
    : `A partial refund for ${context.eventTitle} is on the way`;

  const paragraphs: string[] = [
    greeting(context.buyerName),
    `${context.brandName} has issued ${
      isFull ? "a full" : "a partial"
    } refund of ${amount} for your order #${context.orderShortId}.`,
    `Refunds typically appear in your account within 5–10 business days.`,
  ];
  if (reason) {
    paragraphs.push(`Reason: ${reason}`);
  }
  if (!isFull) {
    paragraphs.push(`The remaining tickets on this order are still valid.`);
  }
  paragraphs.push(`If you have any questions, reply to this email.`);

  return {
    variant: "generic_notification",
    title,
    paragraphs,
    cta: null,
  };
}

// ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] D-3 / D-4 templates per
// DESIGN_ORCH-0875 §5.3.
function refundIssuedToGenericBodyTr4(
  payload: RefundIssuedPayloadShape,
  context: BuyerContext,
): GenericBodyInput {
  const cancelledBy = payload.cancelledBy as "buyer" | "operator";
  const amountCents = payload.refundAmountCents ?? payload.amount_cents;
  const amount = formatMoneyFromCents(amountCents, payload.currency);
  const cardPhrase = cardEndingPhrase(context.cardLast4);
  const breakdownLines = installmentBreakdownLines(payload.installmentBreakdown);
  // Reference ID per DESIGN §5.3 OQ-D-2: RFD-{first-6-chars-of-refund-id}
  const referenceShort =
    typeof payload.stripe_refund_id === "string" && payload.stripe_refund_id.length >= 6
      ? `RFD-${payload.stripe_refund_id.slice(0, 6)}`
      : "RFD-pending";

  if (cancelledBy === "buyer") {
    // Template D-3 — buyer self-cancel + refund issued
    const title = `Refund of ${amount} is on its way`;
    const paragraphs: string[] = [
      greeting(context.buyerName),
      `Following your cancellation of ${context.eventTitle}, we've issued a refund of ${amount} ${cardPhrase}.`,
      `It typically appears within 5–10 business days.`,
      ...breakdownLines,
      `Reference: ${referenceShort}`,
    ];
    return {
      variant: "generic_notification",
      title,
      paragraphs,
      cta: null,
    };
  }

  // Template D-4 — operator-cancel + refund issued
  const title = `Refund of ${amount} from ${context.brandName}`;
  const paragraphs: string[] = [
    greeting(context.buyerName),
    `Following the cancellation of ${context.eventTitle} by ${context.brandName}, we've issued a refund of ${amount} ${cardPhrase}.`,
    `It typically appears within 5–10 business days.`,
    ...breakdownLines,
    `Reference: ${referenceShort}`,
  ];
  const organizerEmail = context.organizerEmail;
  if (typeof organizerEmail === "string" && organizerEmail.length > 0) {
    paragraphs.push(`If you have questions, contact the organizer at ${organizerEmail}.`);
  }
  return {
    variant: "generic_notification",
    title,
    paragraphs,
    cta: null,
  };
}

export function orderCancelledToGenericBody(
  payload: OrderCancelledPayloadShape,
  context: BuyerContext,
): GenericBodyInput {
  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] branch: when cancelledBy
  // is present, render templates D-1 (buyer) or D-2 (operator) per DESIGN
  // §5.3. Otherwise render the original ORCH-0788 generic copy.
  if (payload.cancelledBy === "buyer" || payload.cancelledBy === "operator") {
    return orderCancelledToGenericBodyTr4(payload, context);
  }

  // Original ORCH-0788 path — unchanged.
  const reason = trimmedReason(payload.reason);
  const title = `Your order for ${context.eventTitle} has been cancelled`;

  const paragraphs: string[] = [
    greeting(context.buyerName),
    `${context.brandName} has cancelled your order #${context.orderShortId} for ${context.eventTitle}.`,
    `Your tickets are no longer valid.`,
  ];
  if (reason) {
    paragraphs.push(`Reason: ${reason}`);
  }
  paragraphs.push(
    `If you paid for this order, a refund will be processed separately. If you have any questions, reply to this email.`,
  );

  return {
    variant: "generic_notification",
    title,
    paragraphs,
    cta: null,
  };
}

// ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] D-1 / D-2 templates per
// DESIGN_ORCH-0875 §5.3.
function orderCancelledToGenericBodyTr4(
  payload: OrderCancelledPayloadShape,
  context: BuyerContext,
): GenericBodyInput {
  const cancelledBy = payload.cancelledBy as "buyer" | "operator";
  const refundIssued = payload.refundIssued !== false; // default true if absent
  const refundAmount =
    typeof payload.refundAmountCents === "number" && payload.refundAmountCents > 0
      ? formatMoneyFromCents(payload.refundAmountCents, payload.currency ?? "GBP")
      : null;
  const cardPhrase = cardEndingPhrase(context.cardLast4);
  const reason = trimmedReason(payload.reason);

  if (cancelledBy === "buyer") {
    // Template D-1 — buyer self-cancel + order cancelled
    const title = `Your reservation for ${context.eventTitle} is cancelled`;
    const paragraphs: string[] = [
      greeting(context.buyerName),
      `Your reservation for ${context.eventTitle} has been cancelled.`,
    ];
    if (refundIssued && refundAmount !== null) {
      paragraphs.push(
        `A refund of ${refundAmount} is on its way ${cardPhrase}. Refunds typically appear within 5–10 business days.`,
      );
    } else {
      // 0% tier case — no refund applies
      paragraphs.push(
        `No refund applies because the cancellation policy doesn't cover refunds at this time. If you have questions, contact the organizer.`,
      );
    }
    const organizerEmail = context.organizerEmail;
    if (typeof organizerEmail === "string" && organizerEmail.length > 0) {
      paragraphs.push(`If you didn't request this cancellation, contact ${organizerEmail} immediately.`);
    }
    return {
      variant: "generic_notification",
      title,
      paragraphs,
      cta: null,
    };
  }

  // Template D-2 — operator-cancel + order cancelled
  const title = `${context.brandName} cancelled your reservation for ${context.eventTitle}`;
  const paragraphs: string[] = [
    greeting(context.buyerName),
    `${context.brandName} has cancelled your reservation for ${context.eventTitle}.`,
  ];
  if (reason) {
    paragraphs.push(`Their reason: "${reason}"`);
  }
  if (refundIssued && refundAmount !== null) {
    paragraphs.push(
      `A refund of ${refundAmount} is on its way ${cardPhrase}. Refunds typically appear within 5–10 business days.`,
    );
  } else {
    paragraphs.push(
      `No refund applies because the cancellation policy doesn't cover refunds at this time. If you have questions, contact the organizer.`,
    );
  }
  const organizerEmail = context.organizerEmail;
  if (typeof organizerEmail === "string" && organizerEmail.length > 0) {
    paragraphs.push(`Questions? Contact the organizer at ${organizerEmail}.`);
  }
  return {
    variant: "generic_notification",
    title,
    paragraphs,
    cta: null,
  };
}
