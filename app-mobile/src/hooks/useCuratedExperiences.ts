import { useQuery } from '@tanstack/react-query';
import { curatedExperiencesService } from '../services/curatedExperiencesService';
import type { CuratedExperienceCard } from '../types/curatedExperience';

export type CuratedExperienceType =
  | 'solo-adventure'
  | 'first-dates'
  | 'romantic'
  | 'friendly'
  | 'group-fun';

interface UseCuratedExperiencesParams {
  experienceType: CuratedExperienceType;
  location: { lat: number; lng: number } | null;
  budgetMin: number;
  budgetMax: number;
  travelMode: string;
  travelConstraintType: 'time' | 'distance';
  travelConstraintValue: number;
  enabled: boolean;
}

export function useCuratedExperiences(params: UseCuratedExperiencesParams): {
  cards: CuratedExperienceCard[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { location, enabled, ...restParams } = params;

  const query = useQuery({
    queryKey: [
      'curated-experiences',
      params.experienceType,
      location?.lat,
      location?.lng,
      params.budgetMin,
      params.budgetMax,
    ],
    queryFn: () =>
      curatedExperiencesService.generateCuratedExperiences({
        ...restParams,
        location: location!,
      }),
    enabled: enabled && location !== null,
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
  });

  return {
    cards: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
