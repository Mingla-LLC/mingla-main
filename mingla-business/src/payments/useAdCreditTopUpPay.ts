/**
 * toward #3697 Wave 7b — web Ads credit top-up (Checkout redirect).
 */

import { Linking } from "react-native";

import type { AdCreditStartTopUpResult } from "../services/adCreditService";
import type { AdCreditTopUpPayOutcome } from "./adCreditTopUpPay";

export type { AdCreditTopUpPayOutcome };

export function useAdCreditTopUpPay(): (
  start: AdCreditStartTopUpResult,
) => Promise<AdCreditTopUpPayOutcome> {
  return async (start: AdCreditStartTopUpResult): Promise<AdCreditTopUpPayOutcome> => {
    if (start.kind !== "requires_checkout_redirect") {
      return {
        outcome: "failed",
        message:
          "Native PaymentSheet is not available on web. Use Checkout redirect.",
      };
    }
    if (typeof window !== "undefined" && typeof window.location?.assign === "function") {
      window.location.assign(start.url);
      return { outcome: "redirected" };
    }
    const opened = await Linking.openURL(start.url);
    if (!opened) {
      return { outcome: "failed", message: "Could not open checkout." };
    }
    return { outcome: "redirected" };
  };
}
