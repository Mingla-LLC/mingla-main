// #4624: its own module (imported only by DiscountListView) so it stays in the
// discounts list chunk and out of the shared web boot chunk.
/**
 * #4624: the list row's usage line. A ticket cap (ends_after_count) counts
 * tickets ("2 of 5 tickets used"); otherwise checkouts ("12 of 50 used").
 * When both limits are set the row shows tickets (the bar follows the cap).
 */
export const discountUsageLabel = (
  consumed: number,
  limit: number,
  ticketCapped: boolean,
): string =>
  ticketCapped
    ? `${consumed} of ${limit} tickets used`
    : `${consumed} of ${limit} used`;
