/**
 * #3645 — an experience cannot leave draft on a brand with no currency.
 *
 * The server refuses that publish with `event_currency_required`, free or
 * priced, because the experience publish path does not declare "free only".
 * Until the server does, the creator stops Publish on the client and asks for
 * the payout country in place, and a refusal that still gets through (stale
 * brand state) lands on the same sentence instead of a generic error.
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
 * draft save) and the brand has no currency.
 */
export function experiencePublishNeedsPayoutCountry(input: {
  publish: boolean;
  brandDefaultCurrency: string | null | undefined;
}): boolean {
  return input.publish && currencyCodeOrNull(input.brandDefaultCurrency) === null;
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
