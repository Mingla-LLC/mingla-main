import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import { curatedExperiencesService } from '../services/curatedExperiencesService';
import type { CuratedExperienceCard } from '../types/curatedExperience';

export type CuratedExperienceType =
  | 'solo-adventure'
  | 'first-dates'
  | 'romantic'
  | 'friendly'
  | 'group-fun';

/** How many cards to fetch in the fast priority batch */
const PRIORITY_LIMIT = 2;
/** How many cards to fetch in the slower background batch (extra to account for dedup) */
const BACKGROUND_LIMIT = 20;

interface UseCuratedExperiencesParams {
  experienceType: CuratedExperienceType;
  location: { lat: number; lng: number } | null;
  budgetMin: number;
  budgetMax: number;
  travelMode: string;
  travelConstraintType: 'time' | 'distance';
  travelConstraintValue: number;
  datetimePref?: string;
  enabled: boolean;
  batchSeed?: number;
  sessionId?: string;
}

/**
 * Progressive curated-experiences loader.
 *
 * Makes two parallel edge-function calls:
 *   1. **Priority batch** (2 cards) — returns in ~1-2 s, unblocks the spinner.
 *   2. **Background batch** (18 cards) — loads silently, cards appear as the
 *      user swipes through the first two.
 *
 * `isLoading` only reflects the priority batch so the spinner clears fast.
 * `isFullBatchLoaded` reflects whether both queries have settled (success or
 * error) — used by the context to gate `isBatchTransitioning`.
 */
export function useCuratedExperiences(params: UseCuratedExperiencesParams): {
  cards: CuratedExperienceCard[];
  isLoading: boolean;
  isFullBatchLoaded: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { location, enabled, ...restParams } = params;

  const baseQueryKey = [
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
  ];

  // ── Prevent card-count regression ──────────────────────────────────────
  // When the background query errors after the priority succeeded, TanStack
  // drops `backgroundQuery.data` to undefined, causing the merged card count
  // to plummet from ~20 to just PRIORITY_LIMIT (2). We track the best
  // merged result per batchSeed and never return fewer cards.
  const bestCardsRef = useRef<CuratedExperienceCard[]>([]);
  const trackedBatchSeedRef = useRef<number>(params.batchSeed ?? 0);

  // Reset the "best known" cards when batchSeed changes (new batch requested)
  if ((params.batchSeed ?? 0) !== trackedBatchSeedRef.current) {
    trackedBatchSeedRef.current = params.batchSeed ?? 0;
    bestCardsRef.current = [];
  }

  // ── Priority batch (fast, ~1-2 s — skips OpenAI descriptions) ─────────
  const priorityQuery = useQuery({
    queryKey: [...baseQueryKey, 'priority'],
    queryFn: () =>
      curatedExperiencesService.generateCuratedExperiences({
        ...restParams,
        location: location!,
        limit: PRIORITY_LIMIT,
        skipDescriptions: true,
      }),
    enabled: enabled && location !== null,
    staleTime: 30 * 60 * 1000,   // 30 minutes
    gcTime: 2 * 60 * 60 * 1000,  // 2 hours
    retry: 1,
    // Show previous batch's data while new batch loads to prevent flash of empty cards
    placeholderData: (previousData) => previousData,
  });

  // ── Background batch (remaining cards — skipDescriptions for speed) ─────
  const backgroundQuery = useQuery({
    queryKey: [...baseQueryKey, 'background'],
    queryFn: () =>
      curatedExperiencesService.generateCuratedExperiences({
        ...restParams,
        location: location!,
        limit: BACKGROUND_LIMIT,
        skipDescriptions: true,
      }),
    enabled: enabled && location !== null && !priorityQuery.isLoading,
    staleTime: 30 * 60 * 1000,   // 30 minutes
    gcTime: 2 * 60 * 60 * 1000,  // 2 hours
    retry: 2,                     // Extra retry — this batch is larger & more prone to timeout
    // Show previous batch's data while new batch loads to prevent flash of empty cards
    placeholderData: (previousData) => previousData,
  });

  // ── Merge, deduplicate, and prevent regression ─────────────────────────
  const cards = useMemo(() => {
    const priority = priorityQuery.data ?? [];
    const background = backgroundQuery.data ?? [];

    let merged: CuratedExperienceCard[];

    if (background.length === 0) {
      merged = priority;
    } else {
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

      merged = [...priority, ...uniqueBackground];
    }

    // Never regress to fewer cards than the best we've seen for this batch.
    // This guards against background query errors that drop data to undefined
    // AFTER an intermediate merge (priority + placeholder background) already
    // produced a larger, valid card set.
    if (merged.length >= bestCardsRef.current.length) {
      bestCardsRef.current = merged;
    }

    return bestCardsRef.current;
  }, [priorityQuery.data, backgroundQuery.data]);

  // Both queries have settled: either succeeded, errored, or are disabled.
  // FIX: When background transitions from disabled → enabled, there's a one-render
  // window where isFetching=false but the query hasn't started yet. Guard against
  // this by checking whether the background query is enabled but has no data yet.
  const backgroundEnabled = enabled && location !== null && !priorityQuery.isLoading;
  const backgroundSettled =
    !backgroundEnabled ||                                                     // disabled → settled
    backgroundQuery.isError ||                                                // errored → settled
    (backgroundQuery.data !== undefined && !backgroundQuery.isFetching);      // has data + not refetching → settled
  const prioritySettled =
    !priorityQuery.isFetching || priorityQuery.isError;
  const isFullBatchLoaded = prioritySettled && backgroundSettled;

  return {
    cards,
    // Only the priority batch gates the loading spinner — the background
    // batch loads silently so the user can start swiping immediately.
    isLoading: priorityQuery.isLoading,
    isFullBatchLoaded,
    error: (priorityQuery.error ?? backgroundQuery.error) as Error | null,
    refetch: () => {
      priorityQuery.refetch();
      backgroundQuery.refetch();
    },
  };
}
