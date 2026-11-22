/**
 * #4490 Explorer W6a — what a Discover venue card says, from the server's card
 * facts (`issue_4490_venue_card_facts`). One owner each: the lead line and tab
 * come from the shared `deckVenueChips` (which asks `deriveVenuePage`), money
 * from `venueMoneyText` (₦, Hermes-safe), the type label from
 * `VENUE_TYPE_LABELS`. Pure, for tests.
 */
import {
  deckVenueChips,
  deckVenueOfferChip,
  parseDeckVenueFacts,
  type DeckVenueEventChip,
  type DeckVenueFacts,
} from "@mingla/brand-rendering/deckVenueChip";
import { venueTypeLabel } from "@mingla/brand-rendering/venueTypeLabels";
import type { DiscoverCardV2, DiscoverMinglaCard } from "../../types/discoverFeed";
import { venueMoneyText } from "../venueOffers/venueMoneyText";

export interface DiscoverVenueCardModel {
  facts: DeckVenueFacts;
  /** "Bar and lounge" (null for a type the app does not know). */
  typeLabel: string | null;
  /** "Entry from ₦4,000", "Book a table" (null: the venue leads with nothing a card can name). */
  offerLine: string | null;
  /** "On tonight" / "On today" in the venue's own clock (Discover always browses today). */
  eventChip: DeckVenueEventChip | null;
  /** The venue page tab the card opens. */
  leadTab: string | null;
  offerKind: string | null;
}

export function isDiscoverVenueCard(card: DiscoverCardV2): card is DiscoverMinglaCard & { kind: "venue" } {
  return card.source === "mingla" && card.kind === "venue";
}

/** The card's facts, or null for any other card or an unreadable payload. */
export function discoverVenueFacts(card: DiscoverCardV2): DeckVenueFacts | null {
  return isDiscoverVenueCard(card) ? parseDeckVenueFacts(card.venue) : null;
}

export function discoverVenueCardModel(card: DiscoverCardV2, now: Date): DiscoverVenueCardModel | null {
  const facts = discoverVenueFacts(card);
  if (facts === null) return null;
  const chips = deckVenueChips(facts, now, venueMoneyText);
  return {
    facts,
    typeLabel: venueTypeLabel(facts.venueType),
    offerLine: chips.offerChip?.label ?? null,
    eventChip: chips.eventChip,
    leadTab: chips.offerChip?.tab ?? null,
    offerKind: chips.offerChip?.offerKind ?? null,
  };
}

/** The tab a venue card opens (no clock needed: the lead never depends on time). */
export function discoverVenueLeadTab(card: DiscoverCardV2): string | null {
  const facts = discoverVenueFacts(card);
  return facts === null ? null : deckVenueOfferChip(facts, venueMoneyText)?.tab ?? null;
}

/** The analytics properties a venue card adds (spec 06 W6: venue_type, lead_tab, on_tonight). */
export function discoverVenueAnalytics(card: DiscoverCardV2, now: Date): Record<string, string | boolean | null> {
  const model = discoverVenueCardModel(card, now);
  if (model === null) return {};
  return {
    venue_type: model.facts.venueType,
    lead_tab: model.leadTab,
    on_tonight: model.eventChip === "On tonight",
  };
}

/** The venue page path with the lead offer's tab (`?tab=`), or the plain path for any other card. */
export function withVenueLeadTab(card: DiscoverCardV2, path: string): string {
  const tab = discoverVenueLeadTab(card);
  return tab ? `${path}?tab=${encodeURIComponent(tab)}` : path;
}
