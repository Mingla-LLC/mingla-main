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
  /**
   * The deck's own discriminator, carried verbatim off the card. `'curated'` and
   * `'experience'` are set by `deckService`; a single pool place carries none.
   * Read here so a place identity is never INFERRED — see `resolvePlacePoolId`.
   */
  cardType?: string;
  /**
   * `place_pool.id`, set by the producer that KNOWS the card is a pool place
   * (`deckService.unifiedCardToRecommendation`). When present it is used verbatim.
   */
  placePoolId?: string;
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
  /**
   * #1687 rework 2 (P1-2) — WHAT `useHasVisited` SAID AT THE MOMENT OF THE TAP.
   *
   * Captured here, before anything is written, because this is the only moment
   * the answer is knowable for free: `BeenHereControl` has already read
   * `useHasVisited` to choose its own label. `false` means the user had no visit
   * for this card, so anything in `user_visits` after the submit was put there by
   * the submit; `true` means they already had one and it must never be deleted on
   * their behalf. Absent means the control could not answer (the query errored)
   * and the write falls back to `record-visit`'s `isNew` — see
   * `visitIsOursToUndo` in `services/placeReviewService.ts` for why that fallback
   * is a last resort and not the rule.
   */
  hadVisitBeforeTap?: boolean;
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
 * The ONE card type whose `id` is a `place_pool.id`. Every other type the deck
 * serves — and every type added after this line was written — must declare
 * itself, and declaring anything else yields NO place anchor at all.
 */
const SINGLE_PLACE_CARD_TYPE = 'place';

/**
 * `place_reviews.place_pool_id` carries a LIVE foreign key to `place_pool(id)`,
 * so a value that is merely uuid-SHAPED is not an answer — it is a row Postgres
 * will refuse with 23503 after the visit has already landed.
 *
 * The original derivation was `UUID_RE.test(card.id) ? card.id : undefined`, and
 * it was wrong on the fourth card type. The deck serves four: a pool place, a
 * claimed venue (both `place_pool` rows, so `card.id` IS the place), a curated
 * plan (`curated_<type>_<ts>_<rand>` — not uuid-shaped, so it fell out
 * correctly by accident) and a BRAND EXPERIENCE, which `discover-cards`
 * builds with `id: String(row.event_id)`. An `events.id` is uuid-shaped and is
 * not a place: 0 of the 65 `events` rows in production exist in `place_pool`.
 * `BeenHereControl` renders on that tree ungated, so the shape test would have
 * written an `events.id` into a `place_pool` foreign key.
 *
 * So identity is no longer inferred from a string. In order:
 *
 *  1. A card that DECLARES a type other than `'place'` yields nothing, whatever
 *     its id looks like. This is the rule that closes the class rather than the
 *     instance — a fifth card type is refused before anyone has to remember it.
 *  2. A card that CARRIES its `place_pool.id` is believed. `deckService`
 *     attaches it in the single-place branch, which is the only place in the
 *     pipeline that knows the id is a pool row.
 *  3. [TRANSITIONAL] a card with no declared type and no carried id falls back
 *     to the shape test, because not every producer of a place card goes through
 *     `deckService.unifiedCardToRecommendation` (saved cards, collab decks and
 *     seeded decks all rebuild the shape). Exit condition: delete this branch
 *     once every place-card producer sets `placePoolId` — tracked on #1687.
 *
 * `google_place_id` comes only from the card's own `placeId` — never from
 * `card.id`, which would write a uuid into a text column that means something
 * else. A card that yields neither is written with NULLs, never a guess
 * (Constitution rule 9).
 */
function resolvePlacePoolId(card: PlaceReviewCard): string | undefined {
  if (typeof card.cardType === 'string' && card.cardType !== SINGLE_PLACE_CARD_TYPE) {
    return undefined;
  }
  if (typeof card.placePoolId === 'string' && UUID_RE.test(card.placePoolId)) {
    return card.placePoolId;
  }
  return UUID_RE.test(card.id) ? card.id : undefined;
}

/**
 * Build the request from a deck card.
 *
 * `hadVisitBeforeTap` is the SECOND argument and not another card field on
 * purpose: it is not a property of the card, it is what the app knew about this
 * user and this card in the instant the tap happened. The caller passes
 * `useHasVisited`'s value straight through, `undefined` included — an unknown
 * must stay an unknown rather than be flattened into a `false` the rollback would
 * then act on.
 */
export function placeReviewRequestFromCard(
  card: PlaceReviewCard,
  hadVisitBeforeTap?: boolean,
): VoluntaryPlaceReviewRequest {
  return {
    cardId: card.id,
    placeName: card.title,
    placeCategory: card.category,
    placeImage: card.image,
    placeAddress: card.address,
    placePoolId: resolvePlacePoolId(card),
    googlePlaceId: card.placeId,
    priceTier: card.priceRange ?? undefined,
    hadVisitBeforeTap,
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
