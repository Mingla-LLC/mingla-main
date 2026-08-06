/**
 * discoverDeckOrder — #1637 [discover-single-fetch].
 *
 * ONE function decides the order of the Discover grid.
 *
 * WHY IT EXISTS. The grid used to be two sequential `.map()` calls inside a
 * single wrapping 2-column container: business events first, then Ticketmaster.
 * Nothing in the code expressed "this is one ordered deck", so nothing could
 * assert on it — and when the second fetch landed, `setBusinessEvents(bizItems)`
 * inserted N cards at the HEAD of a list the user was already reading. Every
 * painted card shifted down by N slots, and because the container wraps, an ODD
 * N flipped every card from the left column to the right and back. That was
 * invisible in review because no single expression ever held the deck.
 *
 * Now the deck is one array with a stable, assertable identity per slot, so a
 * regression test can compare the ORDERED ID LIST across two renders rather
 * than counting cards and hoping.
 *
 * This function is pure and deliberately dumb: business-first ranking is the
 * product decision (ORCH-0824), and it is preserved byte-for-byte. What changed
 * is only that the order is now stated once, in one place, instead of being an
 * emergent property of two adjacent JSX blocks.
 */

/** A business-event card, narrowed to the field the deck needs for identity. */
export interface DiscoverDeckBusinessLike {
  eventId: string;
}

/** A Ticketmaster card, narrowed to the field the deck needs for identity. */
export interface DiscoverDeckTicketmasterLike {
  id: string;
}

export type DiscoverDeckEntry<
  TBusiness extends DiscoverDeckBusinessLike,
  TTicketmaster extends DiscoverDeckTicketmasterLike,
> =
  | { kind: "business"; key: string; data: TBusiness }
  | { kind: "ticketmaster"; key: string; data: TTicketmaster };

/**
 * Build the ordered Discover deck.
 *
 * ORCH-0824 ranking is unchanged: Mingla business events rank above the
 * Ticketmaster block. The keys are the SAME values the two former `.map()`
 * calls used (`be.eventId` / `card.id`), so React reconciliation is identical
 * and no card remounts as a result of this refactor.
 */
export function buildDiscoverDeckOrder<
  TBusiness extends DiscoverDeckBusinessLike,
  TTicketmaster extends DiscoverDeckTicketmasterLike,
>(
  businessEvents: readonly TBusiness[],
  ticketmasterCards: readonly TTicketmaster[],
): DiscoverDeckEntry<TBusiness, TTicketmaster>[] {
  const deck: DiscoverDeckEntry<TBusiness, TTicketmaster>[] = [];
  for (const be of businessEvents) {
    deck.push({ kind: "business", key: be.eventId, data: be });
  }
  for (const card of ticketmasterCards) {
    deck.push({ kind: "ticketmaster", key: card.id, data: card });
  }
  return deck;
}

/**
 * The ordered identity of a rendered deck — what a regression test compares
 * across two renders to prove nothing that has painted has moved.
 *
 * Prefixed per source because a business event and a Ticketmaster event could
 * in principle share a raw id string; without the prefix a swap between the two
 * blocks could read as "unchanged".
 */
export function discoverDeckIdentity<
  TBusiness extends DiscoverDeckBusinessLike,
  TTicketmaster extends DiscoverDeckTicketmasterLike,
>(deck: readonly DiscoverDeckEntry<TBusiness, TTicketmaster>[]): string[] {
  return deck.map((entry) =>
    entry.kind === "business" ? `business:${entry.key}` : `tm:${entry.key}`,
  );
}
