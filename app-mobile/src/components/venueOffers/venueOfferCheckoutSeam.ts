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
 *
 * WHICH WEB (W3 fix 1). The buyer web page must belong to the same backend the
 * app is reading venues from, or a guest is sent to a different system's
 * checkout. The app has ONE configured backend: `SUPABASE_URL`
 * (`src/config/supabaseProject.js`, the single owner; every EAS profile,
 * development and preview included, uses it, and the local test harness
 * rewrites it to the local stack). So the origin is derived from it, with no
 * new setting: the hosted project's buyer web is host.usemingla.com; a build
 * pointed at any other backend (the local stack) has no buyer web this app may
 * send a guest to, and the hand-off reports that instead of opening production.
 */
import type { PublicVenueTab } from "@mingla/brand-rendering/publicVenueTabState";

import { SUPABASE_URL } from "../../config/supabaseProject";

/** Buyer web of the hosted backend (where a guest buys without an account). */
const HOSTED_BUYER_WEB_ORIGIN = "https://host.usemingla.com";

/**
 * The buyer web origin for a backend URL. Null when the backend is not the
 * hosted Mingla project (a local or unknown backend): never production.
 */
export function buyerWebOriginFor(supabaseUrl: string): string | null {
  try {
    const url = new URL(supabaseUrl);
    return url.protocol === "https:" && url.hostname.endsWith(".supabase.co") ? HOSTED_BUYER_WEB_ORIGIN : null;
  } catch {
    return null;
  }
}

export interface VenueOfferCheckoutTarget {
  readonly brandSlug: string;
  readonly venueSlug: string;
  readonly tab: PublicVenueTab;
  /** The offer or plan the guest tapped (W4's sheet opens on it). */
  readonly offerId: string | null;
}

/** The buyer web page for that tab on this build's backend; null when there is none. Pure. */
export function venueOfferCheckoutWebUrl(
  target: VenueOfferCheckoutTarget,
  origin: string | null = buyerWebOriginFor(SUPABASE_URL),
): string | null {
  if (origin === null) return null;
  return `${origin}/b/${encodeURIComponent(target.brandSlug)}/v/${encodeURIComponent(target.venueSlug)}?tab=${encodeURIComponent(target.tab)}`;
}

/**
 * Open the checkout for one offer. `openInMingla` is `useOpenInMingla().open`
 * from the screen (the in-app browser provider above the route). Returns false
 * when this build has no buyer web to open (the pane then says so).
 */
export function openVenueOfferCheckout(
  target: VenueOfferCheckoutTarget,
  openInMingla: (url: string) => void,
  origin: string | null = buyerWebOriginFor(SUPABASE_URL),
): boolean {
  const url = venueOfferCheckoutWebUrl(target, origin);
  if (url === null) return false;
  openInMingla(url);
  return true;
}
