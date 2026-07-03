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

// ORCH-1263 §A2 (D-F / DESIGN §6.1, ADDITIVE) — ONE owner for the category-
// confidence rule, computed server-side so client and server can never drift.
// Confident ⇔ the canonical mapper matched an EXPLICIT arm that genuinely
// means its venue_category: play → play, creative_arts → creative_and_arts,
// and the true-restaurant-family arms (brunch_lunch_casual /
// upscale_fine_dining) → restaurant. EVERYTHING else — the catch-all→
// restaurant default (nature, unmapped, groceries, movies_theatre, flowers,
// and the mixed icebreakers / drinks_and_music buckets) — is NOT confidence
// (R-8: never silently fabricate 34k "restaurants"); those places arrive at
// c0 unselected with the honest copy.
const CONFIDENT_SLUGS = new Set([
  "play",
  "creative_arts",
  "brunch_lunch_casual",
  "upscale_fine_dining",
]);

export function isConfidentVenueCategory(
  primaryType: string | null | undefined,
  types: string[] | null | undefined,
): boolean {
  const slug = derivePoolCategory(primaryType ?? null, types ?? null);
  return slug !== null && CONFIDENT_SLUGS.has(slug);
}
