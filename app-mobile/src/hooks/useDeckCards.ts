/**
 * useDeckCards — Single React Query hook for the solo swipeable deck.
 *
 * Replaces 7+ independent hooks (5 curated + 1 nature + 1 regular) with
 * ONE query key, ONE loading state, and smooth transitions via placeholderData.
 *
 * Card conversion now happens inside deckService.fetchDeck() — this hook
 * receives ready-to-use Recommendation[] directly.
 */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { deckService, DeckResponse, DeckServerPath, mergeCardsByIdPreservingOrder } from '../services/deckService';
import type { Recommendation } from '../types/recommendation';
import { normalizeDateTime } from '../utils/cardConverters';

// Stable empty arrays to prevent new references on every render
const EMPTY_CARDS: Recommendation[] = [];
const EMPTY_PILLS: string[] = [];

/**
 * Builds the exact React Query key for a deck-cards query. Exported so that
 * onboarding prefetch can pre-seed the cache with the identical key shape.
 * Any divergence between this function and the hook's queryKey means a silent
 * cache miss — never construct the key independently. ORCH-0386.
 */
export interface DeckQueryKeyParams {
  lat: number;
  lng: number;
  categories: string[];
  intents: string[];
  travelMode: string;
  travelConstraintType: string;
  travelConstraintValue: number;
  datetimePref?: string;
  dateOption?: string;
  batchSeed: number;
  excludeCardIds?: string[];
}

export function buildDeckQueryKey(params: DeckQueryKeyParams): readonly unknown[] {
  const roundedLat = Math.round(params.lat * 1000) / 1000;
  const roundedLng = Math.round(params.lng * 1000) / 1000;
  const nd = params.datetimePref
    ? normalizeDateTime(params.datetimePref)
    : undefined;

  return [
    'deck-cards',
    roundedLat,
    roundedLng,
    [...params.categories].sort().join(','),
    [...params.intents].sort().join(','),
    params.travelMode,
    params.travelConstraintType,
    params.travelConstraintValue,
    nd,
    params.dateOption ?? 'today',
    params.batchSeed,
    [...(params.excludeCardIds ?? [])].sort().join(','),
  ] as const;
}

interface UseDeckCardsParams {
  location: { lat: number; lng: number } | null;
  categories: string[];
  intents?: string[];
  travelMode: string;
  travelConstraintType: 'time';
  travelConstraintValue: number;
  datetimePref?: string;
  dateOption?: string;
  batchSeed: number;
  enabled: boolean;
  excludeCardIds?: string[];
  /** Persisted query key from last session — enables instant cache read on cold start
   *  before location resolves. Only set after proximity check confirms same location.
   *  ORCH-0391. */
  lastKnownQueryKey?: readonly unknown[] | null;
  /** ORCH-0446: Array of date windows for AND intersection (collab only). */
  dateWindows?: string[];
  /** ORCH-0446: Session ID for analytics tracking (collab only). */
  sessionId?: string;
}

export interface UseDeckCardsResult {
  cards: Recommendation[];
  deckMode: DeckResponse['deckMode'];
  activePills: string[];
  isLoading: boolean;
  isFetching: boolean;
  /** ORCH-0451: true when displayed data comes from placeholderData (previous query key),
   *  false when it's genuine cached data or fresh fetch results. Consumers must NOT
   *  treat placeholder data as trustworthy — it may be from a different preference set. */
  isPlaceholderData: boolean;
  isFullBatchLoaded: boolean;
  hasMore: boolean;
  error: Error | null;
  refetch: () => void;
  /** ORCH-0474: Which server code path produced this result. Consumers branch
   *  UI on this value (AUTH_REQUIRED banner, PIPELINE_ERROR toast, EMPTY, etc.)
   *  rather than inferring state from (cards.length, hasMore). Derived from
   *  query.data?.serverPath on success, or from the tagged DeckFetchError
   *  on failure. Undefined when the query has no result yet (still loading,
   *  or disabled). */
  serverPath?: DeckServerPath;
}

