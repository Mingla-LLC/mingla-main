/**
 * Ve1 — slug for brand URLs (matches BrandSwitcherSheet / TripBrandWizard).
 */
export function slugifyBrandSlug(value: string): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 32);
  return base.length > 0 ? base : `brand${Date.now().toString(36)}`;
}
