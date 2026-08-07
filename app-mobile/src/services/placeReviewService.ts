import { supabase } from './supabase';
import { recordVisit } from './visitService';

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
 * ─────────────────────────────────────────────────────────────────────────────
 * #1687 REWORK 3 — THIS WRITE DELETES NOTHING. THERE IS NO ROLLBACK.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Reworks 1 and 2 both tried to compensate a half-landed submit by deleting the
 * `user_visits` row, and both shipped a defect, in OPPOSITE directions, because
 * they both had to answer one question first: "is the row I am looking at mine to
 * delete?"
 *
 *  - Rework 1 answered it with `record-visit`'s `isNew`. That flag is computed
 *    from `user_interactions` (record-visit/index.ts:113-148), not from the
 *    `user_visits` upsert whose result is consumed for the row id alone (line
 *    88). The tables drift — `removeVisit` deletes from `user_visits` only, so
 *    every un-toggle leaves an interaction row behind. Proven on device: a tap
 *    CREATED `user_visits 124da062` and `record-visit` reported `isNew: false`
 *    for it. The rollback refused to clean up its own leftover.
 *  - Rework 2 answered it with what `useHasVisited` said before the tap. That
 *    query's `staleTime` is TEN MINUTES (useVisits.ts:80), so a real visit can
 *    sit behind a cached `false`. Proven on device: visit `99081740`, three days
 *    old, upserted at 21:57:00.79 and DELETED at 21:57:01.253 by a failed review.
 *
 * THE QUESTION CANNOT BE ANSWERED RELIABLY FROM THE CLIENT, so this code no
 * longer asks it. Both signals available here describe something other than the
 * row in front of us, and a wrong answer in the delete direction is unrecoverable
 * — `user_visits` has no history table and `place_reviews` grants users no DELETE.
 *
 * THE RISKS ARE NOT SYMMETRIC, AND THAT IS THE WHOLE ARGUMENT:
 *
 *  - A visit with no review is TRUE (the user did say they went), VISIBLE (the
 *    deck pill settles to "You've been to X. Double tap to remove.") and
 *    USER-REVERSIBLE (that tap runs `removeVisit`, which the tester has driven).
 *  - A deleted visit is SILENT, WRONG and UNRECOVERABLE.
 *
 * Given a choice between leaving something recoverable and destroying something
 * that is not, leave it. So a refused review now surfaces the error, keeps the
 * visit, and hands its id back — `useSubmitVoluntaryPlaceReview`'s `onError`
 * invalidates `['visits']` and the saved-card list so the control shows what the
 * database actually holds, and the user decides.
 *
 * What a user sees when the review write fails: the prompt holds "Something went
 * wrong. Try again." with Submit live for a retry, and behind it the deck pill
 * settles green — "You've been to <place>. Double tap to remove." Their visit is
 * recorded and their rating is not, which is exactly what happened, and one tap
 * undoes the visit if they want it gone.
 *
 * This is also why `visitIsOursToUndo`, `rollBackHalfLandedVisit`,
 * `PlaceReviewWriteError.visitCreated` and the `hadVisitBeforeTap` carried
 * through the store are all GONE rather than fixed: they exist only to answer a
 * question this design does not ask, and every one of them is a place a delete
 * could grow back.
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
 * Raised when the review insert fails AFTER the visit landed.
 *
 * `visitId` names the `user_visits` row that EXISTS. It is never deleted and
 * never cleared, so it means one thing only, always: a real row is there. Two
 * callers depend on that being unambiguous — `PostExperienceModal` reuses it as
 * `recordedVisitId` so a retry does not re-stamp `visited_at` (#1661 X-3), and
 * `useSubmitVoluntaryPlaceReview`'s `onError` treats it as proof that a round
 * trip completed, which is what licenses the invalidation that settles the pill.
 */
export class PlaceReviewWriteError extends Error {
  readonly visitId: string | null;

  constructor(message: string, visitId: string | null) {
    super(message);
    this.name = 'PlaceReviewWriteError';
    this.visitId = visitId;
  }
}

export async function submitVoluntaryPlaceReview(
  input: VoluntaryPlaceReviewInput,
  recordedVisitId?: string | null,
): Promise<VoluntaryPlaceReviewResult> {
  // 1 — the visit. Skipped only when a previous attempt already landed it.
  let visitId = recordedVisitId ?? null;
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
    // Constitution rule 3 — surfaced, with the id of the row that landed. NOT
    // compensated: see the header. The visit stays, the user is told, and the
    // deck settles to the truth so they can undo it themselves.
    throw new PlaceReviewWriteError(error.message, visitId);
  }

  return { visitId, reviewId: data.id };
}
