import { visibleDelta, visitToPaidRate } from "../trafficAnalyticsMath";

describe("#4037 traffic analytics metric thresholds", () => {
  it("shows traffic deltas only when both periods have at least 30 visits", () => {
    expect(visibleDelta(45, 30, 30, 30, 30)).toBe(50);
    expect(visibleDelta(45, 30, 29, 30, 30)).toBeNull();
    expect(visibleDelta(45, 30, 30, 29, 30)).toBeNull();
  });

  it("shows money deltas only when both periods have at least 5 bookings", () => {
    expect(visibleDelta(12_000, 10_000, 5, 5, 5)).toBe(20);
    expect(visibleDelta(12_000, 10_000, 4, 5, 5)).toBeNull();
    expect(visibleDelta(12_000, 10_000, 5, 4, 5)).toBeNull();
  });

  it("never fabricates a zero or infinite delta from a zero prior value", () => {
    expect(visibleDelta(100, 0, 30, 30, 30)).toBeNull();
  });

  it("rounds visit-to-paid to one decimal place and hides an empty denominator", () => {
    expect(visitToPaidRate(7, 96)).toBe(7.3);
    expect(visitToPaidRate(3, 0)).toBeNull();
  });
});
