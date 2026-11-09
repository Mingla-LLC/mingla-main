/**
 * #4347 wave 4 — the deck's hand-off to a host venue's public page.
 *
 * A claimed venue on the deck opens `/b/{brandSlug}/v/{venueSlug}` (wave 1).
 * The route only carries the two slugs, but Save and Schedule on that page must
 * act on the SAME card the deck showed: the same `saved_card.experience_id`,
 * the same calendar entry, the same solo/collab save path (the deck's
 * right-swipe, which also takes the card off the deck). So just before the deck
 * leaves, it records that card and its save path here, keyed by the place.
 *
 * ONE slot, not a map: only the venue the person just tapped can be on screen.
 * The page reads it by `place_pool_id`; a page reached any other way (a shared
 * link, Discover stays) finds nothing and keeps the shared page's own reserve
 * bar. Cleared at sign-out with the rest of the client state.
 */
import type { ExpandedCardData } from '../../types/expandedCardTypes';

export interface DeckVenueHandoff {
  /** The deck card's place (== `venue_public_view.place_pool_id`). */
  readonly placePoolId: string;
  /** The exact card the deck showed (`recommendationToExpanded`). */
  readonly card: ExpandedCardData;
  readonly currentMode: string;
  readonly isSaved: boolean;
  /** The deck's save path (solo save or collab vote), same as the sheet's Save. */
  readonly save: (card: ExpandedCardData) => Promise<void>;
  /** Takes the card off the deck after a schedule, as the sheet does. */
  readonly onCardRemoved?: (cardId: string) => void;
  readonly canAccessCurated: boolean;
  readonly onPaywallRequired?: () => void;
  readonly userPreferences?: unknown;
}

let slot: DeckVenueHandoff | null = null;

export function setDeckVenueHandoff(entry: DeckVenueHandoff): void {
  slot = entry;
}

/** The hand-off for this place, or null when the page was not opened from the deck. */
export function getDeckVenueHandoff(placePoolId: string | null | undefined): DeckVenueHandoff | null {
  if (typeof placePoolId !== 'string' || placePoolId.length === 0) return null;
  return slot !== null && slot.placePoolId === placePoolId ? slot : null;
}

export function clearDeckVenueHandoff(): void {
  slot = null;
}
