/**
 * Ve6 — gate for Hub > Experiences activities snap CTA.
 */

import type { Brand } from "../types/brand";

export function canGenerateExperiencesFromActivities(brand: Brand | null): boolean {
  if (brand === null) return false;
  return (
    brand.kind === "physical" &&
    brand.venueCategory === "play" &&
    brand.claimStatus === "verified"
  );
}
