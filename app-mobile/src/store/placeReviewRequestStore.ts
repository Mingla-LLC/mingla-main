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
   * #1687 rework 3 — THERE IS DELIBERATELY NO `hadVisitBeforeTap` HERE ANY MORE.
   *
   * Rework 2 carried `useHasVisited`'s pre-tap answer through this request so the
   * write could decide whether a half-landed visit was its own to delete. That
   * query is cached for TEN MINUTES (`useVisits.ts:80`), so the answer can be a
   * stale `false` over a visit the user really made — and on device it destroyed
   * one that was three days old (`99081740`, deleted 21:57:01.253). The field is
   * gone because the write it fed is gone: a refused review now keeps the visit
   * and tells the user, and nothing on this path deletes anything.
   */
}

interface PlaceReviewRequestState {
  /** The open request, or null when no voluntary review is in progress. */
  request: VoluntaryPlaceReviewRequest | null;
  /**
   * #4381 — what the single prompt mount RENDERS. It is the open request, and
   * it outlives a cancel or confirm until the prompt has natively dismissed, so
   * the presented RN Modal is never unmounted mid-presentation (ORCH-1063) and
   * its native dismiss callback still arrives.
   */
  displayRequest: VoluntaryPlaceReviewRequest | null;
  /**
   * #4381 — how many RN-Modal hosts are natively presented right now and hold
   * the iOS presentation slot (the expanded card's root sheet). iOS refuses to
   * present a second RN Modal from a view controller that is already presenting
   * one, so the prompt is not told to present until this is zero. A host adds
   * itself on its native show and removes itself on its native dismiss.
   */
  slotHolds: number;
  /** #4381 — the prompt's own native presentation (onShow seen, dismiss not yet). */
  promptOnScreen: boolean;
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
  holdSlot: () => void;
  releaseSlot: () => void;
  promptShown: () => void;
  promptDismissed: () => void;
}

export const usePlaceReviewRequestStore = create<PlaceReviewRequestState>((set) => ({
  request: null,
  displayRequest: null,
  slotHolds: 0,
  promptOnScreen: false,
  confirmedCardId: null,
  confirmToken: 0,
  openRequest: (request) => set({ request, displayRequest: request }),
  // Cancel deliberately touches NEITHER confirmedCardId NOR confirmToken: a
  // cancelled tap leaves no write, no flash and no trace of having happened.
  // The rendered request is kept only while the prompt is still on screen.
  cancelRequest: () =>
    set((s) => ({ request: null, displayRequest: s.promptOnScreen ? s.displayRequest : null })),
  confirmRequest: () =>
    set((s) =>
      s.request
        ? {
            request: null,
            displayRequest: s.promptOnScreen ? s.displayRequest : null,
            confirmedCardId: s.request.cardId,
            confirmToken: s.confirmToken + 1,
          }
        : {},
    ),
  holdSlot: () => set((s) => ({ slotHolds: s.slotHolds + 1 })),
  releaseSlot: () => set((s) => ({ slotHolds: Math.max(0, s.slotHolds - 1) })),
  // Only a voluntary prompt is tracked; the scheduled prompt shares the mount
  // but renders no displayRequest, so its show and dismiss change nothing here.
  promptShown: () => set((s) => (s.displayRequest !== null ? { promptOnScreen: true } : {})),
  promptDismissed: () =>
    set((s) => ({
      promptOnScreen: false,
      displayRequest: s.request !== null ? s.displayRequest : null,
    })),
}));

type PresentationState = Pick<
  PlaceReviewRequestState,
  'request' | 'slotHolds' | 'promptOnScreen'
>;

/**
 * #4381 — the prompt may be told to present only when a request is open AND no
 * RN-Modal host still holds the presentation slot. On device, presenting in the
 * same commit that dismissed the expanded card raced iOS ("Attempt to present
 * ... which is already presenting"), the prompt never appeared, and the request
 * stayed open for good.
 */
export const isPromptPresentable = (s: PresentationState): boolean =>
  s.request !== null && s.slotHolds === 0;

/**
 * #4381 — a host steps aside while a request is open AND while the prompt is
 * still natively on screen after it closed, so the host re-presents only after
 * the prompt's own native dismiss.
 */
export const isHostSuspendedForPrompt = (s: PresentationState): boolean =>
  s.request !== null || s.promptOnScreen;

/** #4381 — bound for each wait: the slot to free, the prompt to show, the prompt to go. */
export const PLACE_REVIEW_PRESENTATION_TIMEOUT_MS = 1500;

