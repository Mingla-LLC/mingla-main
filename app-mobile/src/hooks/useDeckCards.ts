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
import { useQuery } from '@tanstack/react-query';
import { deckService, DeckResponse } from '../services/deckService';
import { useAppStore } from '../store/appStore';
import type { Recommendation } from '../types/recommendation';
import type { PriceTierSlug } from '../constants/priceTiers';

// Stable empty arrays to prevent new references on every render
const EMPTY_CARDS: Recommendation[] = [];
const EMPTY_PILLS: string[] = [];

interface UseDeckCardsParams {
  location: { lat: number; lng: number } | null;
  categories: string[];
  intents?: string[];
  priceTiers: PriceTierSlug[];
  budgetMin: number;
  budgetMax: number;
  travelMode: string;
  travelConstraintType: 'time';
  travelConstraintValue: number;
  datetimePref?: string;
  dateOption?: string;
  timeSlot?: string | null;
  batchSeed: number;
  enabled: boolean;
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

  // If this exact batch was already fetched, serve it as initialData for instant rendering.
  // Only provide initialData when the hook is enabled — prevents stale persisted batches
  // from leaking through when the user has cleared their category/intent preferences.
  const isEnabled = enabled && location !== null;
  const latestBatch = isEnabled
    ? useAppStore.getState().deckBatches.find(b => b.batchSeed === params.batchSeed)
    : undefined;

  // Round coordinates to 3 decimal places (~110m) in the query key to prevent
  // trivial GPS drift from invalidating the deck cache. Full-precision coords
  // are still passed to queryFn for accurate API results.
  const roundedLat = location ? Math.round(location.lat * 1000) / 1000 : null;
  const roundedLng = location ? Math.round(location.lng * 1000) / 1000 : null;

  const query = useQuery<DeckResponse>({
    queryKey: [
      'deck-cards',
      roundedLat,
      roundedLng,
      params.categories.sort().join(','),
      (params.intents ?? []).sort().join(','),
      (params.priceTiers ?? []).sort().join(','),
      params.budgetMin,
      params.budgetMax,
      params.travelMode,
      params.travelConstraintType,
      params.travelConstraintValue,
      params.datetimePref,
      params.dateOption ?? 'now',
      params.timeSlot ?? '',
      params.batchSeed,
    ],
    queryFn: () =>
      deckService.fetchDeck({
        ...restParams,
        location: location!,
        limit: 20,
      }),
    staleTime: 30 * 60 * 1000,     // 30 minutes
    gcTime: 2 * 60 * 60 * 1000,    // 2 hours
    enabled: isEnabled,
    retry: 1,
    placeholderData: (previousData) => previousData,
    initialData: latestBatch ? {
      cards: latestBatch.cards,
      deckMode: 'mixed' as const,
      activePills: latestBatch.activePills,
      total: latestBatch.cards.length,
      hasMore: true,
    } : undefined,
    initialDataUpdatedAt: latestBatch?.timestamp,
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
