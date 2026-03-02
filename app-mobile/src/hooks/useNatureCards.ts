import { useQuery } from '@tanstack/react-query';
import { natureCardsService, NatureCard } from '../services/natureCardsService';

interface UseNatureCardsParams {
  location: { lat: number; lng: number } | null;
  budgetMax: number;
  travelMode: string;
  travelConstraintType: 'time' | 'distance';
  travelConstraintValue: number;
  datetimePref?: string;
  dateOption?: string;
  timeSlot?: string | null;
  batchSeed?: number;
  enabled: boolean;
}

/**
 * Standalone hook for Nature cards.
 * Uses the dedicated `discover-nature` edge function.
 * Follows the same caching/batching patterns as useCuratedExperiences.
 */
export function useNatureCards(params: UseNatureCardsParams): {
  cards: NatureCard[];
  isLoading: boolean;
  isFullBatchLoaded: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { location, enabled, ...restParams } = params;

  const query = useQuery<NatureCard[]>({
    queryKey: [
      'nature-cards',
      location?.lat,
      location?.lng,
      params.budgetMax,
      params.travelMode,
      params.travelConstraintType,
      params.travelConstraintValue,
      params.datetimePref,
      params.batchSeed ?? 0,
      params.dateOption ?? 'now',
      params.timeSlot ?? '',
    ],
    queryFn: () =>
      natureCardsService.discoverNature({
        ...restParams,
        location: location!,
        limit: 20,
      }),
    staleTime: 30 * 60 * 1000,   // 30 minutes
    gcTime: 2 * 60 * 60 * 1000,  // 2 hours
    enabled: enabled && location !== null,
    retry: 2,
    placeholderData: (previousData) => previousData,
  });

  return {
    cards: query.data ?? [],
    isLoading: query.isLoading,
    isFullBatchLoaded: !query.isLoading && !query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
