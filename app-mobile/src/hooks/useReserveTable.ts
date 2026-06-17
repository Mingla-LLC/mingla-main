import { useQueryClient } from "@tanstack/react-query";
import { useStripePaymentSheet } from "@mingla/payments-native";
import { initStripe } from "@stripe/stripe-react-native";
import * as WebBrowser from "expo-web-browser";

import {
  createVenueReservation,
  confirmVenueReservation,
  type CreateVenueReservationInput,
} from "../services/venueReservationService";
import { myReservationsKeys } from "./useMyReservations";

/**
 * useReserveTable — META-ORCH-1148 sub-ORCH 2.2b (SPEC §4.D).
 * ---------------------------------------------------------------------------
 * The single consumer reserve commit. Wraps venueReservationService +, for the
 * FEE path, the native Stripe PaymentSheet (the SAME @mingla/payments-native
 * primitive + Connect direct-charge re-init that nativeCheckoutFlow uses — the
 * reuse seam; nativeCheckoutFlow is hardcoded to ticket-checkout-create so we
 * cannot call it directly, but we mirror its proven PaymentSheet wiring exactly
 * rather than re-inventing).
 *
 *   FREE → create → free_completed → succeeded.
 *   FEE (native PaymentIntent) → create → PaymentSheet → on success
 *     venue-reservation-confirm (verify charge → mint) → succeeded.
 *   FEE (NG/Paystack) → create → in-app hosted checkout → confirm → succeeded.
 *
 * The app user is ALWAYS signed in (root auth gate) so the reservation attaches
 * to the signed-in user server-side via the bearer token — NO sign-in step here.
 * On success it invalidates ["myReservations", userId] so the Calendar tab
 * "Reservations" rows refresh.
 */

export type ReserveOutcome =
  | { outcome: "succeeded"; reservationId: string }
  | { outcome: "canceled" }
  | { outcome: "failed"; message: string };

const MERCHANT_DISPLAY_NAME = "Mingla";

const isStripeGooglePayTestEnv = (): boolean =>
  process.env.EAS_BUILD_PROFILE !== "production";

// Bounded poll for the Paystack confirm (the webhook is the truth; the redirect
// is unreliable). ~25s budget at 1.5s intervals — mirrors nativeCheckoutFlow.
const PAYSTACK_POLL_INTERVAL_MS = 1500;
const PAYSTACK_POLL_MAX_ATTEMPTS = 17;

