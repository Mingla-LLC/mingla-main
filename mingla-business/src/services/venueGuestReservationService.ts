import type { AvailableSlot } from "../types/venueReservation";
import { supabase } from "./supabase";

async function extractFunctionError(
  error: unknown,
  fallback: string,
): Promise<string> {
  if (error === null || typeof error !== "object") return fallback;
  const context = (error as { context?: unknown }).context;
  if (
    context !== null &&
    typeof context === "object" &&
    typeof (context as { text?: unknown }).text === "function"
  ) {
    try {
      const raw = await (context as { text: () => Promise<string> }).text();
      try {
        const parsed = JSON.parse(raw) as {
          error?: unknown;
          message?: unknown;
        };
        if (typeof parsed.error === "string") return parsed.error;
        if (typeof parsed.message === "string") return parsed.message;
      } catch {
        if (raw.length > 0 && raw.length < 200 && !raw.startsWith("<!")) {
          return raw;
        }
      }
    } catch {
      return fallback;
    }
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" &&
    message.length > 0 &&
    !message.startsWith("Edge Function returned")
    ? message
    : fallback;
}

export interface GuestReservationBuyer {
  name: string;
  email: string;
  phone: string;
  marketingOptIn: boolean;
}

export interface GuestReservationInput {
  venueId: string;
  brandId: string;
  reservedForUtc: string;
  partySize: number;
  buyer: GuestReservationBuyer;
  occasion?: string | null;
  guestNotes?: string | null;
  attributionClickId?: string | null;
}

export type GuestReservationResult =
  | {
      kind: "free_completed";
      reservationId: string;
      reservedForUtc: string;
      partySize: number;
      brandId: string;
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
        },
      },
    );
  if (error !== null) {
    throw new Error(
      await extractFunctionError(
        error,
        "We couldn’t start your reservation. Check your details and try again.",
      ),
    );
  }
  if (data === null)
    throw new Error("The reservation service returned no result.");
  return data;
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
      await extractFunctionError(
        error,
        "We couldn’t confirm the payment yet. Try again in a moment.",
      ),
    );
  }
  if (data === null)
    throw new Error("The confirmation service returned no result.");
  return data;
}
