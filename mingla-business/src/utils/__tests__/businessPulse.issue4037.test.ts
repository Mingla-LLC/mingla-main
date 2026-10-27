import {
  businessPulseDesktopSpans,
  businessPulseVisibility,
  selectStartsSoon,
} from "../businessPulse";

describe("#4037 Business Pulse policy", () => {
  test.each([
    [true, true, true, { money: 5, visits: 4, followers: 3 }],
    [true, true, false, { money: 7, visits: 5, followers: 0 }],
    [true, false, true, { money: 8, visits: 0, followers: 4 }],
    [true, false, false, { money: 12, visits: 0, followers: 0 }],
    [false, true, true, { money: 0, visits: 7, followers: 5 }],
    [false, true, false, { money: 0, visits: 12, followers: 0 }],
    [false, false, true, { money: 0, visits: 0, followers: 12 }],
    [false, false, false, { money: 0, visits: 0, followers: 0 }],
  ])(
    "uses exact desktop spans for money=%s visits=%s followers=%s",
    (money, visits, followers, expected) => {
      expect(businessPulseDesktopSpans({ money, visits, followers })).toEqual(
        expected,
      );
    },
  );

  test("removes traffic below the threshold and followers at zero", () => {
    expect(
      businessPulseVisibility({
        canViewMoney: true,
        captureStartedAt: "2026-10-01T00:00:00.000Z",
        pageViews: 29,
        followerTotal: 0,
      }),
    ).toEqual({ money: true, visits: false, followers: false });
    expect(
      businessPulseVisibility({
        canViewMoney: false,
        captureStartedAt: "2026-10-01T00:00:00.000Z",
        pageViews: 30,
        followerTotal: 1,
      }),
    ).toEqual({ money: false, visits: true, followers: true });
  });

  test("starts-soon includes eight hours and excludes nine hours", () => {
    const now = Date.parse("2026-10-27T12:00:00.000Z");
    const inEight = {
      id: "eight",
      status: "upcoming",
      startAtUtc: new Date(now + 8 * 60 * 60 * 1000),
    };
    expect(selectStartsSoon([inEight], now)).toBe(inEight);
    expect(
      selectStartsSoon(
        [{
          id: "nine",
          status: "upcoming",
          startAtUtc: new Date(now + 9 * 60 * 60 * 1000),
        }],
        now,
      ),
    ).toBeNull();
  });

  test("selects the earliest non-live future item", () => {
    const now = Date.parse("2026-10-27T12:00:00.000Z");
    const earliest = {
      id: "earliest",
      status: "upcoming",
      startAtUtc: new Date(now + 2 * 60 * 60 * 1000),
    };
    expect(
      selectStartsSoon(
        [
          {
            id: "past",
            status: "upcoming",
            startAtUtc: new Date(now - 60 * 60 * 1000),
          },
          {
            id: "live",
            status: "live",
            startAtUtc: new Date(now + 60 * 60 * 1000),
          },
          {
            id: "later",
            status: "upcoming",
            startAtUtc: new Date(now + 4 * 60 * 60 * 1000),
          },
          earliest,
        ],
        now,
      ),
    ).toBe(earliest);
  });
});
