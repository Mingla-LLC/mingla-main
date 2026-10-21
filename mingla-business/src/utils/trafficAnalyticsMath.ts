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

export interface TrafficFunnelTotals {
  pageViews: number;
  buttonTaps: number;
  checkoutStarts: number;
  bookings: number;
}

export interface TrafficFunnelStep {
  label: string;
  value: number;
  /** Bar width as a percentage of the first visible step (floor 4). */
  widthPercent: number;
}

/**
 * #4037 — the "From visit to sale" funnel. While a page is still collecting
 * traffic only the Bookings step is shown, and it becomes the baseline its bar
 * is scaled against, so a small booking count is never drawn as a sliver of an
 * absent visit count.
 */
export const visibleFunnelSteps = (
  totals: TrafficFunnelTotals,
  hasTraffic: boolean,
): TrafficFunnelStep[] => {
  const steps = [
    { label: "Page visits", value: totals.pageViews },
    { label: "Button taps", value: totals.buttonTaps },
    { label: "Checkouts started", value: totals.checkoutStarts },
    { label: "Bookings", value: totals.bookings },
  ];
  const visible = hasTraffic ? steps : steps.slice(-1);
  const basis = Math.max(visible[0]?.value ?? 0, 1);
  return visible.map((step) => ({
    ...step,
    widthPercent: Math.max(4, (step.value / basis) * 100),
  }));
};
