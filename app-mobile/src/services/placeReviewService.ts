import { supabase } from './supabase';
import { recordVisit, removeVisit } from './visitService';

/**
 * #1687 — the voluntary "Been here" rating, written on CONFIRM.
 *
 * THE ORDER IS THE CONTRACT, not an implementation detail.
 *
 * Tapping "Been here" on the collapsed deck card writes NOTHING. It opens the
 * rating prompt, which carries a close icon because the tap may be a mistake, and
 * a cancelled tap must leave nothing behind. The alternative — write on tap,
 * delete on cancel — races a delete against an insert whose COLD path measures
 * 11.8 seconds (warm: 0.24s), so the delete can be issued against a row that has
 * not landed. That control has already produced #1618 (a 75-second silent hang),
 * #1642 (a write paused forever by a stale connectivity belief) and #1661 (a
 * completed write whose invalidations were swallowed by that same belief). This
 * is one write path, entered once, with no second round trip to lose.
 *
 * CONSEQUENCE, STATED PLAINLY: rating is now how you mark a visit. Someone who
 * went but will not rate gets no `user_visits` row. That is coherent — the action
 * became "tell us you went, and how it was" — but it is a real behavioural change
 * from the record-on-tap control that shipped in #1609.
 *
 * The visit is recorded FIRST. If the review insert then fails, the user is shown
 * the failure and can retry, and the retry MUST NOT re-record: `record-visit`
 * upserts with `visited_at: new Date().toISOString()` at execution time, so a
 * second call rewrites the recorded time of the user's own visit — the drift
 * #1661 X-3 exists to catch. `PlaceReviewWriteError` carries the visit id out to
 * the caller for exactly that reason, and `recordedVisitId` skips the re-record.
 *
 * The reverse order was rejected: a review written before the visit leaves an
 * orphaned rating whose retry would insert a SECOND review row.
 *
 * #1687 REWORK — A FAILED REVIEW MUST NOT LEAVE A VISIT BEHIND.
 *
 * "A cancelled tap writes nothing" stopped being true the moment a submit
 * half-landed: the visit was recorded, the review was refused, and the row sat
 * there with the deck pill at REST because `useHasVisited` was never
 * invalidated. The screen and the database disagreed, and on the one failure
 * that never resolves — a `place_pool_id` the FK refuses — every retry
 * reproduced it and `place_reviews` grants users no DELETE.
 *
 * THE DECISION IS ROLLBACK, NOT A REVIEW WRITTEN WITHOUT THE FOREIGN KEY.
 * Stripping `place_pool_id` and re-inserting would launder a bad place anchor
 * into the table this feature exists to fill, and it would hide the derivation
 * defect instead of surfacing it. Undoing the visit restores the stated
 * contract exactly: the tap records both rows or it records nothing.
 *
 * THIS IS NOT THE DELETE-RACES-AN-INSERT SHAPE THE ORDER WAS CHOSEN TO AVOID.
 * That hazard is a delete issued against a write still in flight — the 11.8s
 * cold path. Here `recordVisit` has RESOLVED and handed back a visit id, so the
 * row provably exists before the delete is issued. The two are different events.
 *
 * The compensating delete is `rollBackHalfLandedVisit` below. It is a SEPARATE
 * entry point rather than a branch inside the write, because the write's job is
 * to report exactly what landed — `submitVoluntaryPlaceReview` still resolves or
 * throws precisely as it did — and because the rollback is only ever correct for
 * a visit THIS submit created (`PlaceReviewWriteError.visitCreated`, derived by
 * `visitIsOursToUndo` from the client's own pre-tap knowledge — NOT from
 * `record-visit`'s `isNew`, which is a fact about `user_interactions`).
 */

