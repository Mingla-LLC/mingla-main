/**
 * ORCH-1066 — pure render rules for <DeckCardPreview>, extracted so they are
 * unit-testable via `node --test` (the JSX component imports these).
 *
 * Honest-data contract (Constitution #9 / SPEC §3.10):
 * - rating badge HIDDEN when rating is null or ≤ 0 (exact native rule)
 * - hero is a real photo OR an honest "No photo yet" placeholder — never faked;
 *   '__backfill_failed__' sentinel counts as no-photo
 * - distance / travel time are NEVER produced here (admin has no buyer geo)
 * - the live venue preview uses canonicalVenuePriceLabel exclusively
 */

export function priceLabel(placeData) {
  if (!placeData) return null;
  const tiers = placeData.price_tiers;
  if (Array.isArray(tiers) && tiers.length > 0) {
    const n = Math.max(1, Math.min(4, tiers.length));
    return "$".repeat(n);
  }
  const labels = {
    PRICE_LEVEL_FREE: "Free",
    PRICE_LEVEL_INEXPENSIVE: "$",
    PRICE_LEVEL_MODERATE: "$$",
    PRICE_LEVEL_EXPENSIVE: "$$$",
    PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
  };
  return typeof placeData.price_level === "string"
    ? labels[placeData.price_level] ?? null
    : null;
}

/** Canonical minor-unit source range. Legacy Google ordinals are not money. */
export function canonicalVenuePriceLabel(placeData) {
  if (!placeData) return null;
  const min = placeData.source_min_minor;
  const max = placeData.source_max_minor;
  const code = placeData.source_currency_code;
  const exponent = placeData.source_minor_unit_exponent ?? 2;
  if (!Number.isSafeInteger(min) || min < 0 || typeof code !== "string") return null;
  if (max !== null && max !== undefined && (!Number.isSafeInteger(max) || max < min)) return null;
  if (min === 0 && max === 0) return "Free";
  const format = (minor) => new Intl.NumberFormat("en", {
    style: "currency",
    currency: code,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(minor / (10 ** exponent));
  return max === null || max === undefined
    ? `${format(min)}+`
    : `${format(min)}–${format(max)}`;
}

/** Exact native rule: show rating only when it is a positive number. */
export function showRating(rating) {
  return typeof rating === "number" && rating > 0;
}

/** True when the first stored photo is a real, renderable hero. */
export function hasRealHero(storedPhotoUrls) {
  if (!Array.isArray(storedPhotoUrls) || storedPhotoUrls.length === 0) return false;
  const first = storedPhotoUrls[0];
  return typeof first === "string" && first.length > 0 && first !== "__backfill_failed__";
}
