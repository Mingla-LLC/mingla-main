import { useEffect, useMemo, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { TicketQuote } from "@mingla/offering-rendering/discountQuote";

import {
  quoteTicketCheckout,
  type TicketQuoteInput,
} from "../services/ticketQuoteService";

export const ticketQuoteKeys = {
  all: ["ticket-checkout-quote"] as const,
  detail: (input: TicketQuoteInput) =>
    [
      ...ticketQuoteKeys.all,
      input.eventId,
      input.surface,
      input.ticketLinkToken ?? null,
      input.lines.map((line) => [
        line.ticketTypeId,
        line.quantity,
        line.byDate ?? null,
        line.paymentPlanChoice ?? null,
      ]),
      input.eventDateId ?? null,
      [...(input.eventDateIds ?? [])].sort(),
      input.bookedStartAt ?? null,
      input.bookedEndAt ?? null,
      input.partySize ?? null,
      input.paymentPlanChoice ?? null,
      input.discountCode ?? null,
      input.buyer.email,
      input.buyer.phone,
    ] as const,
};

export interface UseTicketQuoteResult {
  query: UseQueryResult<TicketQuote, Error>;
  /** True during the mandated 300 ms settling window. */
  isDebouncing: boolean;
}

/**
 * #3872 — non-persisted, debounced server quote. Every money-affecting input
 * is part of the key; the response remains in React Query memory only.
 */
export const useTicketQuote = (
  input: TicketQuoteInput,
): UseTicketQuoteResult => {
  const [debouncedInput, setDebouncedInput] = useState(input);
  const [isDebouncing, setIsDebouncing] = useState(false);
  const identity = useMemo(
    () => JSON.stringify(ticketQuoteKeys.detail(input)),
    [input],
  );

  useEffect(() => {
    setIsDebouncing(true);
    const timer = setTimeout(() => {
      setDebouncedInput(input);
      setIsDebouncing(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [identity, input]);

  const query = useQuery<TicketQuote, Error>({
    queryKey: ticketQuoteKeys.detail(debouncedInput),
    queryFn: () => quoteTicketCheckout(debouncedInput),
    enabled:
      debouncedInput.eventId.length > 0 && debouncedInput.lines.length > 0,
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });

  return { query, isDebouncing };
};