export interface VoluntaryPlaceReviewInput {
  userId: string;
  /** `user_visits.experience_id` AND `place_reviews.card_id`. */
  cardId: string;
  placeName: string;
  placeCategory: string;
  placeAddress?: string;
  placePoolId?: string;
  googlePlaceId?: string;
  placeImage?: string;
  priceTier?: string;
  /**
   * #1687 rework 2 (P1-2) — WHAT `useHasVisited` SAID BEFORE THE TAP.
   *
   * The one fact that decides whether a half-landed visit is ours to undo, and
   * the client already owns it: `BeenHereControl` reads `useHasVisited` to choose
   * its own label, and only opens this prompt off the not-settled branch. It is
   * captured at the tap and carried down here verbatim.
   *
   *   `false` — the user had NO visit for this card. Anything in `user_visits`
   *             afterwards was put there by this submit.
   *   `true`  — the user already had one. It predates this submit and must never
   *             be deleted on their behalf.
   *   absent  — the caller did not state it (`useHasVisited` errored, or a caller
   *             that predates this field). See `visitIsOursToUndo`.
   */
  hadVisitBeforeTap?: boolean;
  rating: number;
}

export interface VoluntaryPlaceReviewResult {
  visitId: string;
  reviewId: string;
}

/**
 * Raised when the review insert fails AFTER the visit landed. `visitId` is the
 * row that already exists, so a retry can skip re-recording it.
 *
 * `visitCreated` says whether the `user_visits` row named by `visitId` was put
 * there by this submit. It is the difference between a leftover the caller may
 * undo and a visit the user already had, which must never be deleted on our
 * behalf — `removeVisit` deletes by (user, experience) rather than by row id, so
 * it cannot tell the two apart and this flag has to. It is derived by
 * `visitIsOursToUndo`; `rollBackHalfLandedVisit` below is what reads it, and
 * `useSubmitVoluntaryPlaceReview`'s `mutationFn` is what calls that.
 */
export class PlaceReviewWriteError extends Error {
  readonly visitId: string | null;
  /** True only when this submit created the visit row named by `visitId`. */
  readonly visitCreated: boolean;

  constructor(message: string, visitId: string | null, visitCreated = false) {
    super(message);
    this.name = 'PlaceReviewWriteError';
    this.visitId = visitId;
    this.visitCreated = visitCreated;
  }
}

/**
 * #1687 rework 2 (P1-2) — WHY `record-visit`'s `isNew` IS NOT THE ANSWER.
 *
 * The first rework gated the rollback on `isNew`, on the stated reasoning that
 * `record-visit` upserts on (user_id, experience_id) so a place the user had
 * already marked comes back `isNew: false`. That reasoning was wrong, and the
 * tester proved it on a device against production.
 *
 * `isNew` DOES NOT DESCRIBE THE `user_visits` UPSERT AT ALL. Read
 * `supabase/functions/record-visit/index.ts`: the upsert's result is used only
 * for the row id (line 88), and `isNew` is computed further down from whether a
 * `user_interactions` row of `interaction_type = 'visit'` already exists (lines
 * 113-148). Those are two different tables with two different lifetimes, and
 * they drift in BOTH directions:
 *
 *  - `removeVisit` deletes from `user_visits` ONLY, so an un-toggle leaves the
 *    interaction row behind. The next tap INSERTS a `user_visits` row and reports
 *    `isNew: false`. Reproduced on device: `user_visits 44c459c9` created at
 *    00:53:12.679 while the interaction row still read 18:31:05 — the rollback
 *    would have refused to undo a row it had just created. Production carries 13
 *    visit rows against 16 visit interactions today: 3 places in exactly this
 *    state.
 *  - The interaction insert is swallowed as non-fatal (record-visit:143). One
 *    swallowed failure leaves a visit row with no interaction behind it, and the
 *    NEXT tap then reports `isNew: true` for a row that already existed — a
 *    failed review would delete state this submit did not write.
 *
 * Fixing `isNew` at source needs an edge deploy and is filed as #1694. This
 * decision does not wait for it, because the client already owns a better fact:
 * `useHasVisited`'s value at the moment of the tap. `BeenHereControl` reads it to
 * pick its own label and only opens the prompt off the not-settled branch, so the
 * answer is local, needs no round trip, and cannot be contradicted by a table
 * this feature does not use.
 *
 * [TRANSITIONAL] `serverIsNew` is consulted ONLY when the caller stated nothing —
 * `useHasVisited` errored (the control renders unsettled with `data: undefined`),
 * or a caller written before this field existed. It is the best signal available
 * without the edge fix, and it is the one that lies. Exit condition: #1694 makes
 * `record-visit` report the `user_visits` upsert itself, at which point this
 * fallback becomes correct rather than merely least-bad — or every caller states
 * its pre-tap knowledge and the parameter goes away.
 */
