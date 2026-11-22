/**
 * #4490 Explorer W3 — the card sheet's venue blocks, as pure data: "Ways to
 * come" (one row per switched-on bookable feature, the venue page's own rows,
 * lead first), "What's on" (up to 3 upcoming events, day-first 24-hour in the
 * venue's zone) and the venue page paths they open. Pure: no React.
 */
import {
  deriveVenuePage,
  venueEventWhen,
  venueTypeLeadsWithTables,
  type PublicVenueFeaturesView,
  type VenueFeatureEventView,
} from "@mingla/brand-rendering/venueFeaturePage";
import type { PublicVenueTab } from "@mingla/brand-rendering/publicVenueTabState";

import { withKnownCurrencySymbol } from "../../utils/programFormat";

export interface VenueSheetWayRow {
  readonly tab: PublicVenueTab;
  readonly title: string;
  readonly line: string | null;
  readonly price: string | null;
}

export interface VenueSheetEventRow {
  readonly id: string;
  readonly title: string;
  /** "Fri 28 Nov · 18:00" in the venue's zone; null when the zone is unknown. */
  readonly when: string | null;
  readonly href: string;
}

/** The venue page path on a tab (`/b/{brand}/v/{venue}?tab=`). */
export function venuePagePath(brandSlug: string, venueSlug: string, tab: PublicVenueTab | null): string {
  const base = `/b/${encodeURIComponent(brandSlug)}/v/${encodeURIComponent(venueSlug)}`;
  return tab === null ? base : `${base}?tab=${encodeURIComponent(tab)}`;
}

/**
 * "Ways to come": the venue page's own Ways rows (deriveVenuePage, one owner),
 * without Menu (nothing to book there) and without Overview / What's on.
 * Prices keep the page's words, with ₦ for Naira on every engine.
 */
export function venueSheetWays(
  features: PublicVenueFeaturesView,
  input: { tablesReservable: boolean | null; venueType: string | null },
): VenueSheetWayRow[] {
  const page = deriveVenuePage(features, {
    menuTabVisible: false,
    tablesGate:
      input.tablesReservable === null ? "pending" : input.tablesReservable ? "ready" : "blocked",
    tablesFirst: venueTypeLeadsWithTables(input.venueType),
  });
  if (page.legacy) return [];
  return page.ways
    .filter((w) => w.tab !== "menu" && w.tab !== "overview" && w.tab !== "whats_on")
    .map((w) => ({
      tab: w.tab,
      title: w.title,
      line: w.line,
      price: w.price === null ? null : withKnownCurrencySymbol(w.price, features.currencyCode),
    }));
}

/** "What's on": the first three upcoming events, in the venue's own clock. */
export function venueSheetEvents(
  events: readonly VenueFeatureEventView[],
  timeZone: string | null,
  max = 3,
): VenueSheetEventRow[] {
  return [...events]
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, max)
    .map((e) => ({ id: e.id, title: e.title, when: venueEventWhen(e.startsAt, timeZone), href: e.href }));
}
