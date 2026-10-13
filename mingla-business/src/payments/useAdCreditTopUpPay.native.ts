/**
 * toward #3697 Wave 7b — native Ads credit top-up via platform PaymentSheet.
 */

import { initStripe } from "@stripe/stripe-react-native";
import { useStripePaymentSheet } from "@mingla/payments-native";

import type { AdCreditStartTopUpResult } from "../services/adCreditService";
import type { AdCreditTopUpPayOutcome } from "./adCreditTopUpPay";

export type { AdCreditTopUpPayOutcome };

const BUSINESS_MERCHANT_IDENTIFIER = "merchant.com.sethogieva.minglabusiness";
const BUSINESS_URL_SCHEME = "com.sethogieva.minglabusiness";
const MERCHANT_DISPLAY_NAME = "Mingla";

function resolvePublishableKey(): string | null {
  const fromExtra = (
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("expo-constants").default?.expoConfig?.extra as
      | { EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY?: string }
      | undefined
  )?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const fromEnv = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const key = (fromExtra ?? fromEnv ?? "").trim();
  return key.length > 0 ? key : null;
}

export function useAdCreditTopUpPay(): (
  start: AdCreditStartTopUpResult,
) => Promise<AdCreditTopUpPayOutcome> {
  const { initPaymentSheet, presentPaymentSheet } = useStripePaymentSheet();

  return async (start: AdCreditStartTopUpResult): Promise<AdCreditTopUpPayOutcome> => {
    // NGN Paystack (and web Checkout replay) open an external authorization URL.
    if (start.kind === "requires_checkout_redirect") {
      const { Linking } = await import("react-native");
      const opened = await Linking.openURL(start.url);
      if (!opened) {
        return { outcome: "failed", message: "Could not open checkout." };
      }
      return { outcome: "redirected" };
    }

    const publishableKey = resolvePublishableKey();
    if (!publishableKey) {
      return {
        outcome: "failed",
        message: "Card payments are not configured on this build.",
      };
    }

    await initStripe({
      publishableKey,
      merchantIdentifier: BUSINESS_MERCHANT_IDENTIFIER,
      urlScheme: BUSINESS_URL_SCHEME,
    });

    const initResult = await initPaymentSheet({
      merchantDisplayName: MERCHANT_DISPLAY_NAME,
      paymentIntentClientSecret: start.client_secret,
      returnURL: `${BUSINESS_URL_SCHEME}://stripe-redirect`,
      applePay: { merchantCountryCode: "US" },
      googlePay: {
        merchantCountryCode: "US",
        testEnv: publishableKey.startsWith("pk_test_"),
        currencyCode: start.quote.currency.toLowerCase(),
      },
    });
    if (initResult.error) {
      return {
        outcome: "failed",
        message: initResult.error.message ?? "Could not open card sheet.",
      };
    }

    const presentResult = await presentPaymentSheet();
    if (presentResult.error) {
      if (presentResult.error.code === "Canceled") {
        return { outcome: "canceled" };
      }
      return {
        outcome: "failed",
        message: presentResult.error.message ?? "Payment failed.",
      };
    }

    return {
      outcome: "succeeded",
      paymentIntentId: start.payment_intent_id,
    };
  };
}
