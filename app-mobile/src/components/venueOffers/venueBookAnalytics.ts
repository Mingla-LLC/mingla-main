/**
 * #4490 Explorer W3 — `venue_tapped_to_book` (spec 06 W5 analytics; ships with
 * the W3 app). One wrapper so every site sends the same properties: a deck
 * card tap on a claimed venue, a "Ways to come" row on the card sheet, a book
 * button on a venue page pane (W6 adds the Discover card).
 */
import { postHogService } from "../../services/postHogService";

export type VenueTappedToBookSource = "deck_card" | "expanded_sheet" | "venue_page" | "discover";

export interface VenueTappedToBook {
  venueId: string;
  tab: string | null;
  offerKind: string | null;
  source: VenueTappedToBookSource;
  positionInDeck: number | null;
  isHostedVenue: boolean;
  mode: "solo" | "collab";
}

/** The event's exact properties (spec 06 W5). Pure, for tests. */
export function venueTappedToBookProps(input: VenueTappedToBook): Record<string, string | number | boolean | null> {
  return {
    venue_id: input.venueId,
    tab: input.tab,
    offer_kind: input.offerKind,
    source: input.source,
    position_in_deck: input.positionInDeck,
    is_hosted_venue: input.isHostedVenue,
    mode: input.mode,
  };
}

export function captureVenueTappedToBook(input: VenueTappedToBook): void {
  postHogService.capture("venue_tapped_to_book", venueTappedToBookProps(input));
}
