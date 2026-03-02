/**
 * useDeckCards — Single React Query hook for the solo swipeable deck.
 *
 * Replaces 7+ independent hooks (5 curated + 1 nature + 1 regular) with
 * ONE query key, ONE loading state, and smooth transitions via placeholderData.
 *
 * Card conversion now happens inside deckService.fetchDeck() — this hook
 * receives ready-to-use Recommendation[] directly.
 */
import { useQuery } from '@tanstack/react-query';
import { deckService, DeckResponse } from '../services/deckService';
import { useAppStore } from '../store/appStore';
import type { Recommendation } from '../types/recommendation';

interface UseDeckCardsParams {
  location: { lat: number; lng: number } | null;
  categories: string[];
  budgetMin: number;
  budgetMax: number;
  travelMode: string;
  travelConstraintType: 'time' | 'distance';
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
  error: Error | null;
  refetch: () => void;
}

export function useDeckCards(params: UseDeckCardsParams): UseDeckCardsResult {
  const { location, enabled, ...restParams } = params;

  // If this exact batch was already fetched, serve it as initialData for instant rendering
  const latestBatch = useAppStore.getState().deckBatches.find(
    b => b.batchSeed === params.batchSeed
  );

  const query = useQuery<DeckResponse>({
    queryKey: [
      'deck-cards',
      location?.lat,
      location?.lng,
      params.categories.sort().join(','),
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
    enabled: enabled && location !== null,
    retry: 2,
    placeholderData: (previousData) => previousData,
    initialData: latestBatch ? {
      cards: latestBatch.cards,
      deckMode: 'mixed' as const,
      activePills: latestBatch.activePills,
      total: latestBatch.cards.length,
    } : undefined,
    initialDataUpdatedAt: latestBatch?.timestamp,
  });

  return {
    cards: query.data?.cards ?? [],
    deckMode: query.data?.deckMode ?? 'curated',
    activePills: query.data?.activePills ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFullBatchLoaded: !query.isLoading && !query.isFetching && query.data !== undefined,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
