import { create } from 'zustand';

/**
 * #1687 — "Been here" opens the rating prompt.
 *
 * WHY A STORE AND NOT A PROP. `PostExperienceModal` is mounted EXACTLY ONCE, in
 * `app/index.tsx`, and it must stay that way: ORCH-1063 was a total app freeze
 * caused by an RN `<Modal>` that lived inside the deck-state switch, so a
 * transient deck-state flip unmounted a PRESENTED modal and left an invisible
 * full-screen window eating every touch. A second `<PostExperienceModal>` inside
 * `SwipeableCards` would be that defect again. The other way to reach the single
 * instance is a prop threaded `index.tsx -> HomePage -> SwipeableCards ->
 * BeenHereControl`, which puts a new callback through two memo boundaries
 * (I-TAB-PROPS-STABLE) for a signal neither intermediate component cares about.
 *
 * So the deck WRITES a request here and the single mount READS it — the same
 * shape `bottomNavStore` already uses for a cross-tree UI signal. This is
 * client-only UI state (Constitution rule 5): a request that exists for the
 * lifetime of one modal session, never persisted, never server-derived.
 *
 * NOTHING IN THIS MODULE WRITES TO THE DATABASE, AND THAT IS THE POINT.
 * `openRequest` is what a tap does, and a tap must leave nothing behind — Seth's
 * cancel exists precisely because the tap may be a mistake. Writing on tap and
 * deleting on cancel would race a delete against an insert whose cold path
 * measures 11.8 seconds; that control has already produced #1618, #1642 and
 * #1661. The visit is recorded on CONFIRM, by the modal, in one write
 * (`services/placeReviewService.ts`).
 */

/** A deck card, narrowed to exactly what a voluntary review needs from it. */
export interface PlaceReviewCard {
  id: string;
  title: string;
  category: string;
  image?: string;
  address?: string;
  placeId?: string;
  priceRange?: string | null;
}

export interface VoluntaryPlaceReviewRequest {
  /** `user_visits.experience_id` AND `place_reviews.card_id`. */
  cardId: string;
  placeName: string;
  placeCategory: string;
  placeImage?: string;
  placeAddress?: string;
  /** `place_pool.id`. Present only when the deck served a single place. */
  placePoolId?: string;
  googlePlaceId?: string;
  priceTier?: string;
}

interface PlaceReviewRequestState {
  /** The open request, or null when no voluntary review is in progress. */
  request: VoluntaryPlaceReviewRequest | null;
  /** The card whose review was last CONFIRMED — never set by a cancel. */
  confirmedCardId: string | null;
  /**
   * Monotonic. The deck control flashes "Thank you" when this MOVES, so two
   * confirmations of the same card still flash and a re-mount does not.
   */
  confirmToken: number;
  openRequest: (request: VoluntaryPlaceReviewRequest) => void;
  cancelRequest: () => void;
  confirmRequest: () => void;
}

export const usePlaceReviewRequestStore = create<PlaceReviewRequestState>((set) => ({
  request: null,
  confirmedCardId: null,
  confirmToken: 0,
  openRequest: (request) => set({ request }),
  // Cancel deliberately touches NEITHER confirmedCardId NOR confirmToken: a
  // cancelled tap leaves no write, no flash and no trace of having happened.
  cancelRequest: () => set({ request: null }),
  confirmRequest: () =>
    set((s) =>
      s.request
        ? { request: null, confirmedCardId: s.request.cardId, confirmToken: s.confirmToken + 1 }
        : {},
    ),
}));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Build the request from a deck card.
 *
 * `place_pool_id` is derived, not guessed: on the current serving shape a SINGLE
 * place card's `id` IS its `place_pool.id` (verified in prod — `user_visits`
 * rows for single places carry a `place_pool` uuid in `experience_id`), while a
 * curated card's id is `curated_<type>_<ts>_<rand>` and has no place at all. A
 * non-uuid id therefore yields no `place_pool_id` rather than a fabricated one
 * (Constitution rule 9). `google_place_id` comes only from the card's own
 * `placeId` — never from `card.id`, which would write a uuid into a text column
 * that means something else.
 */
export function placeReviewRequestFromCard(card: PlaceReviewCard): VoluntaryPlaceReviewRequest {
  return {
    cardId: card.id,
    placeName: card.title,
    placeCategory: card.category,
    placeImage: card.image,
    placeAddress: card.address,
    placePoolId: UUID_RE.test(card.id) ? card.id : undefined,
    googlePlaceId: card.placeId,
    priceTier: card.priceRange ?? undefined,
  };
}

/** Subscribe to the open voluntary request (the single modal mount reads this). */
export const usePlaceReviewRequest = (): VoluntaryPlaceReviewRequest | null =>
  usePlaceReviewRequestStore((s) => s.request);

/** Imperative helpers — safe to call from a handler without subscribing. */
export const openPlaceReviewRequest = (request: VoluntaryPlaceReviewRequest): void =>
  usePlaceReviewRequestStore.getState().openRequest(request);
export const cancelPlaceReviewRequest = (): void =>
  usePlaceReviewRequestStore.getState().cancelRequest();
export const confirmPlaceReviewRequest = (): void =>
  usePlaceReviewRequestStore.getState().confirmRequest();
