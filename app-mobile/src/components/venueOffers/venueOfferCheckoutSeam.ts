/**
 * #4490 Explorer W3 — THE ONE PLACE a venue page pane hands a booking off.
 *
 * [TRANSITIONAL] W4 builds `VenueOfferCheckoutSheet` (the native checkout per
 * offer). Until it lands, a pane's book button opens the buyer web page for
 * that venue on the offer's tab in Mingla's own in-app browser (the I-4261
 * rule: never Safari, never a dead tap), where buying works with or without an
 * account and every price comes from the server. Exits when W4's
 * VenueOfferCheckoutSheet replaces `openVenueOfferCheckout` (this file is the
 * only caller site to swap).
 */
import type { PublicVenueTab } from "@mingla/brand-rendering/publicVenueTabState";

/** Buyer web: where a guest buys without an account (the venue page's own origin). */
const BUYER_WEB_ORIGIN = "https://host.usemingla.com";

export interface VenueOfferCheckoutTarget {
  readonly brandSlug: string;
  readonly venueSlug: string;
  readonly tab: PublicVenueTab;
  /** The offer or plan the guest tapped (W4's sheet opens on it). */
  readonly offerId: string | null;
}

/** The buyer web page for that tab. Pure. */
export function venueOfferCheckoutWebUrl(target: VenueOfferCheckoutTarget): string {
  return `${BUYER_WEB_ORIGIN}/b/${encodeURIComponent(target.brandSlug)}/v/${encodeURIComponent(target.venueSlug)}?tab=${encodeURIComponent(target.tab)}`;
}

/**
 * Open the checkout for one offer. `openInMingla` is `useOpenInMingla().open`
 * from the screen (the in-app browser provider above the route).
 */
export function openVenueOfferCheckout(
  target: VenueOfferCheckoutTarget,
  openInMingla: (url: string) => void,
): void {
  openInMingla(venueOfferCheckoutWebUrl(target));
}
