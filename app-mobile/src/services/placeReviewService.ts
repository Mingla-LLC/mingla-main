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
 * a visit THIS attempt created (`PlaceReviewWriteError.visitCreated`).
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
 * #1687 rework — `visitCreated` says whether THIS attempt is what put that row
 * there. It is the difference between a leftover the caller may undo and a visit
 * the user already had, which must never be deleted on our behalf:
 * `record-visit` upserts on (user_id, experience_id), so a place the user had
 * already marked returns `isNew: false` and its row predates this submit
 * entirely. `rollBackHalfLandedVisit` below is what reads it, and
 * `useSubmitVoluntaryPlaceReview`'s `mutationFn` is what calls that.
 */
export class PlaceReviewWriteError extends Error {
  readonly visitId: string | null;
  /** True only when this attempt created the visit row named by `visitId`. */
  readonly visitCreated: boolean;

  constructor(message: string, visitId: string | null, visitCreated = false) {
    super(message);
    this.name = 'PlaceReviewWriteError';
    this.visitId = visitId;
    this.visitCreated = visitCreated;
  }
}

export async function submitVoluntaryPlaceReview(
  input: VoluntaryPlaceReviewInput,
  recordedVisitId?: string | null,
): Promise<VoluntaryPlaceReviewResult> {
  // 1 — the visit. Skipped only when a previous attempt already landed it.
  let visitId = recordedVisitId ?? null;
  // #1687 rework — did THIS attempt create the row? Only then is it ours to undo.
  let visitCreated = false;
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
    visitCreated = recorded.isNew === true;
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
 * ONLY a visit this attempt CREATED is undone. `record-visit` upserts on
 * (user_id, experience_id): a place the user had already marked comes back as
 * `isNew: false`, and its row predates this submit entirely. Deleting that would
 * destroy state we never wrote — `removeVisit` deletes by (user, experience),
 * not by row id, so it cannot tell the two apart. `visitCreated` can.
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
