/**
 * toward #3697 Wave 7 / 7b — host-facing copy for ad-credit failures.
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
      return "Card top-up is available for USD and GBP. Naira ships next.";
    case "credit_below_minimum":
    case "credit_invalid":
      return "Enter a valid credit amount to withdraw.";
    case "balance_too_low":
      return "That is more than your available credit.";
    case "payment_ref_required":
      return "Payment did not finish. Try again.";
    case "payment_ref_invalid":
    case "payment_not_found":
      return "We could not find that payment. Try again.";
    case "payment_not_succeeded":
      return "Payment did not complete. You were not charged for credit.";
    case "payment_mismatch":
    case "payment_brand_mismatch":
    case "payment_purpose_mismatch":
      return "That payment does not match this top-up. Credit was not added.";
    case "return_url_invalid":
      return "Could not open checkout. Try again from the Ads page.";
    case "stripe_start_failed":
    case "checkout_url_missing":
    case "client_secret_missing":
      return "Could not start card checkout. Try again.";
    default:
      if (err.code === "forbidden") {
        return "You need finance permission to add or withdraw credit.";
      }
      if (err.code === "unauthorized") {
        return "Sign in again to continue.";
      }
      if (err.code === "apply_failed") {
        return "Could not add credit after payment. Contact support if this persists.";
      }
      return "Could not complete Ads credit. Try again.";
  }
}
