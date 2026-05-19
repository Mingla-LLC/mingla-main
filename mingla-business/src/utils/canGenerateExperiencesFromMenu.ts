/**
 * ORCH-0881 — Ve5 gate for Hub > Experiences menu snap CTA.
 */

import type { Brand } from "../types/brand";

export function canGenerateExperiencesFromMenu(brand: Brand | null): boolean {
  if (brand === null) return false;
  return (
    brand.kind === "physical" &&
    brand.venueCategory === "restaurant" &&
    brand.claimStatus === "verified"
  );
}
