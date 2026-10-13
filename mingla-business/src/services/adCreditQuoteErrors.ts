/**
 * toward #3697 Wave 7 — host-facing copy for ad-credit quote failures.
 *
 * Kept out of AdCreditQuoteSheet so Jest can exercise the mapper without
 * loading react-native-reanimated via Button.
 */

import { AdCreditAppError } from "./adCreditService";

/** Map edge machine details to host-facing copy (never show raw tokens). */
export function mapAdCreditQuoteError(err: unknown): string {
  if (!(err instanceof AdCreditAppError)) {
    return "Could not quote. Try again.";
  }
  const detail = (err.detail ?? err.message ?? "").trim();
  switch (detail) {
    case "pay_below_minimum":
      return "That amount is below the minimum top-up for this currency.";
    case "pay_above_maximum":
      return "That amount is above the maximum top-up for this currency.";
    case "currency_unsupported":
      return "This currency is not supported for Ads credit yet.";
    case "credit_below_minimum":
    case "credit_invalid":
      return "Enter a valid credit amount to withdraw.";
    case "balance_too_low":
      return "That is more than your available credit.";
    default:
      if (err.code === "forbidden") {
        return "You need finance permission to add or withdraw credit.";
      }
      if (err.code === "unauthorized") {
        return "Sign in again to continue.";
      }
      return "Could not quote. Try again.";
  }
}
