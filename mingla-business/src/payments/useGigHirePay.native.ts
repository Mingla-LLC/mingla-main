/**
 * #3872 — native creator-fee payment: card PaymentSheet (US rail) or the
 * hosted checkout page (NG rail). Mirrors the Ads credit top-up hook.
 */

import { useStripePaymentSheet } from "@mingla/payments-native";

import type { GigHireStart } from "../services/gigHireService";
import type { GigHirePayOutcome } from "./gigHirePay";

export type { GigHirePayOutcome };

const BUSINESS_URL_SCHEME = "com.sethogieva.minglabusiness";

/**
 * Must render inside StripeProviderWrapper (the sheet wraps itself), which
 * carries the publishable key, merchant identifier and URL scheme. Card only:
 * no wallet sheet for creator fees.
 */
export function useGigHirePay(): (start: GigHireStart) => Promise<GigHirePayOutcome> {
  const { initPaymentSheet, presentPaymentSheet } = useStripePaymentSheet();

  return async (start: GigHireStart): Promise<GigHirePayOutcome> => {
    if (start.kind === "requires_checkout_redirect") {
      const { Linking } = await import("react-native");
      try {
        await Linking.openURL(start.url);
        return { outcome: "redirected" };
      } catch {
        return { outcome: "failed", message: "We couldn't open the payment page. Try again." };
      }
    }
    const initResult = await initPaymentSheet({
      merchantDisplayName: "Mingla",
      paymentIntentClientSecret: start.client_secret,
      returnURL: `${BUSINESS_URL_SCHEME}://stripe-redirect`,
    });
    if (initResult.error) {
      return { outcome: "failed", message: "We couldn't open the card form. Try again." };
    }
    const presentResult = await presentPaymentSheet();
    if (presentResult.error) {
      if (presentResult.error.code === "Canceled") return { outcome: "canceled" };
      return { outcome: "failed", message: "The card payment didn't go through. Try another card." };
    }
    return { outcome: "succeeded" };
  };
}