function visitIsOursToUndo(
  hadVisitBeforeTap: boolean | undefined,
  serverIsNew: boolean | undefined,
): boolean {
  if (hadVisitBeforeTap === false) return true;
  if (hadVisitBeforeTap === true) return false;
  return serverIsNew === true;
}

export async function submitVoluntaryPlaceReview(
  input: VoluntaryPlaceReviewInput,
  recordedVisitId?: string | null,
): Promise<VoluntaryPlaceReviewResult> {
  // 1 — the visit. Skipped only when a previous attempt already landed it.
  let visitId = recordedVisitId ?? null;
  // #1687 rework 2 (P1-2) — is that row ours to undo? Answered from what the
  // client knew BEFORE the tap, not from a server flag about another table. The
  // retry path (`recordedVisitId` set) reaches this with no `serverIsNew` at all:
  // a stated "the user had no visit" is still true of the row attempt 1 left
  // behind, so a retry that fails again can still clean it up.
  let visitCreated = visitIsOursToUndo(input.hadVisitBeforeTap, undefined);
  if (!visitId) {
    const recorded = await recordVisit({
      experienceId: input.cardId,
      cardData: {
        category: input.placeCategory,
        title: input.placeName,
        imageUrl: input.placeImage,
        priceTier: input.priceTier,
      },
    });
    visitId = recorded.visitId;
    visitCreated = visitIsOursToUndo(input.hadVisitBeforeTap, recorded.isNew);
  }

  // 2 — the review. Anchored to the PLACE, never to a calendar entry: this entry
  // point has none, and `calendar_entry_id` has always been nullable.
  const { data, error } = await supabase
    .from('place_reviews')
    .insert({
      user_id: input.userId,
      calendar_entry_id: null,
      place_pool_id: input.placePoolId ?? null,
      google_place_id: input.googlePlaceId ?? null,
      card_id: input.cardId,
      place_name: input.placeName,
      place_address: input.placeAddress ?? null,
      place_category: input.placeCategory ?? null,
      rating: input.rating,
      // The tap IS the answer to "did you go?", which is why this path skips
      // that step entirely.
      did_attend: true,
    })
    .select('id')
    .single();

  if (error) {
    // Constitution rule 3 — surfaced, with the state the caller needs BOTH to
    // retry without corrupting the visit's timestamp AND to undo the half-write.
    throw new PlaceReviewWriteError(error.message, visitId, visitCreated);
  }

  return { visitId, reviewId: data.id };
}

/**
 * #1687 rework (P1-1) — UNDO A VISIT WHOSE REVIEW WAS REFUSED.
 *
 * Given whatever `submitVoluntaryPlaceReview` threw, return the error the caller
 * should surface — with `visitId` cleared when the visit has been undone, and
 * left intact when it has not, so the caller's retry logic reads one field and
 * is right either way.
 *
 * ONLY a visit this submit CREATED is undone. Deleting a visit the user already
 * had would destroy state we never wrote — `removeVisit` deletes by
 * (user, experience), not by row id, so it cannot tell the two apart.
 * `visitCreated` can, and since the P1-2 rework it is derived from what
 * `useHasVisited` said before the tap rather than from `record-visit`'s `isNew`,
 * which describes `user_interactions` and disagrees with `user_visits` in both
 * directions. See `visitIsOursToUndo`.
 *
 * NOT the delete-races-an-insert shape the confirm-time order exists to avoid.
 * That hazard is a delete issued against a write still in flight on an
 * 11.8-second cold path. Here `recordVisit` has already RESOLVED and handed back
 * the row's id, so the row provably exists before the delete is issued.
 *
 * A rollback that itself fails is not swallowed: the original error comes back
 * with its `visitId` intact, which is the signal the mutation uses to invalidate
 * the visit queries so the deck stops claiming the row is not there.
 */
export async function rollBackHalfLandedVisit(
  error: unknown,
  cardId: string,
): Promise<unknown> {
  if (!(error instanceof PlaceReviewWriteError)) return error;
  if (!error.visitId || !error.visitCreated) return error;

  try {
    await removeVisit(cardId);
  } catch (rollbackError) {
    console.error('[placeReviewService] Visit rollback failed:', rollbackError);
    return error;
  }

  return new PlaceReviewWriteError(error.message, null, false);
}
