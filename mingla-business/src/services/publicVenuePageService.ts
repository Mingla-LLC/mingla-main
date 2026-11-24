/**
 * #4490 — the public venue page's FEATURES read.
 *
 * `pg_public_venue_page(brand_slug, venue_slug)` is the anon-safe, verified-only
 * read that says what a venue sells (features, spaces, hours windows, special
 * days, upcoming events). The page's tabs, third info row and booking bar are
 * derived from it (`@mingla/brand-rendering/venueFeaturePage`), never from the
 * venue type.
 *
 * ANON ROUTE RULE: this file and its hook never touch auth. A signed-out guest
 * opening a share link must get the same page a signed-in host does.
 *
 * `biz_preview_venue_page(venue_id)` returns the same shape for a brand member
 * on a venue that is not public yet (the Host preview).
 */
import { parsePublicVenueFeatures, type PublicVenueFeaturesView } from "@mingla/brand-rendering/venueFeatureRead";

import { supabase } from "./supabase";
import {
  venuePublicViewRowToPublicVenue,
  type PublicVenue,
  type VenuePublicViewRow,
} from "./publicEventsService";

/**
 * The venue's features, or null when the venue is not public or the payload is
 * not the documented shape (the page then falls back to today's tabs).
 */
export async function getPublicVenueFeatures(
  brandSlug: string,
  venueSlug: string,
): Promise<PublicVenueFeaturesView | null> {
  const { data, error } = await supabase.rpc("pg_public_venue_page", {
    p_brand_slug: brandSlug,
    p_venue_slug: venueSlug,
  });
  if (error !== null) throw error;
  return parsePublicVenueFeatures(data);
}

export interface VenuePreviewPage {
  venue: PublicVenue;
  features: PublicVenueFeaturesView;
}

/**
 * The Host preview: the venue row and its features for a brand member, whatever
 * its claim status. Null when the payload is not the documented shape.
 */
export async function getVenuePreviewPage(
  venueId: string,
): Promise<VenuePreviewPage | null> {
  const { data, error } = await supabase.rpc("biz_preview_venue_page", {
    p_venue_id: venueId,
  });
  if (error !== null) throw error;
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const raw = data as { venue?: unknown };
  const features = parsePublicVenueFeatures(data);
  if (
    features === null ||
    raw.venue === null ||
    typeof raw.venue !== "object" ||
    Array.isArray(raw.venue)
  ) {
    return null;
  }
  return {
    venue: venuePublicViewRowToPublicVenue(raw.venue as VenuePublicViewRow),
    features,
  };
}
