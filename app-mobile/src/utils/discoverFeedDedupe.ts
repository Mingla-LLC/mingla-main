import type { DiscoverCardV2 } from "../types/discoverFeed";

function normalizedTicketmasterLabel(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function normalizedTicketmasterVenue(value: string): string {
  return normalizedTicketmasterLabel(value).replace(/\s*-\s*[a-z]{2}$/, "");
}

export function discoverFeedCardIdentity(card: DiscoverCardV2): string {
  if (card.source === "mingla") return `mingla:${card.id}`;
  const title = normalizedTicketmasterLabel(card.title);
  const venue = normalizedTicketmasterVenue(card.venueName);
  return title && title !== "untitled event"
    ? `ticketmaster:title:${title}|venue:${venue}`
    : `ticketmaster:id:${card.id}`;
}

/**
 * Ticketmaster exposes each performance as a separate event id. Discover is a
 * catalogue, not a show-time picker, so one named event at one canonical venue
 * owns one card and the earliest occurrence returned by the sorted feed wins.
 */
export function dedupeDiscoverFeedCards(cards: readonly DiscoverCardV2[]): DiscoverCardV2[] {
  const seen = new Set<string>();
  return cards.filter((card) => {
    const identity = discoverFeedCardIdentity(card);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
