/**
 * Ve2 — map Mingla consumer category slug → business venue_category pill.
 */

import { derivePoolCategory } from "./derivePoolCategory.ts";

export type VenueCategorySlug = "restaurant" | "play" | "creative_and_arts";

/** Maps place_pool primary_type + types[] to Ve1 venue_category. */
export function mapPoolTypesToVenueCategory(
  primaryType: string | null | undefined,
  types: string[] | null | undefined,
): VenueCategorySlug {
  const slug = derivePoolCategory(primaryType ?? null, types ?? null);
  if (slug === "play") return "play";
  if (slug === "creative_arts") return "creative_and_arts";
  return "restaurant";
}
