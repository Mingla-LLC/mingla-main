/** Door sales deliberately freeze the tier's list price, never an online sale. */
export function doorTierUnitPrice(
  tier: { isFree: boolean; priceGbp?: number | null },
): number {
  return tier.isFree ? 0 : (tier.priceGbp ?? 0);
}
