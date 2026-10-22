/**
 * issue #3827 — the private link page's decisions, kept pure so they can be
 * tested without the page: which cover to draw, and which dates a sign-up or
 * a paid checkout carries.
 */
import type { TicketLinkResolve } from "../services/ticketLinkPublicTypes";

export type TicketLinkCoverMediaType = "image" | "video" | "gif";

export interface TicketLinkCover {
  mediaUrl: string;
  mediaType: TicketLinkCoverMediaType;
  posterUrl: string | null;
}

const VIDEO_FILE = /\.(mp4|mov|webm|m4v|m3u8)(\?|#|$)/i;
const GIF_FILE = /\.gif(\?|#|$)/i;

/**
 * The cover to draw. A video cover plays through the shared EventCoverMedia
 * with its poster; once the video cannot play, the poster is drawn as an
 * image. A payload from before the resolver named the media type falls back
 * to the file extension, so an .mp4 is never handed to an image.
 */
export const ticketLinkCover = (
  event: NonNullable<TicketLinkResolve["event"]>,
  videoFailed: boolean,
): TicketLinkCover | null => {
  const url = typeof event.coverUrl === "string" && event.coverUrl.length > 0 ? event.coverUrl : null;
  if (url === null) return null;
  const mediaType: TicketLinkCoverMediaType =
    event.coverMediaType === "video" || event.coverMediaType === "gif" || event.coverMediaType === "image"
      ? event.coverMediaType
      : VIDEO_FILE.test(url)
        ? "video"
        : GIF_FILE.test(url)
          ? "gif"
          : "image";
  const posterUrl =
    typeof event.coverPosterUrl === "string" && event.coverPosterUrl.length > 0
      ? event.coverPosterUrl
      : null;
  if (mediaType === "video" && videoFailed) {
    return posterUrl === null ? null : { mediaUrl: posterUrl, mediaType: "image", posterUrl: null };
  }
  return { mediaUrl: url, mediaType, posterUrl: mediaType === "video" ? posterUrl : null };
};

/** True when the link page must ask for dates (a multi-date or recurring event). */
export const ticketLinkAsksForDates = (resolved: TicketLinkResolve): boolean =>
  (resolved.dates?.length ?? 0) > 0;

/** True once the guest has chosen enough to continue. */
export const ticketLinkDatesReady = (
  resolved: TicketLinkResolve,
  selectedDateIds: readonly string[],
): boolean =>
  !ticketLinkAsksForDates(resolved) || resolved.allDaysPass === true || selectedDateIds.length > 0;

/**
 * The date fields of a guest-list sign-up. An event that does not ask for a
 * date sends exactly what it always sent (`eventDateId` only). An event that
 * asks sends the chosen set; an all-days pass sends an empty set and the
 * server binds every upcoming date.
 */
export const ticketLinkSignupDates = (
  resolved: TicketLinkResolve,
  selectedDateIds: readonly string[],
): { eventDateId: string | null; eventDateIds?: string[] } => {
  if (!ticketLinkAsksForDates(resolved)) return { eventDateId: resolved.eventDateId ?? null };
  const offered = new Set((resolved.dates ?? []).map((date) => date.id));
  return {
    eventDateId: null,
    eventDateIds: resolved.allDaysPass === true ? [] : selectedDateIds.filter((id) => offered.has(id)),
  };
};

/**
 * The day set a paid link hands to normal checkout. Null when the event does
 * not ask (the checkout path stays byte-identical); an all-days pass is
 * expanded by checkout itself, exactly as on the public event page.
 */
export const ticketLinkCheckoutDates = (
  resolved: TicketLinkResolve,
  selectedDateIds: readonly string[],
): string[] | null => {
  if (!ticketLinkAsksForDates(resolved)) {
    return resolved.eventDateId ? [resolved.eventDateId] : null;
  }
  if (resolved.allDaysPass === true) return null;
  const order = (resolved.dates ?? []).map((date) => date.id);
  return order.filter((id) => selectedDateIds.includes(id));
};
