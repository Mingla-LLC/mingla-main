import type { TicketQuote } from "@mingla/offering-rendering/discountQuote";
import {
  decodeInstallmentChargeSchedule,
  installmentPlanBuyerTotal,
} from "@mingla/offering-rendering/discountQuote";

import type {
  BuyerDetails,
  CartLine,
} from "../components/checkout/CartContext";
import { invokeTicketCheckoutRequest } from "./ticketCheckoutService";

type TicketQuoteLineInput = Omit<CartLine, "paymentPlanChoice"> & {
  paymentPlanChoice?: CartLine["paymentPlanChoice"];
};

export interface TicketQuoteInput {
  eventId: string;
  buyer: BuyerDetails;
  lines: TicketQuoteLineInput[];
  ticketLinkToken?: string;
  surface: "web" | "mobile-web" | "native";
  paymentPlanChoice?: "full" | "installments";
  eventDateId?: string;
  eventDateIds?: readonly string[];
  bookedStartAt?: string;
  bookedEndAt?: string;
  partySize?: number;
  discountCode?: string | null;
  queued?: boolean;
}

const quoteBuyer = (buyer: BuyerDetails): BuyerDetails => ({
  ...buyer,
  // Quote mode intentionally runs before the contact step. These non-deliverable
  // placeholders satisfy the edge's shared request-shape validation; once the
  // guest supplies contact details, that identity is included in the next quote
  // so per-buyer limits remain server-authoritative before create.
  name: buyer.name.trim().length >= 2 ? buyer.name : "Mingla guest",
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email)
    ? buyer.email
    : "quote@usemingla.invalid",
  phone: /^\+[1-9]\d{7,14}$/.test(buyer.phone) ? buyer.phone : "+12025550123",
});

/**
 * #3872 — side-effect-free ticket quote. The edge owns all discount, plan,
 * fee and tax arithmetic; this client only shapes the request and renders the
 * returned minor-unit values. The module stays behind the checkout route's
 * deferred quote controller so it does not tax first boot.
 */
export const quoteTicketCheckout = async (
  input: TicketQuoteInput,
): Promise<TicketQuote> => {
  const buyer = quoteBuyer(input.buyer);
  const quote = await invokeTicketCheckoutRequest<TicketQuote>({
    mode: "quote",
    eventId: input.eventId,
    buyer,
    lines: input.lines.map((line) => ({
      ticketTypeId: line.ticketTypeId,
      quantity: line.quantity,
      expectedUnitPriceCents: Math.round(line.unitPrice * 100),
      // issue #3281 — undefined drops out of the JSON for uniform carts.
      byDate: line.byDate,
    })),
    surface: input.surface,
    ...(input.ticketLinkToken !== undefined && input.ticketLinkToken.length > 0
      ? { ticketLinkToken: input.ticketLinkToken }
      : {}),
    ...(input.paymentPlanChoice !== undefined
      ? { payment_plan_choice: input.paymentPlanChoice }
      : {}),
    ...(input.eventDateId !== undefined && input.eventDateId.length > 0
      ? { eventDateId: input.eventDateId }
      : {}),
    ...(input.eventDateIds !== undefined && input.eventDateIds.length > 0
      ? { eventDateIds: [...input.eventDateIds] }
      : {}),
    ...(input.bookedStartAt !== undefined && input.bookedStartAt.length > 0
      ? { bookedStartAt: input.bookedStartAt }
      : {}),
    ...(input.bookedEndAt !== undefined && input.bookedEndAt.length > 0
      ? { bookedEndAt: input.bookedEndAt }
      : {}),
    ...(typeof input.partySize === "number" && input.partySize >= 1
      ? { partySize: Math.floor(input.partySize) }
      : {}),
    ...(typeof input.discountCode === "string" && input.discountCode.length > 0
      ? { discountCode: input.discountCode }
      : {}),
    ...(input.queued === true ? { queueContract: "queue_v1" } : {}),
  });
  const schedule = decodeInstallmentChargeSchedule(
    quote.installmentChargeSchedule,
  );
  const planTotalBuyerCents = installmentPlanBuyerTotal(
    quote.buyerTotalCents,
    schedule,
  );
  return {
    ...quote,
    ...(schedule === undefined
      ? { installmentChargeSchedule: undefined }
      : { installmentChargeSchedule: schedule }),
    planTotalBuyerCents,
  };
};
