/**
 * #4420 (R8 P19) — the one-line Reviews summary on venue Overview
 * ("4.6 ★ · 24 reviews · 3 need a reply"). Pure, so it is unit-tested.
 */
import { replyState } from "./localReplyState";

export interface ReviewSummaryInput {
  rating: number;
  reply: string | null;
  reply_at: string | null;
  reply_editable_until: string | null;
}

export interface VenueReviewsSummary {
  count: number;
  /** Mean rating to one decimal, or null with no rated review. */
  average: number | null;
  needReply: number;
}

export function summarizeVenueReviews(
  reviews: readonly ReviewSummaryInput[],
  nowMs: number,
): VenueReviewsSummary {
  const rated = reviews.filter((r) => Number.isFinite(r.rating) && r.rating > 0);
  const average =
    rated.length === 0
      ? null
      : Math.round((rated.reduce((sum, r) => sum + r.rating, 0) / rated.length) * 10) / 10;
  const needReply = reviews.filter((r) => replyState(r, nowMs).kind === "none").length;
  return { count: reviews.length, average, needReply };
}

/** "4.6 ★ · 24 reviews · 3 need a reply" (parts drop out when empty). */
export function venueReviewsSummaryLine(summary: VenueReviewsSummary): string {
  const parts: string[] = [];
  if (summary.average !== null) parts.push(`${summary.average.toFixed(1)} ★`);
  parts.push(`${summary.count} ${summary.count === 1 ? "review" : "reviews"}`);
  if (summary.needReply > 0) {
    parts.push(`${summary.needReply} ${summary.needReply === 1 ? "needs" : "need"} a reply`);
  }
  return parts.join(" · ");
}
