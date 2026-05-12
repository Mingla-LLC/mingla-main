// ORCH-0788 — Buyer lifecycle email adapters.
//
// Translates `ticket_order_notifications.payload` shapes (written by
// refund-order, cancel-order, and the Stripe webhook refund handler) into
// the existing `GenericBodyInput` shape consumed by
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

import { formatMoneyFromCents } from "./currency.ts";
import type { GenericBodyInput } from "./types.ts";

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
}

export interface OrderCancelledPayloadShape {
  template_key: "buyer_order_cancelled";
  reason?: string;
}

export interface BuyerContext {
  buyerName: string | null;
  eventTitle: string;
  brandName: string;
  orderShortId: string;
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

export function refundIssuedToGenericBody(
  payload: RefundIssuedPayloadShape,
  context: BuyerContext,
): GenericBodyInput {
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

export function orderCancelledToGenericBody(
  payload: OrderCancelledPayloadShape,
  context: BuyerContext,
): GenericBodyInput {
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
