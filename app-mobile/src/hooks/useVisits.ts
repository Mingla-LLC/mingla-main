import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { recordVisit, fetchMyVisits, fetchPairedUserVisits, hasVisited, removeVisit, RecordVisitParams } from '../services/visitService';
import { savedCardKeys } from './queryKeys';

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

/**
 * #1642 — WHY BOTH VISIT WRITES DECLARE `networkMode: 'always'`.
 *
 * #1618 moved the write's timeout up into visitService as an operation-level
 * bound (VISIT_WRITE_TIMEOUT_MS). On a physical device in airplane mode it
 * still never fired: the spinner ran past 15s, 35s, 120s and 180s, and the row
 * landed the instant connectivity returned, ~3.5 minutes after the tap.
 *
 * The bound was still BELOW the thing that blocks — the same shape as #1618,
 * one layer further up. React Query's DEFAULT `networkMode` is `'online'`, and
 * `onlineManager` is wired to NetInfo in config/queryClient.ts. With no signal
 * `onlineManager.isOnline()` is false, so query-core's retryer takes the
 * `pause()` branch of `start()` INSTEAD OF `run()`:
 *
 *     start: () => { if (canStart()) run(); else pause().then(run); }
 *     canStart = () => canFetch(networkMode) && canRun()
 *     canFetch = (m) => (m ?? 'online') === 'online' ? onlineManager.isOnline() : true
 *
 * `run()` is what calls `mutationFn`. So `recordVisit` was never invoked at
 * all, the 15s `setTimeout` inside it was never even CREATED, and the mutation
 * sat at `status: 'pending'` with `isPaused: true`. `isPending` stays true
 * while paused, which is what `inFlight` in BeenHereControl reads — hence a
 * spinner with no timeout and no error, forever.
 *
 * `'always'` makes `canStart()` unconditionally true, so `mutationFn` runs, the
 * operation bound is REACHED, and a partition resolves to `isError` — either
 * fast (RN `fetch` rejects offline) or at the 15s bound (a socket that hangs
 * without rejecting, e.g. a captive portal). Either way the control reaches
 * "Couldn't save".
 *
 * DELIBERATE CONSEQUENCE — the write is ABANDONED, not replayed. A paused
 * mutation is resumed by `queryClient.mount()` on BOTH the online and the focus
 * subscription, and query-core's default `shouldDehydrateMutation` is
 * `state.isPaused`, so today's paused write is also persisted to AsyncStorage
 * by PersistQueryClientProvider and can resume in a LATER app session. That is
 * why the row landed 3.5 minutes late. It is the wrong behaviour on three
 * counts: it contradicts the "Couldn't save" we just showed the user; the
 * `record-visit` edge function stamps `visited_at: new Date().toISOString()` at
 * EXECUTION time, so a resumed write dates the visit to the reconnect rather
 * than the tap (Constitution rule 9 — no fabricated data); and "Been here" is a
 * factual claim about the user's own history, which we must not replay on their
 * behalf without them. `'always'` never pauses, so nothing is ever queued,
 * persisted or resumed. Retry is one tap away — the failed state already calls
 * `.reset()` and re-mutates.
 */
export function useRecordVisit() {
  const queryClient = useQueryClient();

  return useMutation({
    // #1642 — see above. Without this the mutationFn never runs offline and the
    // operation bound below it is unreachable dead code.
    networkMode: 'always',
    mutationFn: (params: RecordVisitParams) => recordVisit(params),
    onSuccess: () => {
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
    // #1642 — same reasoning as useRecordVisit. A bounded record with a paused
    // remove still hangs forever on the un-press, which is the same tap.
    networkMode: 'always',
    mutationFn: (experienceId: string) => removeVisit(experienceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visits'] });
      queryClient.invalidateQueries({ queryKey: savedCardKeys.all });
    },
    onError: (error) => {
      console.error('[useVisits] Remove visit failed:', error);
    },
  });
}
