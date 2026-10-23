import type {
  GuestReservationInput,
  GuestReservationPreview,
} from "./venueGuestReservationTypes";
import { supabase } from "./supabase";

export async function extractFunctionError(
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

export async function readGuestReservationReviewQuote(
  error: unknown,
): Promise<GuestReservationPreview | null> {
  const context = (error as { context?: unknown }).context;
  if (
    context === null ||
    typeof context !== "object" ||
    typeof (context as { clone?: unknown }).clone !== "function"
  ) {
    return null;
  }
  try {
    const raw = await (
      context as { clone: () => { text: () => Promise<string> } }
    )
      .clone()
      .text();
    const payload = JSON.parse(raw) as { error?: unknown; quote?: unknown };
    return payload.error === "checkout_review_required" &&
      payload.quote !== null &&
      typeof payload.quote === "object"
      ? (payload.quote as GuestReservationPreview)
      : null;
  } catch {
    return null;
  }
}

export async function previewGuestVenueReservation(
  input: GuestReservationInput,
): Promise<GuestReservationPreview> {
  const { data, error } =
    await supabase.functions.invoke<GuestReservationPreview>(
      "venue-reservation-create",
      {
        body: {
          venueId: input.venueId,
          brandId: input.brandId,
          surface: "web",
          mode: "preview",
          reservedForUtc: input.reservedForUtc,
          partySize: input.partySize,
          buyer: input.buyer,
          occasion: input.occasion ?? null,
          guestNotes: input.guestNotes ?? null,
          discountCode: input.discountCode ?? null,
        },
      },
    );
  if (error !== null) {
    throw new Error(
      await extractFunctionError(
        error,
        "We couldn’t get the reservation price. Try again.",
      ),
    );
  }
  if (data === null) {
    throw new Error("The reservation service returned no price.");
  }
  return data;
}
