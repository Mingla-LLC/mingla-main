import React, { useEffect, useMemo } from "react";

import { useTicketQuote } from "../../hooks/useTicketQuote";
import { useCart } from "./CartContext";

export interface TicketQuoteControllerProps {
  eventId: string;
  surface?: "web" | "mobile-web";
  ticketLinkToken?: string | null;
}

/** Keeps the route group's in-memory cart synchronized with server pricing. */
export const TicketQuoteController: React.FC<TicketQuoteControllerProps> = ({
  eventId,
  surface = "web",
  ticketLinkToken = null,
}) => {
  const cart = useCart();
  const input = useMemo(
    () => ({
      eventId,
      surface,
      buyer: cart.buyer,
      lines: cart.lines,
      ticketLinkToken: ticketLinkToken ?? undefined,
      paymentPlanChoice: cart.paymentPlanChoice,
      eventDateId: cart.eventDateId ?? undefined,
      eventDateIds: cart.eventDateIds,
      bookedStartAt: cart.bookedStartAt ?? undefined,
      bookedEndAt: cart.bookedEndAt ?? undefined,
      partySize: cart.partySize ?? undefined,
      discountCode: cart.discountCode,
    }),
    [
      eventId,
      surface,
      ticketLinkToken,
      cart.buyer,
      cart.lines,
      cart.paymentPlanChoice,
      cart.eventDateId,
      cart.eventDateIds,
      cart.bookedStartAt,
      cart.bookedEndAt,
      cart.partySize,
      cart.discountCode,
    ],
  );
  const { query, isDebouncing } = useTicketQuote(input);

  useEffect(() => {
    if (cart.lines.length === 0) {
      cart.setQuoteState(null, "idle");
      return;
    }
    if (isDebouncing || query.isFetching) {
      cart.setQuoteState(null, "loading");
      return;
    }
    if (query.data !== undefined) {
      cart.setQuoteState(query.data, "ready");
      return;
    }
    if (query.isError) {
      const failure = query.error as { code?: unknown; detail?: unknown } | null;
      const code = failure?.code;
      // issue #3281 — a refused quote names its reason in the detail (an extra
      // sold out, say); the cart step reads it from there.
      cart.setQuoteState(
        null,
        "error",
        code === "checkout_quote_failed" && typeof failure?.detail === "string"
          ? failure.detail
          : typeof code === "string"
            ? code
            : null,
      );
    }
  }, [
    cart.lines.length,
    cart.setQuoteState,
    isDebouncing,
    query.data,
    query.isError,
    query.isFetching,
  ]);

  return null;
};
