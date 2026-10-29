export const BRAND_GROUP_LATEST_MESSAGE_THRESHOLD = 80;

export interface BrandGroupScrollMetrics {
  contentHeight: number;
  viewportHeight: number;
  offsetY: number;
}

/**
 * #4173 — follow new Brand-group messages only while the host is already at
 * the conversation tail. This gives first-open/send/receive the modern-chat
 * snap without yanking somebody away from an older message they are reading.
 */
export function isNearLatestBrandGroupMessage(
  { contentHeight, viewportHeight, offsetY }: BrandGroupScrollMetrics,
  threshold = BRAND_GROUP_LATEST_MESSAGE_THRESHOLD,
): boolean {
  const distanceFromLatest = contentHeight - viewportHeight - Math.max(0, offsetY);
  return distanceFromLatest <= Math.max(0, threshold);
}
