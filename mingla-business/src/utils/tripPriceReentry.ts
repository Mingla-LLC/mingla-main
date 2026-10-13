/**
 * Issue #3645 — a trip package whose price was cleared because the brand's
 * currency changed.
 *
 * A trip package's price is a number that cannot be empty, and 0 means FREE.
 * So when the server clears a package's price (migration 20270829003645) it
 * also writes a marker into that package's own tier_metadata:
 *
 *   "price_cleared_for_currency_change": { "from": "GBP", "to": "NGN" }
 *
 * While the marker is there and the price is still 0, the package is "no price
 * yet", not "free": the wizard shows an empty required field, and Publish is
 * refused by the server with `price_reentry_required`. As soon as the host
 * types ANY price, including 0 for a package they do want free, the save
 * removes the marker.
 *
 * Pure: no React, no network.
 */
export const TRIP_PRICE_CLEARED_KEY = "price_cleared_for_currency_change";

export const TRIP_PRICE_REENTRY_REQUIRED_CODE = "price_reentry_required";

/** Host copy for the server's `price_reentry_required` refusal. */
export const TRIP_PRICE_REENTRY_MESSAGE =
  "Your brand's currency changed. Enter this package's price again before publishing.";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** True while the package's price was cleared and has not been entered again. */
export const tierNeedsPriceReentry = (tier: {
  tierMetadata: Record<string, unknown> | null | undefined;
  priceCents: number;
}): boolean =>
  tier.priceCents === 0 &&
  isRecord(tier.tierMetadata) &&
  isRecord(tier.tierMetadata[TRIP_PRICE_CLEARED_KEY]);

/** The currency the brand moved to, when the marker names one. */
export const tierPriceClearedCurrency = (
  tierMetadata: Record<string, unknown> | null | undefined,
): string | null => {
  if (!isRecord(tierMetadata)) return null;
  const marker = tierMetadata[TRIP_PRICE_CLEARED_KEY];
  if (!isRecord(marker)) return null;
  const to = marker.to;
  return typeof to === "string" && to.trim().length > 0
    ? to.trim().toUpperCase()
    : null;
};

/** tier_metadata without the marker (a new object; the input is not changed). */
export const withoutPriceClearedMarker = (
  tierMetadata: Record<string, unknown>,
): Record<string, unknown> => {
  if (!(TRIP_PRICE_CLEARED_KEY in tierMetadata)) return tierMetadata;
  const { [TRIP_PRICE_CLEARED_KEY]: _removed, ...rest } = tierMetadata;
  return rest;
};
