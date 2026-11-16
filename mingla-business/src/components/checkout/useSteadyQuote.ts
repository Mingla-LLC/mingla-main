/**
 * useSteadyQuote — #4420, the buyer-step "glitch".
 *
 * The server quote is keyed on the buyer's email and phone (a discount can be
 * buyer-scoped), so every keystroke in those fields re-quotes: the cart drops
 * its quote to `null` with status "loading" for the 300 ms debounce plus the
 * request. The Order summary rendered only `quote !== null`, so it collapsed
 * from four rows to a header and back on every character, and the whole form
 * jumped about 100px under the guest's cursor.
 *
 * This keeps the LAST priced quote on screen while a refresh is in flight, for
 * DISPLAY only. Nothing that moves money reads it: Continue still requires
 * `quoteStatus === "ready"` and uses the cart's own fresh quote, and the bottom
 * bar still says "Updating…" until that fresh quote lands. An error or an
 * emptied cart drops the held quote, so a failed quote is never dressed up as a
 * good one.
 */
import { useRef } from "react";
import type { TicketQuote } from "@mingla/offering-rendering/discountQuote";

export type SteadyQuoteStatus = "idle" | "loading" | "ready" | "error";

export interface SteadyQuote {
  quote: TicketQuote | null;
  /** True while the shown quote is the previous one and a fresh one is coming. */
  refreshing: boolean;
}

export function useSteadyQuote(
  quote: TicketQuote | null,
  status: SteadyQuoteStatus,
): SteadyQuote {
  const held = useRef<TicketQuote | null>(null);
  if (quote !== null) {
    held.current = quote;
    return { quote, refreshing: false };
  }
  if (status !== "loading") held.current = null;
  return {
    quote: status === "loading" ? held.current : null,
    refreshing: status === "loading" && held.current !== null,
  };
}
