/**
 * useDeckCards — Single React Query hook for the solo swipeable deck.
 *
 * Replaces 7+ independent hooks (5 curated + 1 nature + 1 regular) with
 * ONE query key, ONE loading state, and smooth transitions via placeholderData.
 *
 * Why this fixes the race conditions:
 * 1. One hook = one lifecycle — no interdependent enabled gates
 * 2. Query key includes ALL prefs — key changes = auto-refetch
 * 3. placeholderData — old cards visible during transition, no empty deck
 * 4. Server (deckService) determines mode — no client-side derivation race
 * 5. Single isLoading — no allBatchesLoaded computation across 7 hooks
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { deckService, DeckResponse } from '../services/deckService';
import type { Recommendation } from '../types/recommendation';
import { natureToRecommendation, curatedToRecommendation } from '../utils/cardConverters';

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
  deckMode: 'nature' | 'curated';
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

  // Map server cards to Recommendation[] based on deckMode
  const cards: Recommendation[] = useMemo(() => {
    if (!query.data?.cards) return [];
    const deckMode = query.data.deckMode;
    return query.data.cards.map(card =>
      deckMode === 'nature'
        ? natureToRecommendation(card as any)
        : curatedToRecommendation(card as any)
    );
  }, [query.data]);

  return {
    cards,
    deckMode: query.data?.deckMode ?? 'curated',
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFullBatchLoaded: !query.isLoading && !query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
