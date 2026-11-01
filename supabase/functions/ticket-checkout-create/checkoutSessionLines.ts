/**
 * issue #3281 — what a contract v2 session line must hold for a request.
 *
 * The session stores purchased units. A uniform per-day line is one unit per
 * chosen date, so its quantity is the request times the dates. A by-date line
 * already states its total, and an all-days pass is one unit whatever the dates.
 */
export interface CheckoutSessionDayScope {
  dayCount: number;
  pricingMode: string | null;
}

export function expectedSessionLineQuantity(
  line: { quantity: number; byDate?: Record<string, number> },
  scope: CheckoutSessionDayScope,
): number {
  if (line.byDate !== undefined || scope.pricingMode === "all_days") {
    return line.quantity;
  }
  return line.quantity * Math.max(scope.dayCount, 1);
}
