/**
 * #4490 P2 — the guest's calls to the `venue-offers` edge function (buying
 * entry with or without an account).
 *
 * Anonymous by design: buyer web never asks for sign-in to buy. A signed-out
 * browser sends only the project key; the function then identifies the guest
 * by the browser's cart key (quote, hold) and afterwards by the booking token
 * `hold` returns once (pay, read, confirm on return, cancel). A signed-in
 * visitor's session is sent automatically and the function uses it instead.
 *
 * Every failure is thrown as `VenueOfferGuestError` carrying the server's code
 * (never shown raw: `venueOfferErrorCopy` turns it into words).
 */
import {
  parseEntryBooking,
  parseEntryCancelPreview,
  parseEntryDayRows,
  parseEntryOfferDetail,
  parseEntryQuote,
  type EntryBooking,
  type EntryCancelPreview,
  type EntryDayRow,
  type EntryOfferDetail,
  type EntryQuote,
} from "@mingla/brand-rendering/venueOffers/entryModel";

import { supabase } from "./supabase";

export class VenueOfferGuestError extends Error {
  readonly code: string;
  readonly remaining: number | null;
  readonly status: number | null;
  constructor(code: string, status: number | null, remaining: number | null = null) {
    super(code);
    this.name = "VenueOfferGuestError";
    this.code = code;
    this.status = status;
    this.remaining = remaining;
  }
}

async function invoke(body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("venue-offers", { body });
  if (error) {
    const response = (error as { context?: unknown }).context as Response | undefined;
    if (response && typeof response.json === "function") {
      const parsed = (await response.json().catch(() => ({}))) as {
        code?: unknown;
        remaining?: unknown;
      };
      throw new VenueOfferGuestError(
        typeof parsed.code === "string" ? parsed.code : "offer_request_failed",
        typeof response.status === "number" ? response.status : null,
        typeof parsed.remaining === "number" ? parsed.remaining : null,
      );
    }
    throw new VenueOfferGuestError("offer_request_failed", null);
  }
  if (!data || typeof data !== "object" || (data as { kind?: unknown }).kind !== "success") {
    throw new VenueOfferGuestError("offer_request_failed", null);
  }
  return (data as { data: unknown }).data;
}

export interface EntryPaymentRedirect {
  kind: "requires_redirect";
  authorizationUrl: string;
  amountMinor: number;
  currencyCode: string;
}

export const venueOfferGuestService = {
  async offer(input: {
    brandSlug: string;
    venueSlug: string;
    offeringId: string;
  }): Promise<EntryOfferDetail> {
    const parsed = parseEntryOfferDetail(await invoke({ action: "offer", ...input }));
    if (parsed === null) throw new VenueOfferGuestError("offer_not_found", 404);
    return parsed;
  },

  async availability(input: {
    offeringId: string;
    from: string;
    to: string;
    priceOptionId?: string | null;
  }): Promise<EntryDayRow[]> {
    return parseEntryDayRows(
      await invoke({
        action: "availability",
        offeringId: input.offeringId,
        from: input.from,
        to: input.to,
        ...(input.priceOptionId ? { priceOptionId: input.priceOptionId } : {}),
      }),
    );
  },

  async quote(input: {
    offeringId: string;
    windowId: string;
    lines: Array<{ priceOptionId: string; guests: number }>;
    cartKey: string;
    idempotencyKey: string;
  }): Promise<EntryQuote> {
    const parsed = parseEntryQuote(await invoke({ action: "quote", ...input }));
    if (parsed === null) throw new VenueOfferGuestError("offer_request_failed", null);
    return parsed;
  },

  async hold(input: {
    quoteId: string;
    guest: { name: string; email: string; phone?: string; phoneCountryIso?: string };
    cartKey: string;
    idempotencyKey: string;
  }): Promise<{ booking: EntryBooking; bookingToken: string | null }> {
    const raw = (await invoke({ action: "hold", ...input })) as Record<string, unknown>;
    const booking = parseEntryBooking(raw);
    if (booking === null) throw new VenueOfferGuestError("offer_request_failed", null);
    return {
      booking,
      bookingToken: typeof raw?.bookingToken === "string" ? raw.bookingToken : null,
    };
  },

  async pay(input: {
    groupId: string;
    token: string | null;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<EntryPaymentRedirect> {
    const raw = (await invoke({
      action: "pay",
      groupId: input.groupId,
      ...(input.token ? { token: input.token } : {}),
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
    })) as Record<string, unknown>;
    if (raw?.kind === "requires_redirect" && typeof raw.authorizationUrl === "string") {
      return {
        kind: "requires_redirect",
        authorizationUrl: raw.authorizationUrl,
        amountMinor: Number(raw.amountMinor ?? 0),
        currencyCode: String(raw.currencyCode ?? ""),
      };
    }
    // Card-on-page brands (a different provider) are not wired for venue
    // offers in this release: say so plainly instead of a dead button.
    throw new VenueOfferGuestError("offer_payment_unavailable", null);
  },

  async confirmReturn(input: {
    groupId: string;
    token: string | null;
  }): Promise<{ outcome: "confirmed" | "pending" | "failed" | "nothing_to_confirm"; booking: EntryBooking | null }> {
    const raw = (await invoke({
      action: "confirm_return",
      groupId: input.groupId,
      ...(input.token ? { token: input.token } : {}),
    })) as Record<string, unknown>;
    const outcome = raw?.outcome;
    return {
      outcome:
        outcome === "confirmed" || outcome === "pending" || outcome === "failed"
          ? outcome
          : "nothing_to_confirm",
      booking: parseEntryBooking(raw?.booking),
    };
  },

  async get(input: { groupId: string; token: string | null }): Promise<EntryBooking> {
    const booking = parseEntryBooking(
      await invoke({
        action: "get",
        groupId: input.groupId,
        ...(input.token ? { token: input.token } : {}),
      }),
    );
    if (booking === null) throw new VenueOfferGuestError("offer_booking_not_found", 404);
    return booking;
  },

  async cancelPreview(input: { groupId: string; token: string | null }): Promise<EntryCancelPreview> {
    const preview = parseEntryCancelPreview(
      await invoke({
        action: "cancel_preview",
        groupId: input.groupId,
        ...(input.token ? { token: input.token } : {}),
      }),
    );
    if (preview === null) throw new VenueOfferGuestError("offer_request_failed", null);
    return preview;
  },

  async cancel(input: {
    groupId: string;
    token: string | null;
    previewIds: string[];
    previewHash: string;
    idempotencyKey: string;
  }): Promise<{ refundMinor: number }> {
    const raw = (await invoke({
      action: "cancel",
      groupId: input.groupId,
      ...(input.token ? { token: input.token } : {}),
      previewIds: input.previewIds,
      previewHash: input.previewHash,
      idempotencyKey: input.idempotencyKey,
    })) as Record<string, unknown>;
    return { refundMinor: Number(raw?.refundMinor ?? 0) };
  },
};
