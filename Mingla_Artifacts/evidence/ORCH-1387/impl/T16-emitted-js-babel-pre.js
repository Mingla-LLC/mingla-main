import { useQueryClient } from "@tanstack/react-query";
import { useStripePaymentSheet } from "@mingla/payments-native";
import { initStripe } from "@stripe/stripe-react-native";
import * as WebBrowser from "expo-web-browser";
import { createVenueReservation, confirmVenueReservation } from "../services/venueReservationService";
import { buildApplePayCartItems } from "../payments/applePayCartItem";
import { myReservationsKeys } from "./useMyReservations";
const MERCHANT_DISPLAY_NAME = "Mingla";
const isStripeGooglePayTestEnv = () => process.env.EAS_BUILD_PROFILE !== "production";
const PAYSTACK_POLL_INTERVAL_MS = 1500;
const PAYSTACK_POLL_MAX_ATTEMPTS = 17;
export const useReserveTable = userId => {
  const queryClient = useQueryClient();
  const {
    initPaymentSheet,
    presentPaymentSheet,
    isPaymentSheetSupported
  } = useStripePaymentSheet();
  return async (input, displayTitle) => {
    let created;
    try {
      created = await createVenueReservation(input);
    } catch (err) {
      return {
        outcome: "failed",
        message: err instanceof Error ? err.message : "Reservation failed."
      };
    }
    const invalidate = () => {
      if (userId) {
        void queryClient.invalidateQueries({
          queryKey: myReservationsKeys.byUser(userId)
        });
      }
    };
    if (created.kind === "free_completed") {
      invalidate();
      return {
        outcome: "succeeded",
        reservationId: created.reservationId
      };
    }
    if (created.kind === "requires_payment") {
      if (!isPaymentSheetSupported) {
        return {
          outcome: "failed",
          message: "Native payment is not available on this device."
        };
      }
      if (created.publishableKey && created.stripeAccountId) {
        await initStripe({
          publishableKey: created.publishableKey,
          stripeAccountId: created.stripeAccountId,
          merchantIdentifier: "merchant.com.mingla.app.v2",
          urlScheme: "com.mingla.app.v2"
        });
      }
      const walletConfig = {
        applePay: {
          merchantCountryCode: "US",
          cartItems: buildApplePayCartItems(displayTitle, created.totalCents, "Reservation")
        },
        googlePay: {
          merchantCountryCode: "US",
          testEnv: isStripeGooglePayTestEnv(),
          currencyCode: created.currency.toLowerCase()
        }
      };
      const initResult = await initPaymentSheet({
        merchantDisplayName: MERCHANT_DISPLAY_NAME,
        paymentIntentClientSecret: created.clientSecret,
        returnURL: "com.mingla.app.v2://stripe-redirect",
        ...(created.customerId && created.customerEphemeralKeySecret ? {
          customerId: created.customerId,
          customerEphemeralKeySecret: created.customerEphemeralKeySecret
        } : {}),
        ...walletConfig
      });
      if (initResult.error) {
        return {
          outcome: "failed",
          message: initResult.error.localizedMessage ?? initResult.error.message ?? "Couldn't open payment sheet."
        };
      }
      const presentResult = await presentPaymentSheet();
      if (presentResult.error) {
        if (presentResult.error.code === "Canceled") {
          return {
            outcome: "canceled"
          };
        }
        return {
          outcome: "failed",
          message: presentResult.error.localizedMessage ?? presentResult.error.message ?? "Payment failed."
        };
      }
      return finalizeFee(created.reservationDraftId, created.buyerStatusToken, invalidate);
    }
    if (created.kind === "requires_paystack_redirect") {
      try {
        await WebBrowser.openAuthSessionAsync(created.authorizationUrl, "https://business.usemingla.com/pay/callback");
      } catch {}
      return finalizeFeePolled(created.reservationDraftId, created.buyerStatusToken, invalidate);
    }
    return {
      outcome: "failed",
      message: "Unexpected web checkout response on native client."
    };
  };
};
async function finalizeFee(reservationDraftId, buyerStatusToken, invalidate) {
  try {
    const result = await confirmVenueReservation({
      reservationDraftId,
      buyerStatusToken
    });
    if (result.status === "completed") {
      invalidate();
      return {
        outcome: "succeeded",
        reservationId: result.reservationId
      };
    }
    return {
      outcome: "failed",
      message: result.status === "pending" ? "We're confirming your payment. Your reservation will appear shortly." : "Your payment didn't go through."
    };
  } catch (err) {
    return {
      outcome: "failed",
      message: err instanceof Error ? err.message : "Confirmation failed."
    };
  }
}
async function finalizeFeePolled(reservationDraftId, buyerStatusToken, invalidate) {
  for (let attempt = 0; attempt < PAYSTACK_POLL_MAX_ATTEMPTS; attempt++) {
    try {
      const result = await confirmVenueReservation({
        reservationDraftId,
        buyerStatusToken
      });
      if (result.status === "completed") {
        invalidate();
        return {
          outcome: "succeeded",
          reservationId: result.reservationId
        };
      }
      if (result.status === "failed") {
        return {
          outcome: "failed",
          message: "Your payment didn't go through."
        };
      }
    } catch {}
    await new Promise(r => setTimeout(r, PAYSTACK_POLL_INTERVAL_MS));
  }
  return {
    outcome: "failed",
    message: "We couldn't confirm your payment yet. If you completed it, your reservation will appear shortly."
  };
}