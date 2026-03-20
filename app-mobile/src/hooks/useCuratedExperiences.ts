import { useQuery } from '@tanstack/react-query';
import { curatedExperiencesService } from '../services/curatedExperiencesService';
import type { CuratedExperienceCard } from '../types/curatedExperience';

export type CuratedExperienceType =
  | 'adventurous'
  | 'first-date'
  | 'romantic'
  | 'group-fun'
  | 'picnic-dates'
  | 'take-a-stroll';

interface UseCuratedExperiencesParams {
  experienceType: CuratedExperienceType;
  location: { lat: number; lng: number } | null;
  budgetMin: number;
  budgetMax: number;
  travelMode: string;
  travelConstraintType: 'time';
  travelConstraintValue: number;
  datetimePref?: string;
  enabled: boolean;
  batchSeed?: number;
  sessionId?: string;
  selectedCategories?: string[];
}

/**
 * Single-shot curated-experiences loader (Turbo Pipeline).
 *
 * Replaces the previous dual-batch (priority + background) approach.
 * With pool pre-warming, cards return in <500ms from pool.
 * On cold miss, 4 parallel super-category API calls return in 1-2s.
 */
export function useCuratedExperiences(params: UseCuratedExperiencesParams): {
  cards: CuratedExperienceCard[];
  isLoading: boolean;
  isFullBatchLoaded: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { location, enabled, ...restParams } = params;

  const query = useQuery<CuratedExperienceCard[]>({
    queryKey: [
      'curated-experiences',
      params.experienceType,
      params.sessionId ?? 'solo',
      location?.lat,
      location?.lng,
      params.budgetMin,
      params.budgetMax,
      params.travelMode,
      params.travelConstraintType,
      params.travelConstraintValue,
      params.datetimePref,
      params.batchSeed ?? 0,
      params.selectedCategories?.sort().join(',') ?? '',
    ],
    queryFn: () =>
      curatedExperiencesService.generateCuratedExperiences({
        ...restParams,
        location: location!,
        limit: 20,
        skipDescriptions: true,
      }),
    staleTime: 30 * 60 * 1000,    // 30 minutes
    gcTime: 2 * 60 * 60 * 1000,   // 2 hours
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
