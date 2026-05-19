/**
 * Ve2 — client mirror of mapPoolTypesToVenueCategory (venue wizard pills).
 */

import type { VenueCategory } from "../types/brand";

const PLAY_SLUG = "play";
const CREATIVE_SLUG = "creative_arts";

/**
 * Maps Mingla canonical category slug (from edge fn) to venue_category.
 */
export function mapMinglaSlugToVenueCategory(
  minglaSlug: string | null | undefined,
): VenueCategory {
  if (minglaSlug === PLAY_SLUG) return "play";
  if (minglaSlug === CREATIVE_SLUG) return "creative_and_arts";
  return "restaurant";
}
