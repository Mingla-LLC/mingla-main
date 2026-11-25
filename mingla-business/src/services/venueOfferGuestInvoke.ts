/**
 * #4490 — the guest's `venue-offers` edge call and its refusal type, a leaf
 * split from venueOfferGuestService (every failure is a VenueOfferGuestError
 * carrying the server's code, never shown raw). Small on purpose: the venue
 * claim card ("Text me the link") uses it on pages that load no offer models.
 */
import { supabase } from "./supabase";

export class VenueOfferGuestError extends Error {
  readonly code: string;
  readonly remaining: number | null;
  readonly status: number | null;
  readonly detail: { placeName?: string; capacity?: number; layout?: string } | null;
  constructor(
    code: string,
    status: number | null,
    remaining: number | null = null,
    detail: { placeName?: string; capacity?: number; layout?: string } | null = null,
  ) {
    super(code);
    this.name = "VenueOfferGuestError";
    this.code = code;
    this.status = status;
    this.remaining = remaining;
    this.detail = detail;
  }
}

export async function invoke(body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("venue-offers", { body });
  if (error) {
    const response = (error as { context?: unknown }).context as Response | undefined;
    if (response && typeof response.json === "function") {
      const parsed = (await response.json().catch(() => ({}))) as {
        code?: unknown;
        remaining?: unknown;
        detail?: unknown;
      };
      const detail = parsed.detail !== null && typeof parsed.detail === "object"
        ? parsed.detail as { placeName?: string; capacity?: number; layout?: string }
        : null;
      throw new VenueOfferGuestError(
        typeof parsed.code === "string" ? parsed.code : "offer_request_failed",
        typeof response.status === "number" ? response.status : null,
        typeof parsed.remaining === "number" ? parsed.remaining : null,
        detail,
      );
    }
    throw new VenueOfferGuestError("offer_request_failed", null);
  }
  if (!data || typeof data !== "object" || (data as { kind?: unknown }).kind !== "success") {
    throw new VenueOfferGuestError("offer_request_failed", null);
  }
  return (data as { data: unknown }).data;
}

/** "Text me the link": re-send the booking's app link by text (desktop web). */
export async function textClaimLink(input: { groupId: string; token: string | null }): Promise<{ remaining: number; phoneLast4: string | null }> {
  const raw = (await invoke({
    action: "text_claim_link",
    groupId: input.groupId,
    ...(input.token ? { token: input.token } : {}),
  })) as Record<string, unknown> | null;
  return {
    remaining: typeof raw?.remaining === "number" ? raw.remaining : 0,
    phoneLast4: typeof raw?.phoneLast4 === "string" ? raw.phoneLast4 : null,
  };
}
