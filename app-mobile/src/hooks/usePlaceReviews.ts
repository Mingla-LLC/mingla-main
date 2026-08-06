import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  submitVoluntaryPlaceReview,
  rollBackHalfLandedVisit,
  PlaceReviewWriteError,
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
    // #1687 rework (P1-1) — a failed review must not leave a visit behind. The
    // rollback is part of the WRITE, not of the screen: whoever calls this
    // mutation gets the same guarantee without having to remember it, and a
    // rollback issued from a component would race the component's own unmount.
    mutationFn: async ({ input, recordedVisitId }) => {
      try {
        return await submitVoluntaryPlaceReview(input, recordedVisitId);
      } catch (error) {
        throw await rollBackHalfLandedVisit(error, input.cardId);
      }
    },
    onSuccess: () => {
      confirmOnlineFromCompletedWrite(); // #1661 — must run BEFORE the invalidations
      queryClient.invalidateQueries({ queryKey: ['visits'] });
      queryClient.invalidateQueries({ queryKey: savedCardKeys.all });
    },
    onError: (error) => {
      console.error('[usePlaceReviews] Voluntary place review failed:', error);
      // #1687 rework — a visit id that SURVIVED the rollback is a real row the
      // deck is not showing: `useHasVisited` still says "not visited", the pill
      // sits at REST, and the screen and the database disagree. Invalidate so it
      // settles and the user can un-toggle the leftover themselves.
      //
      // `confirmOnlineFromCompletedWrite()` is justified HERE, and only here,
      // where #1661 otherwise forbids it on a failure: a non-null `visitId` means
      // `record-visit` COMPLETED a round trip, which is the same proof of
      // connectivity onSuccess relies on. Without it the invalidation parks and
      // the disagreement survives exactly the belief it exists to correct.
      if (error instanceof PlaceReviewWriteError && error.visitId) {
        confirmOnlineFromCompletedWrite();
        queryClient.invalidateQueries({ queryKey: ['visits'] });
        queryClient.invalidateQueries({ queryKey: savedCardKeys.all });
      }
    },
  });
}
