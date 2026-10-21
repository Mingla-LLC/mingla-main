export const visitToPaidRate = (
  bookings: number,
  pageViews: number,
): number | null =>
  pageViews > 0 ? Math.round((bookings / pageViews) * 1000) / 10 : null;

export const visibleDelta = (
  current: number,
  prior: number,
  currentThresholdCount: number,
  priorThresholdCount: number,
  threshold: number,
): number | null => {
  if (
    currentThresholdCount < threshold ||
    priorThresholdCount < threshold ||
    prior <= 0
  ) {
    return null;
  }
  return Math.round(((current - prior) / prior) * 1000) / 10;
};

/**
 * #4037 decision 7 — a visible delta always keeps its sign. Only a rise uses
 * the positive treatment; a decline or no change uses the neutral secondary
 * treatment. Declines are never hidden.
 */
export type TrafficDeltaTone = "positive" | "neutral";

export const trafficDeltaTone = (delta: number): TrafficDeltaTone =>
  delta > 0 ? "positive" : "neutral";

export const formatTrafficDelta = (delta: number): string =>
  `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`;

export const trafficDeltaAccessibilityLabel = (delta: number): string =>
  delta === 0
    ? "No change versus prior period"
    : `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} percent versus prior period`;
