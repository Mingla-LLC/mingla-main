/**
 * ORCH-1186-B — happy-path regression for the pure intelligence helpers.
 *
 * Covers the bar-math + insight seam that the component renders from:
 *   - normalizeBars: 0..100 normalization, all-zero safety
 *   - minBucketIndices: single + tie cases
 *   - hourLabel / weekdayLabel: venue-local 12-hour + 0=Mon weekday convention
 *   - the INTELLIGENCE_MIN_ORDERS_FOR_TIME_BUCKETS = 14 threshold
 *
 * fails-on-revert: change the weekday convention base (e.g. weekdayLabel(0) ->
 * "Sunday") or the threshold constant and these assertions flip.
 */
import {
  hourLabel,
  INTELLIGENCE_MIN_ORDERS_FOR_TIME_BUCKETS,
  joinLabels,
  minBucketIndices,
  normalizeBars,
  weekdayLabel,
} from "../venueIntelligence";

describe("venueIntelligence helpers (ORCH-1186-B)", () => {
  it("normalizeBars scales to 0..100 against the max", () => {
    expect(normalizeBars([0, 5, 10])).toEqual([0, 50, 100]);
  });

  it("normalizeBars never divides by zero (all-zero series)", () => {
    expect(normalizeBars([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("minBucketIndices returns the single quietest bucket", () => {
    expect(minBucketIndices([3, 1, 2])).toEqual([1]);
  });

  it("minBucketIndices returns ALL tied minimum buckets (honest)", () => {
    expect(minBucketIndices([0, 5, 0, 9])).toEqual([0, 2]);
  });

  it("hourLabel renders venue-local 12-hour clock", () => {
    expect(hourLabel(0)).toBe("12 AM");
    expect(hourLabel(12)).toBe("12 PM");
    expect(hourLabel(15)).toBe("3 PM");
    expect(hourLabel(23)).toBe("11 PM");
  });

  it("weekdayLabel uses the 0=Monday..6=Sunday RPC convention", () => {
    expect(weekdayLabel(0)).toBe("Monday");
    expect(weekdayLabel(1)).toBe("Tuesday");
    expect(weekdayLabel(6)).toBe("Sunday");
  });

  it("joinLabels builds human phrases for tie cases", () => {
    expect(joinLabels(["3 PM"])).toBe("3 PM");
    expect(joinLabels(["3 PM", "4 PM"])).toBe("3 PM and 4 PM");
    expect(joinLabels(["A", "B", "C"])).toBe("A, B and C");
    expect(joinLabels(["A", "B", "C", "D", "E"])).toBe("A, B, C +2 more");
  });

  it("the time-bucket threshold is 14 (the §9 anchor)", () => {
    expect(INTELLIGENCE_MIN_ORDERS_FOR_TIME_BUCKETS).toBe(14);
  });
});
