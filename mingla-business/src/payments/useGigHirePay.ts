/**
 * #3872 — web creator-fee payment. The hosted checkout page (NG rail) opens in
 * the browser; card PaymentSheet payments need the Mingla Business app.
 */

import { Linking } from "react-native";

import type { GigHireStart } from "../services/gigHireService";
import type { GigHirePayOutcome } from "./gigHirePay";

export type { GigHirePayOutcome };

export function useGigHirePay(): (
  start: GigHireStart,
) => Promise<GigHirePayOutcome> {
  return async (start: GigHireStart): Promise<GigHirePayOutcome> => {
    if (start.kind !== "requires_checkout_redirect") {
      return {
        outcome: "failed",
        message:
          "Card payment for creators opens in the Mingla Business app. Open this gig on your phone to pay.",
      };
    }
    if (typeof window !== "undefined" && typeof window.open === "function") {
      window.open(start.url, "_blank", "noopener");
      return { outcome: "redirected" };
    }
    try {
      await Linking.openURL(start.url);
      return { outcome: "redirected" };
    } catch {
      return {
        outcome: "failed",
        message: "We couldn't open the payment page. Try again.",
      };
    }
  };
}
