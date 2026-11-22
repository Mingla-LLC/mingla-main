/**
 * #4490 Explorer W3 → W4 — THE ONE PLACE a venue page pane hands a booking off.
 *
 * W4 (spec 06 §3): a pane's book button opens the native checkout sheet
 * (`VenueOfferCheckoutSheet`) for that offer, for all five kinds: Entry, Group
 * package, Private hire, By the hour and Plan. The W3 hand-off to the buyer
 * web page in the in-app browser is gone (it was this file's transitional
 * exit). The sheet asks the server for every price; the pane's "from" price
 * is display only and never passed on.
 */
import type { PublicVenueTab } from "@mingla/brand-rendering/publicVenueTabState";
import type { VenueFeaturePlanView } from "@mingla/brand-rendering/venueFeaturePage";

import type { VenueCheckoutKind } from "../../payments/venueOfferCheckoutFlow";
import type { VenueCheckoutFromVenue } from "./VenueOfferCheckoutSheet";

export interface VenueOfferCheckoutTarget {
  readonly brandSlug: string;
  readonly venueSlug: string;
  readonly tab: PublicVenueTab;
  /** The offer or plan the guest tapped (the sheet opens on it). */
  readonly offerId: string | null;
}

/** What the page knows about the venue that the sheet needs (no price). */
export interface VenueOfferCheckoutVenue {
  readonly venueId: string;
  readonly venueName: string;
  readonly currencyCode: string;
  readonly exponent: number;
  readonly timezone: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  /** The typical-crowd curve key for the W7 when-line (`crowdCategoryFor`). */
  readonly category: string | null;
  readonly plans?: readonly VenueFeaturePlanView[];
}

const KIND_FOR_TAB: Partial<Record<PublicVenueTab, VenueCheckoutKind>> = {
  entry: "entry",
  groups: "group_package",
  hire: "private_hire",
  by_the_hour: "by_the_hour",
  plans: "plan",
};

/** The checkout kind for a pane's tab; null for a tab that sells nothing here. Pure. */
export function venueCheckoutKindForTab(tab: PublicVenueTab): VenueCheckoutKind | null {
  return KIND_FOR_TAB[tab] ?? null;
}

/** What the sheet opens with for a tap. Null when the tab has no checkout or no offer was tapped. Pure. */
export function venueOfferCheckoutOpen(
  target: VenueOfferCheckoutTarget,
  venue: VenueOfferCheckoutVenue,
): VenueCheckoutFromVenue | null {
  const kind = venueCheckoutKindForTab(target.tab);
  if (kind === null) return null;
  if (kind !== "plan" && (target.offerId === null || target.offerId.length === 0)) return null;
  return {
    from: "venue",
    kind,
    brandSlug: target.brandSlug,
    venueSlug: target.venueSlug,
    venueId: venue.venueId,
    venueName: venue.venueName,
    offerId: target.offerId,
    plans: venue.plans ?? [],
    currencyCode: venue.currencyCode,
    exponent: venue.exponent,
    timezone: venue.timezone,
    lat: venue.lat,
    lng: venue.lng,
    category: venue.category,
  };
}

/**
 * Open the native checkout for one offer. `show` is the pane's own sheet
 * state setter. Returns false when there is nothing to open (the pane says so).
 */
export function openVenueOfferCheckout(
  target: VenueOfferCheckoutTarget,
  venue: VenueOfferCheckoutVenue,
  show: (open: VenueCheckoutFromVenue) => void,
): boolean {
  const open = venueOfferCheckoutOpen(target, venue);
  if (open === null) return false;
  show(open);
  return true;
}
