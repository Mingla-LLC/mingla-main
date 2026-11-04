/**
 * #4238 — plain-English labels for the pages a Host can promote.
 *
 * Page types come from the `ad_advertisable_pages` RPC (`marketing` is
 * Admin-only and never reaches a Host). Pure module: no React, no I/O.
 */

import { formatShortDate } from "../../../utils/eventDateDisplay";

export const HOST_AD_PAGE_TYPE_ORDER = [
  "event",
  "rsvp",
  "trip",
  "experience",
  "venue",
  "reservation",
  "brand",
  "site",
] as const;

export type HostAdPageType = (typeof HOST_AD_PAGE_TYPE_ORDER)[number];

export const HOST_AD_PAGE_TYPE_LABEL: Record<HostAdPageType, string> = {
  event: "Event",
  rsvp: "RSVP event",
  trip: "Trip",
  experience: "Experience",
  venue: "Venue",
  reservation: "Reservations",
  brand: "Brand page",
  site: "Website",
};

export type HostAdPageFilter = "all" | HostAdPageType;

type PageLike = {
  page_type: string;
  starts_at?: string | null;
  city?: string | null;
  /** #4238: the offering's own IANA time zone (dated pages only). */
  timezone?: string | null;
  next_date?: string | null;
  dates_remaining?: number | null;
  last_bookable_at?: string | null;
  ok?: boolean | null;
  availability?: string | null;
};

const isPageType = (value: string): value is HostAdPageType =>
  (HOST_AD_PAGE_TYPE_ORDER as readonly string[]).includes(value);

export function hostAdPageTypeLabel(pageType: string): string {
  return isPageType(pageType) ? HOST_AD_PAGE_TYPE_LABEL[pageType] : "Page";
}

/**
 * "Sat 5 Dec". #4238 R16: in the offering's own time zone when it has one
 * (a Lagos 00:30 date reads the Lagos day for a viewer in New York); the
 * viewer's local calendar otherwise. Null for no/invalid date.
 */
export function hostAdPageDate(
  startsAt: string | null | undefined,
  timezone?: string | null,
): string | null {
  if (!startsAt) return null;
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return null;
  if (timezone) {
    try {
      return new Intl.DateTimeFormat("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: timezone,
      }).format(date);
    } catch {
      // Unknown zone on this device: fall back to the viewer's calendar.
    }
  }
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return formatShortDate(iso);
}

/**
 * #4238: "Sun 8 Nov · +4 more dates" — the next date and how many more,
 * in the offering's time zone. Just the date for a single date.
 */
export function hostAdPageSchedule(page: PageLike): string | null {
  const date = hostAdPageDate(page.next_date ?? page.starts_at, page.timezone);
  if (!date) return null;
  const more = (page.dates_remaining ?? 1) - 1;
  if (more <= 0) return date;
  return `${date} · +${more} more ${more === 1 ? "date" : "dates"}`;
}

/** #4238: the last day anyone can book, in the offering's time zone. */
export function hostAdPageLastDay(page: PageLike): string | null {
  return hostAdPageDate(page.last_bookable_at, page.timezone);
}

/**
 * #4238 R10: why a page can't be promoted, in plain words, or null when it
 * can. The server decides (`ok`); this only names the reason.
 */
export function hostAdPageUnavailableReason(page: PageLike): string | null {
  if (page.ok !== false) return null;
  switch (page.availability) {
    case "draft":
      return "Not published yet.";
    case "private":
      return "This page is private, so an ad can't link to it.";
    case "unlisted":
      return page.page_type === "experience"
        ? "Unlisted experiences can't be promoted. Make it public to promote it."
        : "Unlisted trips can't be promoted. Make it public to promote it.";
    case "ended":
      return "All its dates have passed.";
    case "nothing_on_sale":
      return page.page_type === "rsvp"
        ? "No spots left."
        : "Nothing is on sale right now.";
    case "bookings_closed":
      return "Bookings are closed.";
    case "not_live":
      return "Your website isn't live yet.";
    default:
      return "Can't be promoted right now.";
  }
}

/** "Trip · Sat 5 Dec · Lagos" — label, date and city, skipping what's missing. */
export function hostAdPageMeta(page: PageLike): string {
  const city = page.city?.trim() ? page.city.trim() : null;
  return [hostAdPageTypeLabel(page.page_type), hostAdPageSchedule(page), city]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

/**
 * "Sat 5 Dec · Lagos" — date and city only, for a card that already shows
 * the type as a badge (#4238 D7: never print the type twice).
 */
export function hostAdPageDetails(page: PageLike): string {
  const city = page.city?.trim() ? page.city.trim() : null;
  return [hostAdPageSchedule(page), city]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

/** A cover we can draw as an image (event covers may be videos). */
export function isImageCoverUrl(url: string | null | undefined): boolean {
  if (!url || !url.trim()) return false;
  const path = url.trim().split(/[?#]/)[0] ?? "";
  return !/\.(mp4|mov|m3u8|webm)$/i.test(path);
}

/** "all" plus each page type present, in the fixed order. */
export function pageTypeFilters(pages: readonly PageLike[]): HostAdPageFilter[] {
  const present = new Set(pages.map((page) => page.page_type));
  return ["all", ...HOST_AD_PAGE_TYPE_ORDER.filter((type) => present.has(type))];
}
