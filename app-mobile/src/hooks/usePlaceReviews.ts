import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  submitVoluntaryPlaceReview,
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
    // #1687 rework 3 — THE MUTATION COMPENSATES NOTHING. The two attempts to
    // delete a half-landed visit each shipped a defect in opposite directions,
    // because both had to decide whether the row was theirs to destroy and
    // neither signal available on the client answers that: `record-visit`'s
    // `isNew` describes `user_interactions`, and `useHasVisited` is cached for
    // ten minutes. A visit with no review is true, visible and undoable by the
    // user; a deleted visit is silent, wrong and unrecoverable. So the write
    // reports what landed and `onError` below makes the screen agree with it.
    mutationFn: ({ input, recordedVisitId }) =>
      submitVoluntaryPlaceReview(input, recordedVisitId),
    onSuccess: () => {
      confirmOnlineFromCompletedWrite(); // #1661 — must run BEFORE the invalidations
      queryClient.invalidateQueries({ queryKey: ['visits'] });
      queryClient.invalidateQueries({ queryKey: savedCardKeys.all });
    },
    onError: (error) => {
      console.error('[usePlaceReviews] Voluntary place review failed:', error);
      // #1687 rework 3 — THIS IS THE WHOLE RECOVERY, and it is why no delete is
      // needed. A `visitId` on the error means a real `user_visits` row exists
      // while `useHasVisited` still says it does not: the pill sits at REST and
      // the screen disagrees with the database. Invalidating both keys settles it
      // to the truth — "You've been to X. Double tap to remove." — which is a
      // statement the user made and can retract with one tap. Leaving the row
      // visible is what makes it recoverable; deleting it is what made it not.
      //
      // `confirmOnlineFromCompletedWrite()` is justified HERE, and only here,
      // where #1661 otherwise forbids it on a failure: a non-null `visitId` means
      // `record-visit` COMPLETED a round trip, which is the same proof of
      // connectivity onSuccess relies on. Without it the invalidation parks and
      // the disagreement survives exactly the belief it exists to correct. A
      // failure with NO visit id (the record itself failed) wrote nothing and
      // proves nothing about the network, so it deliberately falls through.
      if (error instanceof PlaceReviewWriteError && error.visitId) {
        confirmOnlineFromCompletedWrite();
        queryClient.invalidateQueries({ queryKey: ['visits'] });
        queryClient.invalidateQueries({ queryKey: savedCardKeys.all });
      }
    },
  });
}
