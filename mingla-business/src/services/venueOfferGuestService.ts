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
import {
  parseGuestChangeSummary,
  parsePackageOfferDetail,
  parsePackageQuote,
  type GuestChangeSummary,
  type PackageOfferDetail,
  type PackageQuote,
} from "@mingla/brand-rendering/venueOffers/packageModel";

import {
  parseHireDayRows,
  parseHireHourDay,
  parseHireOfferDetail,
  parseHirePlaces,
  parseHireQuote,
  type HireDayRow,
  type HireHourDay,
  type HireOfferDetail,
  type HirePlaceOption,
  type HireQuote,
} from "@mingla/brand-rendering/venueOffers/hireModel";

import { supabase } from "./supabase";
import { VenueOfferGuestError, invoke, textClaimLink } from "./venueOfferGuestInvoke";

/** #4490 P4 — a space's public photos and its outline on the venue's site plan. */
export interface HireSpaceMedia {
  id: string;
  photoUrls: string[];
  planShape: { x: number; y: number; w: number; h: number } | null;
}

// #4490 — the error and the edge call live in a leaf (venueOfferGuestInvoke.ts)
// so the claim card can text a link without loading every guest offer model.
export { VenueOfferGuestError } from "./venueOfferGuestInvoke";

export interface EntryPaymentRedirect {
  kind: "requires_redirect";
  authorizationUrl: string;
  amountMinor: number;
  currencyCode: string;
}

