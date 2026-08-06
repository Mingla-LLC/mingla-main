import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  submitVoluntaryPlaceReview,
  VoluntaryPlaceReviewInput,
  VoluntaryPlaceReviewResult,
} from '../services/placeReviewService';
import { confirmOnlineFromCompletedWrite } from './useVisits';
import { savedCardKeys } from './queryKeys';

export interface SubmitVoluntaryPlaceReviewVars {
  input: VoluntaryPlaceReviewInput;
  /** Non-null only when a previous attempt already landed the visit. */
  recordedVisitId: string | null;
}

/**
 * #1687 — the confirm-time write behind the voluntary "Been here" rating.
 *
 * Deliberately declares the SAME contract as `useRecordVisit`, because it makes
 * the same write:
 *
 *  - `networkMode: 'always'` — #1642. React Query's default `'online'` gates on
 *    `onlineManager`, which is wired to NetInfo and does not reliably
 *    self-correct; with the default the mutation is PAUSED before `mutationFn`
 *    runs, so the operation bound inside `visitService` is never even created and
 *    the modal would spin forever instead of reaching an error the user can act
 *    on. `'always'` also means nothing is queued, persisted or resumed: an
 *    abandoned write stays abandoned rather than dating the visit to a reconnect.
 *  - `confirmOnlineFromCompletedWrite()` BEFORE the invalidations — #1661. A
 *    completed write is proof of connectivity; invalidating first while the
 *    belief is still false parks the refetch and leaves `useHasVisited` stale, so
 *    the deck control never settles even though both rows landed.
 *
 * Both invalidations matter here: `['visits']` is the prefix `useHasVisited`'s
 * key sits under (that is what flips the control to settled), and the saved-card
 * list carries the same visited state.
 */
export function useSubmitVoluntaryPlaceReview() {
  const queryClient = useQueryClient();

  return useMutation<VoluntaryPlaceReviewResult, Error, SubmitVoluntaryPlaceReviewVars>({
    networkMode: 'always',
    mutationFn: ({ input, recordedVisitId }) => submitVoluntaryPlaceReview(input, recordedVisitId),
    onSuccess: () => {
      confirmOnlineFromCompletedWrite(); // #1661 — must run BEFORE the invalidations
      queryClient.invalidateQueries({ queryKey: ['visits'] });
      queryClient.invalidateQueries({ queryKey: savedCardKeys.all });
    },
    onError: (error) => {
      console.error('[usePlaceReviews] Voluntary place review failed:', error);
    },
  });
}
