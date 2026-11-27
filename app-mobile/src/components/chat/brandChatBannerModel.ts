/**
 * #4630 — the brand chat banner, as data.
 *
 * Pure and free of React Native imports so Deno runs it directly
 * (__tests__/issue_4630_brand_chat_banner.implementor.test.ts).
 *
 * The banner sits under the brand chat's header and shows exactly one state
 * (spec 4.9): your booking today, your next booking (one or several), the
 * brand's next offering when you hold none, a quiet line when nothing is
 * coming up, or a retry line when the read failed. It is hidden while
 * loading, in a Removed chat, and for a non-member.
 *
 * The data is the server's issue_4630_my_brand_chat_summary (your own
 * bookings with the brand and the brand's public upcoming offerings).
 */

export type BrandChatBookingKind = "order" | "rsvp";

export interface BrandChatBooking {
  kind: BrandChatBookingKind;
  id: string;
  eventId: string;
  eventSlug: string | null;
  offeringType: string | null;
  title: string;
  coverMediaUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string | null;
  ticketCount: number;
}

export interface BrandChatOffering {
  offeringId: string;
  offeringType: string | null;
  offeringSlug: string | null;
  title: string;
  coverMediaUrl: string | null;
  startsAt: string | null;
}

export type BrandChatSummary =
  | { member: false }
  | {
      member: true;
      brandSlug: string | null;
      brandName: string;
      myBookings: BrandChatBooking[];
      hasPastBookings: boolean;
      brandUpcoming: BrandChatOffering[];
    };

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Reads the RPC's jsonb defensively: anything malformed is dropped, never invented. */
export function parseBrandChatSummary(raw: unknown): BrandChatSummary {
  const row = record(raw);
  if (row.member !== true) return { member: false };
  const bookings: BrandChatBooking[] = [];
  for (const item of Array.isArray(row.myBookings) ? row.myBookings : []) {
    const b = record(item);
    const kind = b.kind === "order" || b.kind === "rsvp" ? b.kind : null;
    const id = str(b.id);
    const eventId = str(b.eventId);
    if (!kind || !id || !eventId) continue;
    bookings.push({
      kind,
      id,
      eventId,
      eventSlug: str(b.eventSlug),
      offeringType: str(b.offeringType),
      title: str(b.title) ?? "",
      coverMediaUrl: str(b.coverMediaUrl),
      startsAt: str(b.startsAt),
      endsAt: str(b.endsAt),
      timezone: str(b.timezone),
      ticketCount: typeof b.ticketCount === "number" && Number.isFinite(b.ticketCount) ? b.ticketCount : 0,
    });
  }
  const upcoming: BrandChatOffering[] = [];
  for (const item of Array.isArray(row.brandUpcoming) ? row.brandUpcoming : []) {
    const o = record(item);
    const offeringId = str(o.offeringId);
    if (!offeringId) continue;
    upcoming.push({
      offeringId,
      offeringType: str(o.offeringType),
      offeringSlug: str(o.offeringSlug),
      title: str(o.title) ?? "",
      coverMediaUrl: str(o.coverMediaUrl),
      startsAt: str(o.startsAt),
    });
  }
  return {
    member: true,
    brandSlug: str(row.brandSlug),
    brandName: str(row.brandName) ?? "",
    myBookings: bookings,
    hasPastBookings: row.hasPastBookings === true,
    brandUpcoming: upcoming,
  };
}

// ── States ────────────────────────────────────────────────────────────────

/** What a "Get tickets" / "RSVP" / "Book" control says, by offering type. */
export type BrandChatCta = "tickets" | "rsvp" | "book";

export type BrandChatBannerState =
  | { kind: "hidden" }
  | { kind: "error" }
  | {
      kind: "live_today";
      booking: BrandChatBooking;
      /** Bookings after this one ("+N more"), 0 for none. */
      moreCount: number;
      eventHref: string | null;
      bookingHref: string;
    }
  | {
      kind: "next_with_ticket";
      booking: BrandChatBooking;
      days: number;
      eventHref: string | null;
      bookingHref: string;
    }
  | {
      kind: "multiple_with_ticket";
      booking: BrandChatBooking;
      days: number;
      moreCount: number;
      eventHref: string | null;
      bookingHref: string;
      moreHref: string;
    }
  | {
      kind: "next_no_ticket";
      offering: BrandChatOffering;
      days: number;
      cta: BrandChatCta;
      eventHref: string | null;
    }
  | { kind: "nothing_upcoming"; brandHref: string | null };

export interface BrandChatBannerInput {
  summary: BrandChatSummary | null | undefined;
  now: Date;
  isLoading?: boolean;
  isError?: boolean;
  removed?: boolean;
}

