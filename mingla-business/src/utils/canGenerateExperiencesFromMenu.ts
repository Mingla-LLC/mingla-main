/**
 * ORCH-0881 — Ve5 gate for Hub > Experiences menu snap CTA.
 * I-BRAND-UNIVERSAL-AUTHORING (META-ORCH-0972) — no kind gate.
 */

import type { Brand } from "../types/brand";

export function canGenerateExperiencesFromMenu(brand: Brand | null): boolean {
  if (brand === null) return false;
  return brand.venueCategory === "restaurant";
}
