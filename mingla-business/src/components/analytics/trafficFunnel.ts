// #4037 — the "From visit to sale" funnel maths. Used only by the lazily
// loaded traffic dashboard, so it lives beside it rather than in the shared
// analytics maths the Home tile loads at boot.
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
