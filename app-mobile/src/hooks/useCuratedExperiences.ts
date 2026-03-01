import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { curatedExperiencesService } from '../services/curatedExperiencesService';
import type { CuratedExperienceCard } from '../types/curatedExperience';

export type CuratedExperienceType =
  | 'solo-adventure'
  | 'first-dates'
  | 'romantic'
  | 'friendly'
  | 'group-fun';

/** How many cards to fetch in the fast priority batch */
const PRIORITY_LIMIT = 3;
/** How many cards to fetch in the slower background batch */
const BACKGROUND_LIMIT = 17;

interface UseCuratedExperiencesParams {
  experienceType: CuratedExperienceType;
  location: { lat: number; lng: number } | null;
  budgetMin: number;
  budgetMax: number;
  travelMode: string;
  travelConstraintType: 'time' | 'distance';
  travelConstraintValue: number;
  enabled: boolean;
  batchSeed?: number;
}

/**
 * Progressive curated-experiences loader.
 *
 * Makes two parallel edge-function calls:
 *   1. **Priority batch** (3 cards) — returns in ~3-5 s, unblocks the spinner.
 *   2. **Background batch** (17 cards) — loads silently, cards appear as the
 *      user swipes through the first three.
 *
 * `isLoading` only reflects the priority batch so the spinner clears fast.
 */
export function useCuratedExperiences(params: UseCuratedExperiencesParams): {
  cards: CuratedExperienceCard[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { location, enabled, ...restParams } = params;

  const baseQueryKey = [
    'curated-experiences',
    params.experienceType,
    location?.lat,
    location?.lng,
    params.budgetMin,
    params.budgetMax,
    params.batchSeed ?? 0,
  ];

  // ── Priority batch (fast, ~3-5 s) ──────────────────────────────────────
  const priorityQuery = useQuery({
    queryKey: [...baseQueryKey, 'priority'],
    queryFn: () =>
      curatedExperiencesService.generateCuratedExperiences({
        ...restParams,
        location: location!,
        limit: PRIORITY_LIMIT,
      }),
    enabled: enabled && location !== null,
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
  });

  // ── Background batch (remaining cards) ─────────────────────────────────
  const backgroundQuery = useQuery({
    queryKey: [...baseQueryKey, 'background'],
    queryFn: () =>
      curatedExperiencesService.generateCuratedExperiences({
        ...restParams,
        location: location!,
        limit: BACKGROUND_LIMIT,
      }),
    enabled: enabled && location !== null,
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
  });

  // ── Merge & deduplicate by stop placeId ────────────────────────────────
  const cards = useMemo(() => {
    const priority = priorityQuery.data ?? [];
    const background = backgroundQuery.data ?? [];
    if (background.length === 0) return priority;

    // Collect every placeId already used in the priority cards
    const usedPlaceIds = new Set<string>();
    for (const card of priority) {
      for (const stop of card.stops ?? []) {
        if (stop.placeId) usedPlaceIds.add(stop.placeId);
      }
    }

    // Keep only background cards whose stops don't overlap with priority
    const uniqueBackground = background.filter(
      (card) => !(card.stops ?? []).some((s) => usedPlaceIds.has(s.placeId))
    );

    return [...priority, ...uniqueBackground];
  }, [priorityQuery.data, backgroundQuery.data]);

  return {
    cards,
    // Only the priority batch gates the loading spinner — the background
    // batch loads silently so the user can start swiping immediately.
    isLoading: priorityQuery.isLoading,
    error: (priorityQuery.error ?? backgroundQuery.error) as Error | null,
    refetch: () => {
      priorityQuery.refetch();
      backgroundQuery.refetch();
    },
  };
}
