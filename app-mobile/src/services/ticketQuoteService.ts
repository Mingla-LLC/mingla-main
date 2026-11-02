import type { TicketQuote } from "@mingla/offering-rendering/discountQuote";
import {
  decodeInstallmentChargeSchedule,
  installmentPlanBuyerTotal,
} from "@mingla/offering-rendering/discountQuote";

import { supabase } from "./supabase";
import { extractFunctionError } from "../utils/edgeFunctionError";

export interface TicketQuoteInput {
  eventId: string;
  buyer: {
    name: string;
    email: string;
    phone: string;
    marketingOptIn?: boolean;
  };
  lines: {
    ticketTypeId: string;
    quantity: number;
    paymentPlanChoice: "full" | "installments";
    byDate?: Record<string, number>;
  }[];
  eventDateId?: string | null;
  eventDateIds?: readonly string[] | null;
  bookedStartAt?: string | null;
  bookedEndAt?: string | null;
  partySize?: number | null;
  discountCode?: string | null;
}

const quoteBuyer = (
  buyer: TicketQuoteInput["buyer"],
): TicketQuoteInput["buyer"] => ({
  ...buyer,
  name: buyer.name.trim().length >= 2 ? buyer.name : "Mingla guest",
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email)
    ? buyer.email
    : "quote@usemingla.invalid",
  phone: /^\+[1-9]\d{7,14}$/.test(buyer.phone) ? buyer.phone : "+12025550123",
});

/** #3872 — Explorer renders this server quote and performs no money arithmetic. */
export const quoteTicketCheckout = async (
  input: TicketQuoteInput,
): Promise<TicketQuote> => {
  const { data, error } = await supabase.functions.invoke<TicketQuote>(
    "ticket-checkout-create",
    {
      body: {
        mode: "quote",
        eventId: input.eventId,
        surface: "native",
        buyer: quoteBuyer(input.buyer),
        lines: input.lines,
        ...(input.eventDateId ? { eventDateId: input.eventDateId } : {}),
        ...(input.eventDateIds && input.eventDateIds.length > 0
          ? { eventDateIds: [...input.eventDateIds] }
          : {}),
        ...(input.bookedStartAt ? { bookedStartAt: input.bookedStartAt } : {}),
        ...(input.bookedEndAt ? { bookedEndAt: input.bookedEndAt } : {}),
        ...(typeof input.partySize === "number" && input.partySize >= 1
          ? { partySize: Math.floor(input.partySize) }
          : {}),
        ...(typeof input.discountCode === "string" &&
            input.discountCode.trim().length > 0
          ? { discountCode: input.discountCode.trim() }
          : {}),
      },
    },
  );

  if (error) {
    throw new Error(await extractFunctionError(error, "quote_failed"));
  }
  if (!data || data.kind !== "quote") throw new Error("quote_failed");
  const schedule = decodeInstallmentChargeSchedule(
    data.installmentChargeSchedule,
  );
  const planTotalBuyerCents = installmentPlanBuyerTotal(
    data.buyerTotalCents,
    schedule,
  );
  return {
    ...data,
    ...(schedule === undefined
      ? { installmentChargeSchedule: undefined }
      : { installmentChargeSchedule: schedule }),
    planTotalBuyerCents,
  };
};
