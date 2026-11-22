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

/**
 * #4490 Explorer W5 — what the deck card events (`card_viewed`, `card_saved`,
 * `card_dismissed`, `card_expanded`) add about venues. `deckLead` is the
 * server's additive field (`hosted_venue` or `experience`, only while
 * VENUE_DECK_HOSTED_FIRST is on); a claimed venue that can be booked on Mingla
 * is a hosted venue whether or not the server lifted it. Non-venues carry
 * `venue_id: null`.
 */
export interface DeckCardVenueInput {
  deckLead?: string | null;
  claimedVenue?: { venueId: string; isBookable: boolean } | null;
}

export function deckCardVenueProps(input: DeckCardVenueInput): {
  is_hosted_venue: boolean;
  deck_lead: "hosted_venue" | "experience" | null;
  venue_id: string | null;
} {
  const deckLead =
    input.deckLead === "hosted_venue" || input.deckLead === "experience" ? input.deckLead : null;
  return {
    is_hosted_venue: deckLead === "hosted_venue" || input.claimedVenue?.isBookable === true,
    deck_lead: deckLead,
    venue_id: input.claimedVenue?.venueId ?? null,
  };
}

/** `card_saved`, `card_dismissed` and `card_expanded` carry the lead fields without `venue_id` (spec 06 W5). */
export function expandVenueProps(p: ReturnType<typeof deckCardVenueProps>): {
  is_hosted_venue: boolean;
  deck_lead: "hosted_venue" | "experience" | null;
} {
  return { is_hosted_venue: p.is_hosted_venue, deck_lead: p.deck_lead };
}

/**
 * #4490 Explorer W5 — `venue_checkout_finished`. No amounts, names or emails.
 * Fired only where the app learns a checkout outcome today: the venue page's
 * table reservation sheet (`VenueReserveSheet`, offer kind
 * `table_reservation`). The per-offer checkout of spec 06 W4 adds its own.
 */
export type VenueCheckoutOutcome = "confirmed" | "requested" | "failed" | "cancelled" | "expired";

export interface VenueCheckoutFinished {
  venueId: string;
  offerKind: string;
  outcome: VenueCheckoutOutcome;
}

export function venueCheckoutFinishedProps(input: VenueCheckoutFinished): Record<string, string> {
  return {
    venue_id: input.venueId,
    offer_kind: input.offerKind,
    outcome: input.outcome,
    channel: "app",
  };
}

export function captureVenueCheckoutFinished(input: VenueCheckoutFinished): void {
  postHogService.capture("venue_checkout_finished", venueCheckoutFinishedProps(input));
}

/** The table reservation sheet's result → the event outcome (a review step is not an end). */
export function tableCheckoutOutcome(
  outcome: "succeeded" | "canceled" | "review" | "failed",
): VenueCheckoutOutcome | null {
  if (outcome === "succeeded") return "confirmed";
  if (outcome === "canceled") return "cancelled";
  if (outcome === "failed") return "failed";
  return null;
}