export function useDeckCards(params: UseDeckCardsParams): UseDeckCardsResult {
  const { location, enabled, ...restParams } = params;
  const queryClient = useQueryClient();

  const isEnabled = enabled && location !== null;

  // Build query key using the shared function — guarantees identical key shape
  // between this hook and onboarding prefetch (ORCH-0386).
  // On cold start before location resolves, use lastKnownQueryKey (from persisted
  // session state, proximity-checked) to read hydrated cache instantly. ORCH-0391.
  const queryKey = location
    ? buildDeckQueryKey({
        lat: location.lat,
        lng: location.lng,
        categories: params.categories,
        intents: params.intents ?? [],
        travelMode: params.travelMode,
        travelConstraintType: params.travelConstraintType,
        travelConstraintValue: params.travelConstraintValue,
        datetimePref: params.datetimePref,
        dateOption: params.dateOption,
        batchSeed: params.batchSeed,
        excludeCardIds: params.excludeCardIds,
      })
    : (params.lastKnownQueryKey ?? ['deck-cards', null]);

  const query = useQuery<DeckResponse>({
    queryKey,
    queryFn: () => {
      // Use the same queryKey for onPartialReady progressive cache merges
      const qk = queryKey;

      return deckService.fetchDeck(
        {
          ...restParams,
          location: location!,
          limit: 10000, // Phase 5: return all matching cards, no artificial cap
        },
        // ORCH-0490 Phase 2.2: onPartialReady fires up to TWICE per fetchDeck
        // — once when singles settles (if ok, non-empty), once when curated
        // settles. Order is race-determined. Each arrival MERGES into the
        // cache via mergeCardsByIdPreservingOrder (not replace) so existing
        // card positions are preserved through the second arrival.
        // The final fetchDeck promise resolution produces the authoritative
        // interleaved return value — React Query writes that on success,
        // overwriting the merged intermediate state. (Phase 2.3 will add an
        // expansion signal so the SwipeableCards first-5-IDs wipe doesn't
        // fire on this intermediate→final transition.)
        (cards, meta) => {
          if (cards.length === 0) return;
          queryClient.setQueryData<DeckResponse>(qk, (prev) => ({
            cards: mergeCardsByIdPreservingOrder(prev?.cards ?? [], cards),
            deckMode: prev?.deckMode ?? 'mixed',
            activePills: prev?.activePills ?? [],
            total: (prev?.cards?.length ?? 0) + cards.length,
            hasMore: prev?.hasMore ?? true,
            // ORCH-0474 + ORCH-0486: serverPath from prev is preserved — the
            // final fetchDeck return replaces this with the authoritative
            // discriminant. During partial delivery we default to 'pipeline'
            // since partial success implies the pipeline responded with data.
            serverPath: prev?.serverPath ?? 'pipeline',
          }));
          if (__DEV__) {
            console.log(`[useDeckCards] partial delivery: +${cards.length} cards from ${meta.source}`);
          }
        },
      );
    },
    // staleTime: Infinity is SAFE ONLY because empty deck-cards responses are
    // blocked from AsyncStorage persistence in app/index.tsx:shouldDehydrateQuery
    // (ORCH-0469). The ORCH-0474 extension covers ALL three non-populated paths
    // (pool-empty, auth-required, pipeline-error) — each returns cards:[] and
    // each is already excluded by the existing length-check guard. Do not pair
    // Infinity + persistence + response-can-be-empty without that guard — it
    // produces permanent warm-session poisoning.
    // Deck only refreshes on explicit preference change (query key changes).
    // Never auto-refetch — deck is an active swipe session, not a feed.
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,   // 24 hours — matches AsyncStorage maxAge so persisted data stays usable
    enabled: isEnabled,
    retry: 1,
    placeholderData: (previousData) => previousData,
  });

  const cards = query.data?.cards ?? EMPTY_CARDS;
  const activePills = query.data?.activePills ?? EMPTY_PILLS;
  const hasData = query.data !== undefined;

  // ORCH-0474: serverPath comes from query.data on success, or from the
  // tagged DeckFetchError on failure. DeckFetchError.serverPath is 'auth-required'
  // or 'pipeline-error'; normal error (e.g. React Query retry envelope) falls
  // through as undefined.
  const resolvedServerPath: DeckServerPath | undefined =
    query.data?.serverPath ??
    (query.error as (Error & { serverPath?: DeckServerPath }) | null)?.serverPath;

  return useMemo(() => ({
    cards,
    deckMode: query.data?.deckMode ?? 'curated',
    activePills,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isPlaceholderData: query.isPlaceholderData,
    isFullBatchLoaded: !query.isLoading && !query.isFetching && hasData,
    hasMore: query.data?.hasMore ?? true,
    error: query.error as Error | null,
    refetch: query.refetch,
    serverPath: resolvedServerPath,
  }), [cards, activePills, query.data?.deckMode, query.data?.hasMore, query.isLoading, query.isFetching, query.isPlaceholderData, hasData, query.error, query.refetch, resolvedServerPath]);
}
