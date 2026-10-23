import type { AvailableSlot } from "../types/venueReservation";
import type { GuestManageReservation } from "../utils/guestReservationManage";
import {
  getStoredAdMatchData,
  identifyAdBuyer,
} from "../analytics/webAnalytics";
import { supabase } from "./supabase";
import type {
  GuestReservationBuyer as GuestReservationBuyerContract,
  GuestReservationInput,
  GuestReservationPreview,
} from "./venueGuestReservationTypes";
export type {
  GuestReservationInput,
  GuestReservationPreview,
} from "./venueGuestReservationTypes";

export interface GuestReservationBuyer extends GuestReservationBuyerContract {
  phoneCountryIso?: string | null;
}

export class GuestReservationReviewError extends Error {
  readonly quote: GuestReservationPreview;

  constructor(quote: GuestReservationPreview) {
    super("checkout_review_required");
    this.name = "GuestReservationReviewError";
    this.quote = quote;
  }
}

export type GuestReservationResult =
  | {
      kind: "free_completed";
      reservationId: string;
      reservedForUtc: string;
      partySize: number;
      brandId: string;
      /**
       * #3392 — the private manage/cancel credential for a web booking. The
       * server stores only its hash, so this response is the one place it exists.
       */
      guestCancelToken?: string;
    }
  | {
      kind: "requires_web_redirect";
      reservationDraftId: string;
      buyerStatusToken: string;
      hostedCheckoutUrl: string | null;
      totalCents: number;
      currency: string;
    }
  | {
      kind: "requires_paystack_redirect";
      reservationDraftId: string;
      buyerStatusToken: string;
      authorizationUrl: string;
      totalCents: number;
      currency: string;
    };

export interface GuestReservationConfirmResult {
  status: "completed" | "pending" | "failed";
  reservationId: string | null;
  guestCancelToken?: string;
}

export interface GuestVenueRefundSummary {
  refund_id: string;
  buyer_state: string;
  fee_state: string;
  financial_state: string;
  amount_cents: number;
  currency: string;
  updated_at: string;
  attentionDeliveryState?: "parked" | "recovery_required" | null;
  attentionRecoveryCode?:
    "delivery_acceptance_unknown" | "delivery_undelivered" | null;
}

export async function fetchGuestVenueRefund(input: {
  reservationId: string;
  guestToken: string;
}): Promise<GuestVenueRefundSummary | null> {
  const { data, error } = await supabase.functions.invoke(
    "venue-reservation-refund-status",
    { body: input },
  );
  if (error) throw error;
  return (data?.refund ?? null) as GuestVenueRefundSummary | null;
}

/**
 * #3392 — the booking AND its refund for a guest's manage link. The refund
 * alone could not open a booking that had no refund (every free booking).
 */
export async function fetchGuestReservationManage(input: {
  reservationId: string;
  guestToken: string;
}): Promise<{
  reservation: GuestManageReservation | null;
  refund: GuestVenueRefundSummary | null;
}> {
  const { data, error } = await supabase.functions.invoke(
    "venue-reservation-refund-status",
    { body: input },
  );
  if (error) throw error;
  return {
    reservation: (data?.reservation ?? null) as GuestManageReservation | null,
    refund: (data?.refund ?? null) as GuestVenueRefundSummary | null,
  };
}

export async function cancelGuestVenueReservation(input: {
  reservationId: string;
  guestToken: string;
}): Promise<{ refund: GuestVenueRefundSummary | null }> {
  const { data, error } = await supabase.functions.invoke(
    "venue-reservation-cancel",
    { body: input },
  );
  if (error) throw error;
  return { refund: (data?.refund ?? null) as GuestVenueRefundSummary | null };
}

export async function submitGuestRefundAttention(input: {
  refundId: string;
  attentionToken: string;
  accountNumber: string;
  bankId: string;
}): Promise<{ state: string }> {
  const { data, error } = await supabase.functions.invoke(
    "source-refund-attention",
    {
      body: {
        mode: "submit_paystack_details",
        currency: "NGN",
        ...input,
      },
    },
  );
  if (error) throw error;
  return data as { state: string };
}

export async function fetchPublicVenueSlots(
  venueId: string,
  date: string,
  partySize: number,
): Promise<AvailableSlot[]> {
  const { data, error } = await supabase.rpc("pg_venue_available_slots", {
    p_venue_id: venueId,
    p_date: date,
    p_party_size: partySize,
  });
  if (error !== null) throw error;
  return (
    (data ?? []) as {
      slot_start_utc: string;
      slot_local_label: string;
      remaining: number | null;
      is_full: boolean;
    }[]
  ).map((row) => ({
    slotStartUtc: row.slot_start_utc,
    slotLocalLabel: row.slot_local_label,
    remaining: row.remaining ?? 0,
    isFull: row.is_full,
  }));
}

export async function createGuestVenueReservation(
  input: GuestReservationInput,
): Promise<GuestReservationResult> {
  const adMatchData = getStoredAdMatchData?.() ?? {
    fbp: null,
    fbc: null,
    scid: null,
    ttp: null,
    clientUserAgent: null,
    trackingOptOut: false,
  };
  void identifyAdBuyer?.({
    email: input.buyer.email,
    phone: input.buyer.phone,
  })?.catch(() => undefined);
  const { data, error } =
    await supabase.functions.invoke<GuestReservationResult>(
      "venue-reservation-create",
      {
        body: {
          venueId: input.venueId,
          brandId: input.brandId,
          surface: "web",
          reservedForUtc: input.reservedForUtc,
          partySize: input.partySize,
          buyer: input.buyer,
          occasion: input.occasion ?? null,
          guestNotes: input.guestNotes ?? null,
          attributionClickId: input.attributionClickId ?? null,
          adMatchData,
          organicJourneyToken: input.organicJourneyToken ?? null,
          discountCode: input.discountCode ?? null,
          quoteDigest: input.quoteDigest ?? null,
        },
      },
    );
  if (error !== null) {
    const quoteService = await import("./venueGuestReservationQuoteService");
    const reviewQuote =
      await quoteService.readGuestReservationReviewQuote(error);
    if (reviewQuote !== null) {
      throw new GuestReservationReviewError(reviewQuote);
    }
    throw new Error(
      await quoteService.extractFunctionError(
        error,
        "We couldn’t start your reservation. Check your details and try again.",
      ),
    );
  }
  if (data === null) {
    throw new Error("The reservation service returned no result.");
  }
  return data;
}

export async function previewGuestVenueReservation(
  input: GuestReservationInput,
): Promise<GuestReservationPreview> {
  return import("./venueGuestReservationQuoteService").then((module) =>
    module.previewGuestVenueReservation(input),
  );
}

export async function confirmGuestVenueReservation(input: {
  reservationDraftId: string;
  buyerStatusToken: string;
}): Promise<GuestReservationConfirmResult> {
  const { data, error } =
    await supabase.functions.invoke<GuestReservationConfirmResult>(
      "venue-reservation-confirm",
      { body: input },
    );
  if (error !== null) {
    throw new Error(
      await import("./venueGuestReservationQuoteService").then((module) =>
        module.extractFunctionError(
          error,
          "We couldn’t confirm the payment yet. Try again in a moment.",
        ),
      ),
    );
  }
  if (data === null) {
    throw new Error("The confirmation service returned no result.");
  }
  return data;
}