export const venueOfferGuestService = {
  /** #4490 P4 — a private hire's public detail (places, price rows, sessions, deposits). */
  async hireOffer(input: { brandSlug: string; venueSlug: string; offeringId: string }): Promise<HireOfferDetail> {
    const parsed = parseHireOfferDetail(await invoke({ action: "offer", ...input }));
    if (parsed === null) throw new VenueOfferGuestError("offer_not_found", 404);
    return parsed;
  },

  /** #4490 P4 — one row per hire session window (free / on hold / taken / closed …). */
  async hireDays(input: { offeringId: string; from: string; to: string; guests: number | null }): Promise<HireDayRow[]> {
    return parseHireDayRows(
      await invoke({
        action: "availability",
        offeringId: input.offeringId,
        from: input.from,
        to: input.to,
        ...(input.guests !== null ? { guests: input.guests } : {}),
      }),
    );
  },

  /** #4490 P4 — the places for one session, each with its status for this group. */
  async hireOptions(input: { offeringId: string; windowId: string; guests: number | null }): Promise<HirePlaceOption[]> {
    return parseHirePlaces(
      await invoke({
        action: "hire_options",
        offeringId: input.offeringId,
        windowId: input.windowId,
        ...(input.guests !== null ? { guests: input.guests } : {}),
      }),
    );
  },

  /** #4490 P4 — a hire quote: one place, the group, extra hours and the answers. */
  async hireQuote(input: {
    offeringId: string;
    windowId: string;
    /** "Hours you set": the start and length replace the window (the server makes its own). */
    startsAt?: string;
    minutes?: number;
    priceOptionId: string;
    guests: number;
    layout: import("@mingla/brand-rendering/venueOffers/layoutModel").VenueLayout | null;
    overtimeHours: number;
    extras: Array<{ id: string }>;
    answers: Record<string, string | boolean>;
    cartKey: string;
    idempotencyKey: string;
  }): Promise<HireQuote> {
    const parsed = parseHireQuote(
      await invoke({
        action: "quote",
        offeringId: input.offeringId,
        ...(input.startsAt !== undefined && input.minutes !== undefined
          ? { startsAt: input.startsAt, minutes: input.minutes }
          : { windowId: input.windowId }),
        lines: [
          {
            priceOptionId: input.priceOptionId,
            guests: input.guests,
            ...(input.layout !== null ? { layout: input.layout } : {}),
            ...(input.overtimeHours > 0 ? { overtimeHours: input.overtimeHours } : {}),
          },
        ],
        extras: input.extras,
        answers: input.answers,
        cartKey: input.cartKey,
        idempotencyKey: input.idempotencyKey,
      }),
    );
    if (parsed === null) throw new VenueOfferGuestError("offer_request_failed", null);
    return parsed;
  },

  /** #4490 P4 follow-up — a hire's "Hours you set" day: opening hours, start times, places and when each is busy. */
  async hireHourDay(input: { offeringId: string; date: string; guests: number | null }): Promise<HireHourDay | null> {
    return parseHireHourDay(
      await invoke({
        action: "hour_day",
        offeringId: input.offeringId,
        date: input.date,
        ...(input.guests !== null ? { guests: input.guests } : {}),
      }),
    );
  },

  /** #4490 P5 — a by-the-hour day line: the hour day plus its price per hour. */
  async hourDay(input: { offeringId: string; date: string; guests: number | null }): Promise<{ day: HireHourDay; priceMinor: number | null } | null> {
    const raw = await invoke({
      action: "hour_day",
      offeringId: input.offeringId,
      date: input.date,
      ...(input.guests !== null ? { guests: input.guests } : {}),
    });
    const day = parseHireHourDay(raw);
    if (day === null) return null;
    const price = raw !== null && typeof raw === "object" ? (raw as { priceMinor?: unknown }).priceMinor : null;
    return { day, priceMinor: typeof price === "number" && Number.isFinite(price) ? price : null };
  },

  /** #4490 P5 — quote a by-the-hour booking by its start and length (the server makes its window). */
  async hourQuote(input: {
    offeringId: string;
    startsAt: string;
    minutes: number;
    guests: number;
    priceOptionId: string | null;
    cartKey: string;
    idempotencyKey: string;
    /** #4490 P6 — price it for a member (their included hours first, then the member price). */
    membership?: { subscriptionId: string; token: string | null; useCredits?: boolean } | null;
  }): Promise<{ quote: EntryQuote; placeName: string | null; hoursMinor: number | null; pricePerHourMinor: number | null; raw: unknown }> {
    const raw = await invoke({
      action: "quote",
      offeringId: input.offeringId,
      startsAt: input.startsAt,
      minutes: input.minutes,
      lines: [{ guests: input.guests, ...(input.priceOptionId !== null ? { priceOptionId: input.priceOptionId } : {}) }],
      extras: [],
      cartKey: input.cartKey,
      idempotencyKey: input.idempotencyKey,
      ...(input.membership !== undefined && input.membership !== null
        ? {
            membership: {
              subscriptionId: input.membership.subscriptionId,
              ...(input.membership.token !== null ? { token: input.membership.token } : {}),
              useCredits: input.membership.useCredits !== false,
            },
          }
        : {}),
    });
    const quote = parseEntryQuote(raw);
    if (quote === null) throw new VenueOfferGuestError("offer_request_failed", null);
    const hour = raw !== null && typeof raw === "object" ? (raw as { hour?: Record<string, unknown> }).hour ?? null : null;
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return {
      quote,
      placeName: hour !== null && typeof hour.placeName === "string" ? hour.placeName : null,
      hoursMinor: hour !== null ? num(hour.hoursMinor) : null,
      pricePerHourMinor: hour !== null ? num(hour.pricePerHourMinor) : null,
      raw,
    };
  },

  /** #4490 P4 — the guest withdraws a request (or an approved hold not yet paid). */
  async withdraw(input: { groupId: string; token: string | null }): Promise<void> {
    await invoke({ action: "withdraw", groupId: input.groupId, ...(input.token ? { token: input.token } : {}) });
  },

  /** #4490 P4 — the spaces' photos and site-plan outlines from the public page read (anon). */
  async hireSpaceMedia(input: { brandSlug: string; venueSlug: string }): Promise<HireSpaceMedia[]> {
    const { data, error } = await supabase.rpc("pg_public_venue_page", {
      p_brand_slug: input.brandSlug,
      p_venue_slug: input.venueSlug,
    });
    if (error !== null) throw new VenueOfferGuestError("offer_request_failed", null);
    const spaces = data !== null && typeof data === "object" && Array.isArray((data as { spaces?: unknown }).spaces)
      ? ((data as { spaces: unknown[] }).spaces)
      : [];
    const out: HireSpaceMedia[] = [];
    for (const raw of spaces) {
      if (raw === null || typeof raw !== "object") continue;
      const s = raw as Record<string, unknown>;
      if (typeof s.id !== "string") continue;
      const plan = s.planShape !== null && typeof s.planShape === "object" ? (s.planShape as Record<string, unknown>) : null;
      const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
      const shape =
        plan !== null && n(plan.x) !== null && n(plan.y) !== null && n(plan.w) !== null && n(plan.h) !== null
          ? { x: n(plan.x) as number, y: n(plan.y) as number, w: n(plan.w) as number, h: n(plan.h) as number }
          : null;
      out.push({
        id: s.id,
        photoUrls: Array.isArray(s.photoUrls) ? s.photoUrls.filter((u): u is string => typeof u === "string" && u.length > 0) : [],
        planShape: shape,
      });
    }
    return out;
  },

  async offer(input: {
    brandSlug: string;
    venueSlug: string;
    offeringId: string;
  }): Promise<EntryOfferDetail> {
    const parsed = parseEntryOfferDetail(await invoke({ action: "offer", ...input }));
    if (parsed === null) throw new VenueOfferGuestError("offer_not_found", 404);
    return parsed;
  },

  /** #4490 P3 — a group package's public detail (inclusions, extras, deposit, start times). */
  async packageOffer(input: { brandSlug: string; venueSlug: string; offeringId: string }): Promise<PackageOfferDetail> {
    const parsed = parsePackageOfferDetail(await invoke({ action: "offer", ...input }));
    if (parsed === null) throw new VenueOfferGuestError("offer_not_found", 404);
    return parsed;
  },

  /** #4490 P3 — a package quote: one line, extras, answers and the pay plan. */
  async packageQuote(input: {
    offeringId: string;
    windowId: string;
    lines: Array<{ priceOptionId: string; guests: number }>;
    extras: Array<{ id: string; qty?: number }>;
    answers: Record<string, string>;
    cartKey: string;
    idempotencyKey: string;
  }): Promise<PackageQuote> {
    const parsed = parsePackageQuote(await invoke({ action: "quote", ...input }));
    if (parsed === null) throw new VenueOfferGuestError("offer_request_failed", null);
    return parsed;
  },

  /** #4490 P3 — what a change costs before the guest confirms it. */
  async changePreview(input: {
    groupId: string;
    token: string | null;
    change: "change_guests" | "move_date" | "add_extras";
    payload: Record<string, unknown>;
  }): Promise<GuestChangeSummary> {
    const parsed = parseGuestChangeSummary(
      await invoke({
        action: "change_preview",
        groupId: input.groupId,
        ...(input.token ? { token: input.token } : {}),
        change: input.change,
        payload: input.payload,
      }),
    );
    if (parsed === null) throw new VenueOfferGuestError("offer_request_failed", null);
    return parsed;
  },

  async change(input: {
    groupId: string;
    token: string | null;
    change: "change_guests" | "move_date" | "add_extras";
    payload: Record<string, unknown>;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<GuestChangeSummary> {
    const parsed = parseGuestChangeSummary(
      await invoke({
        action: "change",
        groupId: input.groupId,
        ...(input.token ? { token: input.token } : {}),
        change: input.change,
        payload: input.payload,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
      }),
    );
    if (parsed === null) throw new VenueOfferGuestError("offer_request_failed", null);
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

  /** #4490 P6 — an entry quote at the member's price (their free entry and guest passes first). */
  async memberQuote(input: {
    offeringId: string;
    windowId: string;
    lines: Array<{ priceOptionId: string; guests: number }>;
    cartKey: string;
    idempotencyKey: string;
    membership: { subscriptionId: string; token: string | null };
  }): Promise<{ quote: EntryQuote; raw: unknown }> {
    const { membership, ...rest } = input;
    const raw = await invoke({
      action: "quote",
      ...rest,
      membership: { subscriptionId: membership.subscriptionId, ...(membership.token !== null ? { token: membership.token } : {}), useCredits: true },
    });
    const parsed = parseEntryQuote(raw);
    if (parsed === null) throw new VenueOfferGuestError("offer_request_failed", null);
    return { quote: parsed, raw };
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
    /** #4490 P3 — "deposit" pays the deposit now; omitted = the full amount (or the balance once confirmed). */
    payMode?: "deposit" | "full";
  }): Promise<EntryPaymentRedirect> {
    const raw = (await invoke({
      action: "pay",
      groupId: input.groupId,
      ...(input.token ? { token: input.token } : {}),
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      ...(input.payMode !== undefined ? { payMode: input.payMode } : {}),
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
  }): Promise<{
    outcome: "confirmed" | "pending" | "failed" | "not_paid" | "nothing_to_confirm";
    booking: EntryBooking | null;
    raw: unknown;
  }> {
    const raw = (await invoke({
      action: "confirm_return",
      groupId: input.groupId,
      ...(input.token ? { token: input.token } : {}),
    })) as Record<string, unknown>;
    const outcome = raw?.outcome;
    return {
      outcome:
        outcome === "confirmed" || outcome === "pending" || outcome === "failed" || outcome === "not_paid"
          ? outcome
          : "nothing_to_confirm",
      booking: parseEntryBooking(raw?.booking),
      raw: raw?.booking ?? null,
    };
  },

  /** #4490 Explorer W1: re-send the app link by text to the phone on the booking (at most 3). */
  async textClaimLink(input: { groupId: string; token: string | null }): Promise<{ remaining: number; phoneLast4: string | null }> {
    return textClaimLink(input);
  },

  async get(input: { groupId: string; token: string | null }): Promise<EntryBooking> {
    return (await venueOfferGuestService.getWithRaw(input)).booking;
  },

  /** The booking and its raw read (the P3 money and change fields are parsed by the caller). */
  async getWithRaw(input: { groupId: string; token: string | null }): Promise<{ booking: EntryBooking; raw: unknown }> {
    const raw = await invoke({
      action: "get",
      groupId: input.groupId,
      ...(input.token ? { token: input.token } : {}),
    });
    const booking = parseEntryBooking(raw);
    if (booking === null) throw new VenueOfferGuestError("offer_booking_not_found", 404);
    return { booking, raw };
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
