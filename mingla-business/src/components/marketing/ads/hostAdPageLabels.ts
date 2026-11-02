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
};

const isPageType = (value: string): value is HostAdPageType =>
  (HOST_AD_PAGE_TYPE_ORDER as readonly string[]).includes(value);

export function hostAdPageTypeLabel(pageType: string): string {
  return isPageType(pageType) ? HOST_AD_PAGE_TYPE_LABEL[pageType] : "Page";
}

/** "Sat 5 Dec" in the viewer's local calendar, or null for no/invalid date. */
export function hostAdPageDate(startsAt: string | null | undefined): string | null {
  if (!startsAt) return null;
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return null;
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return formatShortDate(iso);
}

/** "Trip · Sat 5 Dec · Lagos" — label, date and city, skipping what's missing. */
export function hostAdPageMeta(page: PageLike): string {
  const city = page.city?.trim() ? page.city.trim() : null;
  return [hostAdPageTypeLabel(page.page_type), hostAdPageDate(page.starts_at), city]
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
