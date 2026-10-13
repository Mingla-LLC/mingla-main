/**
 * issue #3237 — copy for the "just published" banner on the manage screens.
 *
 * Pure (no React Native) so the wording is unit-testable and has one owner.
 * Plain English, no payment-provider names.
 */

export type PublishedBannerKind =
  | "paid_event"
  | "free_event"
  | "rsvp"
  | "trip"
  | "experience";

export const PUBLISHED_BANNER_TITLE = "Published. It's live.";

const SUPPORTING_LINE: Record<PublishedBannerKind, string> = {
  paid_event: "Share it to start selling tickets.",
  free_event: "Share it to start getting guests.",
  rsvp: "Share it to start getting guests.",
  trip: "Share it to start taking bookings.",
  experience: "Share it to start taking bookings.",
};

export const publishedBannerSupportingLine = (
  kind: PublishedBannerKind,
): string => SUPPORTING_LINE[kind];

/**
 * An event with at least one priced ticket sells tickets; one whose tickets are
 * all free (or that has none yet) is collecting guests.
 */
export const publishedEventBannerKind = (
  tickets: readonly { isFree: boolean }[],
): "paid_event" | "free_event" =>
  tickets.some((ticket) => !ticket.isFree) ? "paid_event" : "free_event";
