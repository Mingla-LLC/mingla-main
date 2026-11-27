// #4624: its own module (imported only by DiscountListView) so it stays in the
// discounts list chunk and out of the shared web boot chunk.
/**
 * #4624: the list row's usage line. A code's ticket cap (ends_after_count)
 * counts tickets ("2 of 5 tickets used"); everything else, including automatic
 * and sale "End after N sold", keeps "12 of 50 used" (P3-2). When both limits
 * are set the row shows tickets (the bar follows the cap).
 */
export const discountUsageLabel = (
  consumed: number,
  limit: number,
  ticketCapped: boolean,
): string =>
  ticketCapped
    ? `${consumed} of ${limit} tickets used`
    : `${consumed} of ${limit} used`;

/**
 * #4624 item 5 (D-5b): tickets from payments that finished after their hold ran
 * out were honoured past the cap; the host sees why the count passed the limit.
 */
export const discountOverLimitLabel = (overLimitUnits: number): string | null =>
  overLimitUnits <= 0
    ? null
    : overLimitUnits === 1
      ? "1 over the limit: a payment finished after its hold ran out."
      : `${overLimitUnits} over the limit: payments finished after their hold ran out.`;