interface PresentationTimers {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const defaultTimers: PresentationTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * #4381 — safety net (Constitution rule 3). A request that is open but never
 * natively shown would keep every host suspended, so the user could tap
 * nothing until a restart. Each wait is bounded:
 *
 *  - the slot never frees, or the prompt never reports onShow (an outer full-
 *    screen sheet such as SessionViewModal holds the slot): the request is
 *    cancelled, so whatever stepped aside comes back, and `onPresentFailed`
 *    tells the user;
 *  - the prompt closed but its native dismiss never arrives: it is treated as
 *    dismissed, so the host comes back.
 *
 * The deadline restarts whenever the phase changes, so a slow host dismiss does
 * not eat the prompt's own time to show. Returns the unsubscribe.
 */
export function watchPlaceReviewPresentation(
  onPresentFailed: () => void,
  timeoutMs: number = PLACE_REVIEW_PRESENTATION_TIMEOUT_MS,
  timers: PresentationTimers = defaultTimers,
): () => void {
  let handle: unknown = null;
  let armedPhase: string | null = null;
  let armedRequest: VoluntaryPlaceReviewRequest | null = null;

  const disarm = (): void => {
    if (handle !== null) timers.clear(handle);
    handle = null;
    armedPhase = null;
    armedRequest = null;
  };

  const evaluate = (s: PlaceReviewRequestState): void => {
    const phase =
      s.request !== null && !s.promptOnScreen
        ? s.slotHolds > 0
          ? 'awaiting_slot'
          : 'awaiting_show'
        : s.request === null && s.promptOnScreen
          ? 'awaiting_dismiss'
          : null;
    if (phase === armedPhase && s.request === armedRequest) return;
    disarm();
    if (phase === null) return;
    armedPhase = phase;
    armedRequest = s.request;
    handle = timers.set(() => {
      handle = null;
      const now = usePlaceReviewRequestStore.getState();
      if (phase === 'awaiting_dismiss') {
        if (now.request === null && now.promptOnScreen) {
          console.warn('[place-review] prompt dismiss was not reported; releasing the host');
          now.promptDismissed();
        }
        return;
      }
      if (now.request !== null && now.request === armedRequest && !now.promptOnScreen) {
        console.warn('[place-review] prompt did not present', { phase });
        now.cancelRequest();
        onPresentFailed();
      }
    }, timeoutMs);
  };

  evaluate(usePlaceReviewRequestStore.getState());
  const unsubscribe = usePlaceReviewRequestStore.subscribe(evaluate);
  return () => {
    unsubscribe();
    disarm();
  };
}

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
 * #1687 rework 3 — ONE ARGUMENT. The second one carried what `useHasVisited` had
 * answered before the tap, and existed solely so a failed review could decide
 * whether to delete the visit. Nothing deletes the visit any more, so there is
 * nothing for a pre-tap belief to authorise, and a ten-minute-stale belief has no
 * way back into this path.
 */
export function placeReviewRequestFromCard(
  card: PlaceReviewCard,
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
  };
}

/** Subscribe to the open voluntary request. */
export const usePlaceReviewRequest = (): VoluntaryPlaceReviewRequest | null =>
  usePlaceReviewRequestStore((s) => s.request);

/** #4381 — the request the single modal mount renders (outlives close until native dismiss). */
export const usePlaceReviewDisplayRequest = (): VoluntaryPlaceReviewRequest | null =>
  usePlaceReviewRequestStore((s) => s.displayRequest);

/** #4381 — the single modal mount presents only when this is true. */
export const usePlaceReviewPromptPresentable = (): boolean =>
  usePlaceReviewRequestStore(isPromptPresentable);

/** #4381 — an RN-Modal host (the expanded card) steps aside while this is true. */
export const usePlaceReviewSuspendsHost = (): boolean =>
  usePlaceReviewRequestStore(isHostSuspendedForPrompt);

/** Imperative helpers — safe to call from a handler without subscribing. */
export const openPlaceReviewRequest = (request: VoluntaryPlaceReviewRequest): void =>
  usePlaceReviewRequestStore.getState().openRequest(request);
export const cancelPlaceReviewRequest = (): void =>
  usePlaceReviewRequestStore.getState().cancelRequest();
export const confirmPlaceReviewRequest = (): void =>
  usePlaceReviewRequestStore.getState().confirmRequest();

/** #4381 — native acknowledgements from the slot holder and from the prompt. */
export const holdPlaceReviewSlot = (): void =>
  usePlaceReviewRequestStore.getState().holdSlot();
export const releasePlaceReviewSlot = (): void =>
  usePlaceReviewRequestStore.getState().releaseSlot();
export const markPlaceReviewPromptShown = (): void =>
  usePlaceReviewRequestStore.getState().promptShown();
export const markPlaceReviewPromptDismissed = (): void =>
  usePlaceReviewRequestStore.getState().promptDismissed();
