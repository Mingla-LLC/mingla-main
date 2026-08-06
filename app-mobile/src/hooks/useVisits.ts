import { useQuery, useMutation, useQueryClient, onlineManager } from '@tanstack/react-query';
import { recordVisit, fetchMyVisits, fetchPairedUserVisits, hasVisited, removeVisit, RecordVisitParams } from '../services/visitService';
import { savedCardKeys } from './queryKeys';

/**
 * #1661 — a completed visit write is PROOF of connectivity, so correct
 * query-core's belief about it BEFORE invalidating anything.
 *
 * `onlineManager` is a BELIEF about connectivity, sourced from NetInfo in
 * `config/queryClient.ts`, and it gates every read in the app. Invalidating a
 * query whose `networkMode` is the default `'online'` while that belief is
 * false does NOT refetch: query-core records `isInvalidated: true`, puts the
 * fetch into `fetchStatus: 'paused'`, and parks it until `onlineManager`
 * transitions back to `true`.
 *
 * #1642 made the two visit MUTATIONS `networkMode: 'always'` — explicitly "do
 * not trust that belief, just try". That is correct for a write, but it creates
 * an ASYMMETRY: the write can complete against a live server while query-core
 * still believes there is no connectivity, and then the write's own
 * invalidations are swallowed by that same belief. The row lands, neither
 * `['visits']` nor `savedCardKeys.all` refetches, and BeenHereControl keeps
 * rendering "Been here" off a stale `useHasVisited` — for the rest of the
 * session. The user's natural response is to tap again, and `record-visit`
 * re-stamps `visited_at` on every upsert, so the recorded time of their own
 * visit drifts with each phantom retry.
 *
 * The belief does not reliably self-correct. NetInfo runs with
 * `useNativeReachability: true` (its default), and in that branch
 * `isInternetReachable` is driven ONLY by native events —
 * `internetReachability.ts` schedules its JS polling fallback
 * (`_checkInternetReachability`) exclusively in the OTHER branch. If the native
 * reachability signal does not re-fire, `onlineManager` stays false until the
 * app is relaunched, which is exactly what was observed on #1642's iOS run:
 * a pre-fix PAUSED write was still paused 60s after connectivity returned.
 *
 * Reaching `onSuccess` falsifies the belief. This is not optimism — both visit
 * writes are real server round-trips (`record-visit` over
 * `supabase.functions.invoke`, `removeVisit` over PostgREST) with no offline or
 * cache path, so a resolved write means the device demonstrably has
 * connectivity. Deliberately NOT called from `onError`: a failure is not proof
 * of anything, and asserting connectivity there would resume every other paused
 * mutation in the app on the strength of a request that did not arrive.
 */
function confirmOnlineFromCompletedWrite(): void {
  if (!onlineManager.isOnline()) onlineManager.setOnline(true);
}

export const visitKeys = {
  all: (userId: string) => ['visits', userId] as const,
  my: (userId: string) => ['visits', 'my', userId] as const,
  paired: (userId: string, pairedUserId: string) => ['visits', 'paired', userId, pairedUserId] as const,
  check: (userId: string, experienceId: string) => ['visits', 'check', userId, experienceId] as const,
};

export function useMyVisits(userId: string | undefined) {
  return useQuery({
    queryKey: visitKeys.my(userId || ''),
    queryFn: fetchMyVisits,
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function usePairedUserVisits(userId: string | undefined, pairedUserId: string | undefined) {
  return useQuery({
    queryKey: visitKeys.paired(userId || '', pairedUserId || ''),
    queryFn: () => fetchPairedUserVisits(pairedUserId!),
    enabled: !!userId && !!pairedUserId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useHasVisited(userId: string | undefined, experienceId: string | undefined) {
  return useQuery({
    queryKey: visitKeys.check(userId || '', experienceId || ''),
    queryFn: () => hasVisited(experienceId!),
    enabled: !!userId && !!experienceId,
    staleTime: 10 * 60 * 1000,
  });
}

export function useRecordVisit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: RecordVisitParams) => recordVisit(params),
    onSuccess: () => {
      confirmOnlineFromCompletedWrite(); // #1661 — must run BEFORE the invalidations
      queryClient.invalidateQueries({ queryKey: ['visits'] });
      queryClient.invalidateQueries({ queryKey: savedCardKeys.all });
    },
    onError: (error) => {
      console.error('[useVisits] Record visit failed:', error);
    },
  });
}

export function useRemoveVisit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (experienceId: string) => removeVisit(experienceId),
    onSuccess: () => {
      confirmOnlineFromCompletedWrite(); // #1661 — must run BEFORE the invalidations
      queryClient.invalidateQueries({ queryKey: ['visits'] });
      queryClient.invalidateQueries({ queryKey: savedCardKeys.all });
    },
    onError: (error) => {
      console.error('[useVisits] Remove visit failed:', error);
    },
  });
}
