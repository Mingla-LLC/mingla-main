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
import { deckService, DeckResponse } from '../services/deckService';
import type { Recommendation } from '../types/recommendation';
import type { PriceTierSlug } from '../constants/priceTiers';
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
  priceTiers: string[];
  budgetMin: number;
  budgetMax: number;
  travelMode: string;
  travelConstraintType: string;
  travelConstraintValue: number;
  datetimePref?: string;
  dateOption?: string;
  timeSlots?: string[];
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
    [...(params.priceTiers ?? [])].sort().join(','),
    params.budgetMin,
    params.budgetMax,
    params.travelMode,
    params.travelConstraintType,
    params.travelConstraintValue,
    nd,
    params.dateOption ?? 'now',
    [...(params.timeSlots ?? [])].sort().join(','),
    params.batchSeed,
    [...(params.excludeCardIds ?? [])].sort().join(','),
  ] as const;
}

interface UseDeckCardsParams {
  location: { lat: number; lng: number } | null;
  categories: string[];
  intents?: string[];
  priceTiers: PriceTierSlug[];
  budgetMin: number; // Always 0 — not used for card filtering. Cards filtered by priceTiers instead.
  budgetMax: number;
  travelMode: string;
  travelConstraintType: 'time';
  travelConstraintValue: number;
  datetimePref?: string;
  dateOption?: string;
  timeSlots?: string[];
  batchSeed: number;
  enabled: boolean;
  excludeCardIds?: string[];
  /** Persisted query key from last session — enables instant cache read on cold start
   *  before location resolves. Only set after proximity check confirms same location.
   *  ORCH-0391. */
  lastKnownQueryKey?: readonly unknown[] | null;
}

export interface UseDeckCardsResult {
  cards: Recommendation[];
  deckMode: DeckResponse['deckMode'];
  activePills: string[];
  isLoading: boolean;
  isFetching: boolean;
  isFullBatchLoaded: boolean;
  hasMore: boolean;
  error: Error | null;
  refetch: () => void;
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
        priceTiers: params.priceTiers ?? [],
        budgetMin: params.budgetMin,
        budgetMax: params.budgetMax,
        travelMode: params.travelMode,
        travelConstraintType: params.travelConstraintType,
        travelConstraintValue: params.travelConstraintValue,
        datetimePref: params.datetimePref,
        dateOption: params.dateOption,
        timeSlots: params.timeSlots,
        batchSeed: params.batchSeed,
        excludeCardIds: params.excludeCardIds,
      })
    : (params.lastKnownQueryKey ?? ['deck-cards', null]);

  const query = useQuery<DeckResponse>({
    queryKey,
    queryFn: () => {
      // Use the same queryKey for onSinglesReady partial cache updates
      const qk = queryKey;

      return deckService.fetchDeck(
        {
          ...restParams,
          location: location!,
          limit: 10000, // Phase 5: return all matching cards, no artificial cap
        },
        // onSinglesReady: deliver partial results to cache immediately.
        // User sees cards in ~1s while curated continues loading. ORCH-0340.
        (singlesCards) => {
          if (singlesCards.length > 0) {
            queryClient.setQueryData<DeckResponse>(qk, (prev) => ({
              cards: singlesCards,
              deckMode: prev?.deckMode ?? 'mixed',
              activePills: prev?.activePills ?? [],
              total: singlesCards.length,
              hasMore: true,
            }));
          }
        },
      );
    },
    staleTime: Infinity,            // Deck only refreshes on explicit preference change (query key changes). Never auto-refetch — deck is an active swipe session, not a feed.
    gcTime: 24 * 60 * 60 * 1000,   // 24 hours — matches AsyncStorage maxAge so persisted data stays usable
    enabled: isEnabled,
    retry: 1,
    placeholderData: (previousData) => previousData,
  });

  const cards = query.data?.cards ?? EMPTY_CARDS;
  const activePills = query.data?.activePills ?? EMPTY_PILLS;
  const hasData = query.data !== undefined;

  return useMemo(() => ({
    cards,
    deckMode: query.data?.deckMode ?? 'curated',
    activePills,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFullBatchLoaded: !query.isLoading && !query.isFetching && hasData,
    hasMore: query.data?.hasMore ?? true,
    error: query.error as Error | null,
    refetch: query.refetch,
  }), [cards, activePills, query.data?.deckMode, query.data?.hasMore, query.isLoading, query.isFetching, hasData, query.error, query.refetch]);
}
