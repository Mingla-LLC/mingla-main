/**
 * Issue #3355 P6 — Seth's decision 6 at the Host ticket price field.
 *
 * The server refuses a NEW or CHANGED paid price below the payment provider's
 * minimum (migration 20280228003355). The price field says so as it is typed,
 * with the same words Ari uses. A tier whose saved price is unchanged is never
 * blocked: older below-minimum prices stay valid, exactly like the server.
 */

import { ticketPriceBelowMinimum } from "../constants/providerMinimumCharges";

export interface TicketPriceEntry {
  isFree: boolean;
  priceText: string;
  currency: string | null | undefined;
  /** The saved tier (null for a new tier). */
  initialIsFree: boolean | null;
  initialPriceMajor: number | null;
  /** A price the caller can't change anyway (sold tier, role lock). */
  isPriceLocked: boolean;
}

/** The minimum-price message for this entry, or null when it is fine. */
export function ticketPriceEntryMinimumMessage(
  entry: TicketPriceEntry,
): string | null {
  if (entry.isFree || entry.isPriceLocked) return null;
  const typed = entry.priceText.trim();
  if (typed.length === 0) return null;
  const price = Number(typed);
  if (!Number.isFinite(price) || price <= 0) return null;
  const unchanged =
    entry.initialIsFree === false &&
    entry.initialPriceMajor !== null &&
    Math.round(entry.initialPriceMajor * 100) === Math.round(price * 100);
  if (unchanged) return null;
  return ticketPriceBelowMinimum(price, entry.currency);
}