/** "+N more" opens your Purchases (Q5). */
export const BRAND_CHAT_MORE_HREF = "/purchases";

function time(iso: string | null): number | null {
  if (!iso) return null;
  const value = new Date(iso).getTime();
  return Number.isNaN(value) ? null : value;
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole local calendar days from `now` to `iso` (0 = today). */
export function daysUntil(iso: string | null, now: Date): number {
  const at = time(iso);
  if (at === null) return 0;
  return Math.max(0, Math.round((startOfLocalDay(new Date(at)) - startOfLocalDay(now)) / 86400000));
}

/** Not ended: COALESCE(end, start) is now or later (the server's rule, re-checked here). */
export function isBookingUpcoming(booking: BrandChatBooking, now: Date): boolean {
  const end = time(booking.endsAt) ?? time(booking.startsAt);
  return end !== null && end >= now.getTime();
}

/** Starts today (local day) or has started and not ended. */
export function isBookingLiveToday(booking: BrandChatBooking, now: Date): boolean {
  if (!isBookingUpcoming(booking, now)) return false;
  const start = time(booking.startsAt);
  if (start === null) return false;
  return start <= now.getTime() || startOfLocalDay(new Date(start)) === startOfLocalDay(now);
}

export function brandPageHref(brandSlug: string | null): string | null {
  return brandSlug ? `/b/${brandSlug}` : null;
}

export function eventPageHref(brandSlug: string | null, eventSlug: string | null): string | null {
  return brandSlug && eventSlug ? `/e/${brandSlug}/${eventSlug}` : null;
}

export function bookingHref(booking: BrandChatBooking): string {
  return `/purchases/${booking.kind}/${booking.id}`;
}

export function offeringCta(offeringType: string | null): BrandChatCta {
  if (offeringType === "rsvp") return "rsvp";
  if (offeringType === "trip" || offeringType === "experience") return "book";
  return "tickets";
}

/** Exactly one banner state for the chat (spec 4.9). */
export function brandChatBannerState(input: BrandChatBannerInput): BrandChatBannerState {
  if (input.removed) return { kind: "hidden" };
  if (input.isError && !input.summary) return { kind: "error" };
  const summary = input.summary;
  if (input.isLoading || !summary) return { kind: "hidden" };
  if (!summary.member) return { kind: "hidden" };

  const now = input.now;
  const mine = summary.myBookings
    .filter((booking) => isBookingUpcoming(booking, now))
    .sort((a, b) => (time(a.startsAt) ?? 0) - (time(b.startsAt) ?? 0));
  const first = mine[0];
  if (first) {
    const eventHref = eventPageHref(summary.brandSlug, first.eventSlug);
    const moreCount = mine.length - 1;
    if (isBookingLiveToday(first, now)) {
      return { kind: "live_today", booking: first, moreCount, eventHref, bookingHref: bookingHref(first) };
    }
    const days = daysUntil(first.startsAt, now);
    if (moreCount > 0) {
      return {
        kind: "multiple_with_ticket",
        booking: first,
        days,
        moreCount,
        eventHref,
        bookingHref: bookingHref(first),
        moreHref: BRAND_CHAT_MORE_HREF,
      };
    }
    return { kind: "next_with_ticket", booking: first, days, eventHref, bookingHref: bookingHref(first) };
  }

  // brandUpcoming has no end time, so it is never "live today".
  const next = summary.brandUpcoming
    .filter((offering) => (time(offering.startsAt) ?? 0) >= now.getTime())
    .sort((a, b) => (time(a.startsAt) ?? 0) - (time(b.startsAt) ?? 0))[0];
  if (next) {
    return {
      kind: "next_no_ticket",
      offering: next,
      days: daysUntil(next.startsAt, now),
      cta: offeringCta(next.offeringType),
      eventHref: eventPageHref(summary.brandSlug, next.offeringSlug),
    };
  }
  return { kind: "nothing_upcoming", brandHref: brandPageHref(summary.brandSlug) };
}

/** "Sat 6 Dec" in the reader's language. */
export function formatBannerDate(iso: string | null, locale: string | undefined): string {
  const at = time(iso);
  if (at === null) return "";
  try {
    return new Date(at).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  } catch {
    return new Date(at).toDateString();
  }
}

/** "20:00" / "8:00 PM" in the reader's language. */
export function formatBannerTime(iso: string | null, locale: string | undefined): string {
  const at = time(iso);
  if (at === null) return "";
  try {
    return new Date(at).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  } catch {
    return new Date(at).toTimeString().slice(0, 5);
  }
}
