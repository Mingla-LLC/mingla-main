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
    // Constitution rule 3 — surfaced, with the state the caller needs to retry
    // without corrupting the visit's timestamp.
    throw new PlaceReviewWriteError(error.message, visitId);
  }

  return { visitId, reviewId: data.id };
}
