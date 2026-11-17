/** #4420 (R8 P19) — the venue Overview Reviews summary line. Pure. */
import { describe, expect, test } from "@jest/globals";

import { summarizeVenueReviews, venueReviewsSummaryLine } from "../venueReviewsSummary";

const NOW = Date.parse("2026-11-15T12:00:00.000Z");
const review = (rating: number, reply: string | null, replyAt: string | null = null, until: string | null = null) => ({
  rating,
  reply,
  reply_at: replyAt,
  reply_editable_until: until,
});

describe("#4420 venue reviews summary", () => {
  test("averages ratings to one decimal and counts reviews with no reply yet", () => {
    const summary = summarizeVenueReviews(
      [
        review(5, null),
        review(4, "Thanks", "2026-11-15T10:00:00.000Z", "2026-11-16T10:00:00.000Z"),
        review(4, "Thanks", "2026-11-01T10:00:00.000Z", "2026-11-02T10:00:00.000Z"),
      ],
      NOW,
    );
    expect(summary).toEqual({ count: 3, average: 4.3, needReply: 1 });
    expect(venueReviewsSummaryLine(summary)).toBe("4.3 ★ · 3 reviews · 1 needs a reply");
  });

  test("singular, all replied and unrated cases read plainly", () => {
    expect(venueReviewsSummaryLine({ count: 1, average: 5, needReply: 0 })).toBe("5.0 ★ · 1 review");
    expect(venueReviewsSummaryLine({ count: 2, average: null, needReply: 2 })).toBe("2 reviews · 2 need a reply");
    expect(summarizeVenueReviews([], NOW)).toEqual({ count: 0, average: null, needReply: 0 });
  });
});
