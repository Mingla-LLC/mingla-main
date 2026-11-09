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
 * bar. It is for ONE visit: the page releases it when it closes
 * (`releaseDeckVenueHandoff`), and it is cleared at sign-out with the rest of
 * the client state.
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

/**
 * #4347 rework (A-2) — the page that used `entry` has closed. Clears the slot
 * only when it still holds that same entry, so a newer deck tap (a different
 * venue, or the same venue again) is never wiped by an older page unmounting.
 */
export function releaseDeckVenueHandoff(entry: DeckVenueHandoff): void {
  if (slot === entry) slot = null;
}

/**
 * #4347 rework (P4) — the deck's save for a venue page. The card leaves the
 * deck at once (as it does from the place sheet), but if the save then fails
 * it is put back, so a failed save never loses the card from the deck. The
 * error still reaches the caller (ActionButtons shows it and the page stays).
 */
export function deckHandoffSave(
  cardId: string,
  deck: {
    readonly remove: (cardId: string) => void;
    readonly restore: (cardId: string) => void;
    readonly swipeRight: () => Promise<void>;
  },
): () => Promise<void> {
  return async () => {
    deck.remove(cardId);
    try {
      await deck.swipeRight();
    } catch (error) {
      deck.restore(cardId);
      throw error;
    }
  };
}
