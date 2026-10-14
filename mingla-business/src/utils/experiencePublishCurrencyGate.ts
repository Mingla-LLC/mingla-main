/**
 * #3645 — a PAID experience cannot leave draft on a brand with no currency.
 *
 * Money needs a currency, and a brand gets one by choosing its payout country.
 * So the creator stops a paid Publish on the client and asks for the country in
 * place.
 *
 * A FREE experience is not stopped here. Whether it may publish with no
 * currency is the server's answer, and that answer changes when migration
 * 20270830003645 is applied:
 *  - before: the server refuses it with `event_currency_required`. The creator
 *    turns that refusal into the same sentence and the same in-place country
 *    prompt (`isEventCurrencyRequiredRefusal`), so the host sees what they saw
 *    when the client stopped it;
 *  - after: the server publishes it, stored with no currency.
 * Stopping a free publish on the client would hide the second answer for ever.
 *
 * Pure: no react-native and no supabase import.
 */

import { readRpcFailureMessage } from "../services/rsvpRpcFailure";
import { currencyCodeOrNull } from "./currency";

/** What the organiser reads, on the toast and on the inline prompt. */
export const EXPERIENCE_PAYOUT_COUNTRY_PUBLISH_COPY =
  "Choose your payout country to publish an experience.";

/**
 * True when Publish must NOT reach the server: this is a publish (never a
 * draft save) of a PAID experience and the brand has no currency.
 *
 * `isPaid` left out means "treat as paid": a caller that cannot say is stopped,
 * never waved through.
 */
export function experiencePublishNeedsPayoutCountry(input: {
  publish: boolean;
  brandDefaultCurrency: string | null | undefined;
  isPaid?: boolean;
}): boolean {
  if (!input.publish || input.isPaid === false) return false;
  return currencyCodeOrNull(input.brandDefaultCurrency) === null;
}

/**
 * True when a failed publish is the server's "this brand has no currency"
 * refusal. Reads both an `Error` and the bare PostgREST error object.
 */
export function isEventCurrencyRequiredRefusal(error: unknown): boolean {
  return readRpcFailureMessage(error).includes("event_currency_required");
}

/**
 * The symbol shown next to an experience price. A brand with no currency shows
 * NO symbol: the draft row may carry a placeholder currency, but the organiser
 * never chose one and must not be shown one.
 */
export function experienceDisplayCurrencySymbol(
  brandDefaultCurrency: string | null | undefined,
  symbolFor: (currency: string) => string,
): string {
  const code = currencyCodeOrNull(brandDefaultCurrency);
  return code === null ? "" : symbolFor(code);
}
