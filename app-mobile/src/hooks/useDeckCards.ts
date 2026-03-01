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
  deckMode: 'nature' | 'curated' | 'mixed';
  activePills: string[];
  isLoading: boolean;
  isFetching: boolean;
  isFullBatchLoaded: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useDeckCards(params: UseDeckCardsParams): UseDeckCardsResult {
  const { location, enabled, ...restParams } = params;

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
  });

  return {
    cards: query.data?.cards ?? [],
    deckMode: query.data?.deckMode ?? 'curated',
    activePills: query.data?.activePills ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFullBatchLoaded: (query.data?.total ?? 0) >= (20 * 0.5),
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