export const useReserveTable = (
  userId: string | null | undefined,
): ((input: CreateVenueReservationInput) => Promise<ReserveOutcome>) => {
  const queryClient = useQueryClient();
  const { initPaymentSheet, presentPaymentSheet, isPaymentSheetSupported } =
    useStripePaymentSheet();

  return async (
    input: CreateVenueReservationInput,
  ): Promise<ReserveOutcome> => {
    let created;
    try {
      created = await createVenueReservation(input);
    } catch (err) {
      return {
        outcome: "failed",
        message: err instanceof Error ? err.message : "Reservation failed.",
      };
    }

    const invalidate = (): void => {
      if (userId) {
        void queryClient.invalidateQueries({
          queryKey: myReservationsKeys.byUser(userId),
        });
      }
    };

    // ── FREE — already minted server-side. ─────────────────────────────────
    if (created.kind === "free_completed") {
      invalidate();
      return { outcome: "succeeded", reservationId: created.reservationId };
    }

    // ── FEE (native PaymentIntent) — present the Stripe PaymentSheet. ───────
    if (created.kind === "requires_payment") {
      if (!isPaymentSheetSupported) {
        return {
          outcome: "failed",
          message: "Native payment is not available on this device.",
        };
      }
      // Connect direct-charge: re-init the SDK for THIS PI's connected account
      // (ORCH-0844). Without it the mid-sheet confirm hits the platform context
      // and the connected-account client_secret is rejected with a 404.
      if (created.publishableKey && created.stripeAccountId) {
        await initStripe({
          publishableKey: created.publishableKey,
          stripeAccountId: created.stripeAccountId,
          merchantIdentifier: "merchant.com.mingla.app.v2",
          urlScheme: "com.mingla.app.v2",
        });
      }

      // The wallet config (applePay/googlePay) is required for the wallet
      // buttons to render in PaymentSheet (ORCH-0849), but it is not on the
      // shared @mingla/payments-native PaymentSheetInitInput type (the package
      // type predates the wallet config; the native SDK accepts it at runtime —
      // exactly as nativeCheckoutFlow does). Pass it via a typed extension so
      // the keys reach the SDK without forking the package type.
      const walletConfig = {
        applePay: { merchantCountryCode: "US" },
        googlePay: {
          merchantCountryCode: "US",
          testEnv: isStripeGooglePayTestEnv(),
          currencyCode: created.currency.toLowerCase(),
        },
      };
      const initResult = await initPaymentSheet({
        merchantDisplayName: MERCHANT_DISPLAY_NAME,
        paymentIntentClientSecret: created.clientSecret,
        returnURL: "com.mingla.app.v2://stripe-redirect",
        ...(created.customerId && created.customerEphemeralKeySecret
          ? {
              customerId: created.customerId,
              customerEphemeralKeySecret: created.customerEphemeralKeySecret,
            }
          : {}),
        ...(walletConfig as Record<string, unknown>),
      });
      if (initResult.error) {
        return {
          outcome: "failed",
          message:
            initResult.error.localizedMessage ??
            initResult.error.message ??
            "Couldn't open payment sheet.",
        };
      }

      const presentResult = await presentPaymentSheet();
      if (presentResult.error) {
        if (presentResult.error.code === "Canceled") {
          return { outcome: "canceled" };
        }
        return {
          outcome: "failed",
          message:
            presentResult.error.localizedMessage ??
            presentResult.error.message ??
            "Payment failed.",
        };
      }

      // Charge succeeded → synchronously finalize (verify charge → mint). The
      // confirm RPC is idempotent (2.2a DEFECT-1 fix) — never two rows per PI.
      return finalizeFee(
        created.reservationDraftId,
        created.buyerStatusToken,
        invalidate,
      );
    }

    // ── FEE (NG/Paystack) — hosted checkout in an in-app browser, then confirm.
    if (created.kind === "requires_paystack_redirect") {
      try {
        await WebBrowser.openAuthSessionAsync(
          created.authorizationUrl,
          "https://business.usemingla.com/pay/callback",
        );
      } catch {
        // Still confirm — the buyer may have paid before the browser errored.
      }
      return finalizeFeePolled(
        created.reservationDraftId,
        created.buyerStatusToken,
        invalidate,
      );
    }

    // A native client should never receive a web redirect.
    return {
      outcome: "failed",
      message: "Unexpected web checkout response on native client.",
    };
  };
};

/** Single synchronous finalize attempt (Stripe path — PI is verifiable now). */
async function finalizeFee(
  reservationDraftId: string,
  buyerStatusToken: string,
  invalidate: () => void,
): Promise<ReserveOutcome> {
  try {
    const result = await confirmVenueReservation({
      reservationDraftId,
      buyerStatusToken,
    });
    if (result.status === "completed") {
      invalidate();
      return { outcome: "succeeded", reservationId: result.reservationId };
    }
    // pending → the charge is verified-soon; surface a soft message (the row
    // will appear via refetch-on-focus). failed → terminal.
    return {
      outcome: "failed",
      message:
        result.status === "pending"
          ? "We're confirming your payment. Your reservation will appear shortly."
          : "Your payment didn't go through.",
    };
  } catch (err) {
    return {
      outcome: "failed",
      message: err instanceof Error ? err.message : "Confirmation failed.",
    };
  }
}

/** Bounded-poll finalize (Paystack path — the webhook drives the charge). */
async function finalizeFeePolled(
  reservationDraftId: string,
  buyerStatusToken: string,
  invalidate: () => void,
): Promise<ReserveOutcome> {
  for (let attempt = 0; attempt < PAYSTACK_POLL_MAX_ATTEMPTS; attempt++) {
    try {
      const result = await confirmVenueReservation({
        reservationDraftId,
        buyerStatusToken,
      });
      if (result.status === "completed") {
        invalidate();
        return { outcome: "succeeded", reservationId: result.reservationId };
      }
      if (result.status === "failed") {
        return { outcome: "failed", message: "Your payment didn't go through." };
      }
    } catch {
      // transient — keep polling within the budget.
    }
    await new Promise((r) => setTimeout(r, PAYSTACK_POLL_INTERVAL_MS));
  }
  return {
    outcome: "failed",
    message:
      "We couldn't confirm your payment yet. If you completed it, your reservation will appear shortly.",
  };
}
