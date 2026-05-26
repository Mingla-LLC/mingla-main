/**
 * Ve6 — gate for Hub > Experiences activities snap CTA.
 * I-BRAND-UNIVERSAL-AUTHORING (META-ORCH-0972) — no kind gate.
 */

import type { Brand } from "../types/brand";

export function canGenerateExperiencesFromActivities(brand: Brand | null): boolean {
  if (brand === null) return false;
  return brand.venueCategory === "play";
}
