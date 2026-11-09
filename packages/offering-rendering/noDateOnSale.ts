/**
 * issue #3281 — an event whose every remaining date the host cancelled has
 * nothing left to sell. Shared by Host web (PublicEventPage) and Explorer
 * (ConsumerEventDetailScreen) so both show the same disabled state.
 *
 * Self-contained on purpose: buyer web imports it into the public event page,
 * and pulling in eventDateSchedule would grow that chunk for two predicates.
 */

type OccurrenceLike = {
  startAt: string;
  endAt: string;
  cancelled?: boolean | null;
};

/**
 * True when the event still has dates to come and every one of them was
 * cancelled. A guest must never be sent on to "choose a day" with none to
 * choose. An event whose dates have all ended (none to come) is left to the
 * ended state, which already says so.
 */
export const noDateOnSale = (
  occurrences: readonly OccurrenceLike[],
  nowMs: number = Date.now(),
): boolean => {
  const upcoming = occurrences.filter((o) => {
    const end = Date.parse(o.endAt);
    return Number.isFinite(Date.parse(o.startAt)) && Number.isFinite(end) && end > nowMs;
  });
  return upcoming.length > 0 && upcoming.every((o) => o.cancelled === true);
};

/**
 * When no date is on sale, every ticket reads as sold out with no waitlist:
 * the shared "Sold out" state (resolveOfferingCta), so the buy button and each
 * ticket row are disabled. Otherwise the list comes back unchanged.
 */
export const ticketsWithNoDateOnSale = <
  T extends {
    isUnlimited: boolean;
    capacity: number | null;
    waitlistEnabled?: boolean;
  },
>(
  tickets: readonly T[],
  occurrences: readonly OccurrenceLike[],
  nowMs: number = Date.now(),
): T[] =>
  noDateOnSale(occurrences, nowMs)
    ? tickets.map((ticket) => ({
        ...ticket,
        isUnlimited: false,
        capacity: 0,
        waitlistEnabled: false,
      }))
    : [...tickets];
