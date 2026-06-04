/**
 * ORCH-1066 — pure render rules for <DeckCardPreview>, extracted so they are
 * unit-testable via `node --test` (the JSX component imports these).
 *
 * Honest-data contract (Constitution #9 / SPEC §3.10):
 * - rating badge HIDDEN when rating is null or ≤ 0 (exact native rule)
 * - hero is a real photo OR an honest "No photo yet" placeholder — never faked;
 *   '__backfill_failed__' sentinel counts as no-photo
 * - distance / travel time are NEVER produced here (admin has no buyer geo)
 * - price label derives from real price_tiers / price_level only; null → hidden
 */

export const PRICE_LEVEL_LABEL = {
  PRICE_LEVEL_FREE: "Free",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

/** Tier label from price_tiers (array) or price_level (enum). null → hidden. */
export function priceLabel(placeData) {
  if (!placeData) return null;
  const tiers = placeData.price_tiers;
  if (Array.isArray(tiers) && tiers.length > 0) {
    const n = Math.max(1, Math.min(4, tiers.length));
    return "$".repeat(n);
  }
  const lvl = placeData.price_level;
  if (typeof lvl === "string" && PRICE_LEVEL_LABEL[lvl]) return PRICE_LEVEL_LABEL[lvl];
  return null;
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
