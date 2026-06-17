/**
 * venueReservationService — META-ORCH-1148 sub-ORCH 2.2b [consumer reserve].
 * ---------------------------------------------------------------------------
 * The consumer-app client of the SHIPPED 2.2a guest-booking backend. Mirrors
 * the consumer ticket service + nativeCheckoutFlow consumption (SPEC §4.C):
 *
 *   createVenueReservation(input) → invokes `venue-reservation-create` with
 *     surface:"native". Returns the response UNION (the success discriminator is
 *     `kind`, NOT thrown). Transport / edge errors throw with a friendly message.
 *
 *   confirmVenueReservation({ reservationDraftId, buyerStatusToken }) → invokes
 *     `venue-reservation-confirm` (the fee finalize, after the native
 *     PaymentSheet succeeds). Returns { status, reservationId, ... }.
 *
 * It NEVER computes fee/tax — the server (the shared all-in engine) owns the
 * money math; this just relays the all-in totals the server returns (WYSIWYP).
 * The app user is ALWAYS signed in (root-gated), so the bearer token carried by
 * supabase.functions.invoke attaches the reservation to the signed-in user
 * (created_via='consumer'); we never build a sign-in step here (2.2b locked).
 */

import { supabase } from "./supabase";
import { extractFunctionError } from "../utils/edgeFunctionError";

export interface VenueReservationBuyer {
  name: string;
  email: string;
  phone: string;
  marketingOptIn?: boolean;
}

export interface CreateVenueReservationInput {
  brandId: string;
  /** ISO 8601 instant of the chosen slot (UTC). */
  reservedForUtc: string;
  partySize: number;
  buyer: VenueReservationBuyer;
  occasion?: string | null;
  guestNotes?: string | null;
}

/** The all-in pricing breakdown the server returns (display only — WYSIWYP). */
export interface ReservationPricingBreakdown {
  buyer_total_cents: number;
  [key: string]: unknown;
}

/** The `venue-reservation-create` response union (SPEC §4.B). */
export type CreateVenueReservationResult =
  | {
      kind: "free_completed";
      reservationId: string;
      reservedForUtc: string;
      partySize: number;
      brandId: string;
      guestCancelToken?: string;
      receiptUrl?: string;
    }
  | {
      kind: "requires_payment";
      reservationDraftId: string;
      buyerStatusToken: string;
      totalCents: number;
      currency: string;
      clientSecret: string;
      paymentIntentId: string;
      pricingBreakdown: ReservationPricingBreakdown;
      publishableKey: string | null;
      stripeAccountId: string;
      customerId: string | null;
      customerEphemeralKeySecret: string | null;
      guestCancelToken?: string;
    }
  // A native client should never receive a web-redirect; surfaced so the caller
  // can fail cleanly (server/client mismatch).
  | {
      kind: "requires_web_redirect";
      reservationDraftId: string;
      buyerStatusToken: string;
      hostedCheckoutUrl: string | null;
      totalCents: number;
      currency: string;
      guestCancelToken?: string;
    }
  // META-ORCH-1076 — NG brands route through Paystack's hosted checkout. Falls
  // out of the shared reuse; the consumer reserve flow opens it in an in-app
  // browser then confirms via venue-reservation-confirm (the webhook is truth).
  | {
      kind: "requires_paystack_redirect";
      reservationDraftId: string;
      buyerStatusToken: string;
      authorizationUrl: string;
      reference: string;
      totalCents: number;
      currency: string;
      guestCancelToken?: string;
    };

export interface ConfirmVenueReservationInput {
  reservationDraftId: string;
  buyerStatusToken: string;
}

export type ConfirmVenueReservationResult =
  | {
      status: "completed";
      reservationId: string;
      reservedForUtc?: string;
      partySize?: number;
      brandId?: string;
      guestCancelToken?: string;
      receiptUrl?: string;
    }
  | { status: "pending"; reservationId: null }
  | { status: "failed"; reservationId: null };

/**
 * Create a venue reservation on the SIGNED-IN user's behalf (native surface).
 * The success discriminator is `kind`; transport/edge errors throw.
 */
export async function createVenueReservation(
  input: CreateVenueReservationInput,
): Promise<CreateVenueReservationResult> {
  const { data, error } = await supabase.functions.invoke<CreateVenueReservationResult>(
    "venue-reservation-create",
    {
      body: {
        brandId: input.brandId,
        surface: "native",
        reservedForUtc: input.reservedForUtc,
        partySize: input.partySize,
        buyer: {
          name: input.buyer.name,
          email: input.buyer.email,
          phone: input.buyer.phone,
          marketingOptIn: input.buyer.marketingOptIn === true,
        },
        ...(input.occasion ? { occasion: input.occasion } : {}),
        ...(input.guestNotes ? { guestNotes: input.guestNotes } : {}),
      },
    },
  );

  if (error) {
    const message = await extractFunctionError(
      error,
      "Couldn't start your reservation. Tap to try again.",
    );
    throw new Error(message);
  }
  if (!data) {
    throw new Error("Empty reservation response from server.");
  }
  return data;
}

/**
 * Finalize a FEE reservation after the native PaymentSheet succeeds. Idempotent
 * server-side (the 2.2a DEFECT-1 fix). Returns the completed/pending/failed
 * status; transport/edge errors throw.
 */
export async function confirmVenueReservation(
  input: ConfirmVenueReservationInput,
): Promise<ConfirmVenueReservationResult> {
  const { data, error } = await supabase.functions.invoke<ConfirmVenueReservationResult>(
    "venue-reservation-confirm",
    {
      body: {
        reservationDraftId: input.reservationDraftId,
        buyerStatusToken: input.buyerStatusToken,
      },
    },
  );
  if (error) {
    const message = await extractFunctionError(
      error,
      "We couldn't confirm your reservation. If you were charged, it will appear shortly.",
    );
    throw new Error(message);
  }
  if (!data) {
    throw new Error("Empty confirmation response from server.");
  }
  return data;
}
