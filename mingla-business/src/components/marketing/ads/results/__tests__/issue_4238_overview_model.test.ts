/**
 * #4238 Overview — the pure display rules: the seen-to-sold funnel (null
 * steps omitted, rates over 100% hidden), the "Per …" tile fallback chain
 * (never "—"), the learning week length and the "Updated" buckets.
 */
import { describe, expect, test } from "@jest/globals";

import type { HostAdDailyPoint } from "../../../../../services/hostAdCampaignService";
import {
  learningDay,
  learningTotal,
  overviewFunnel,
  overviewRate,
  perResultTile,
  updatedAgo,
  verdictCopy,
} from "../hostAdOverviewModel";

const point = (over: Partial<HostAdDailyPoint>): HostAdDailyPoint =>
  ({
    day: "2026-11-19",
    spend_host_cents: null,
    spend_provider_cents: null,
    provider_currency: null,
    impressions: null,
    clicks: null,
    page_visits: null,
    results: null,
    ...over,
  }) as HostAdDailyPoint;

describe("#4238 overviewFunnel", () => {
  test("Tinoe: Shown 26,660, Tapped 415 (1.6%), Reached 314 (76%), Started checkout 0, Bought 0", () => {
    const steps = overviewFunnel({
      daily: [point({ impressions: 20000, clicks: 300, page_visits: 200 }), point({ impressions: 6660, clicks: 115, page_visits: 114 })],
      goal: "sales",
      checkoutStarted: 0,
      orders: 0,
      signUps: 0,
    });
    expect(steps.map((s) => [s.key, s.value, s.rate?.value ?? null])).toEqual([
      ["shown", 26660, null],
      ["tapped", 415, "1.6"],
      ["reached", 314, "76"],
      ["checkout", 0, null],
      ["bought", 0, null],
    ]);
  });

  test("a null source is omitted, never drawn as 0; zero page visits are omitted", () => {
    const steps = overviewFunnel({
      daily: [point({ impressions: 100, clicks: null, page_visits: 0 })],
      goal: "sales",
      checkoutStarted: null,
      orders: undefined,
      signUps: 0,
    });
    expect(steps.map((s) => s.key)).toEqual(["shown"]);
  });

  test("signups end at Signed up; visits stop at the page", () => {
    const daily = [point({ impressions: 100, clicks: 10, page_visits: 8 })];
    expect(overviewFunnel({ daily, goal: "signups", checkoutStarted: 5, orders: 2, signUps: 3 }).map((s) => s.key)).toEqual([
      "shown",
      "tapped",
      "reached",
      "signedUp",
    ]);
    expect(overviewFunnel({ daily, goal: "visits", checkoutStarted: 5, orders: 2, signUps: 3 }).map((s) => s.key)).toEqual([
      "shown",
      "tapped",
      "reached",
    ]);
  });

  test("a rate over 100% is hidden", () => {
    const steps = overviewFunnel({
      daily: [point({ impressions: 100, clicks: 10, page_visits: 12 })],
      goal: "visits",
      checkoutStarted: null,
      orders: null,
      signUps: null,
    });
    expect(steps.find((s) => s.key === "reached")?.rate).toBeNull();
    expect(overviewRate(5, 0)).toBeNull();
    expect(overviewRate(1, 10)).toBe("10");
    expect(overviewRate(99, 1000)).toBe("9.9");
  });
});

describe("#4238 perResultTile", () => {
  test("per result, then per page visit, then per tap, then hidden", () => {
    expect(perResultTile({ count: 2, spentPay: 1000, visits: 300, clicks: 400 })).toEqual({ labelKey: "detail.tilePer", pay: 500 });
    expect(perResultTile({ count: 0, spentPay: 1000, visits: 314, clicks: 400 })).toEqual({
      labelKey: "overview.tilePerVisit",
      pay: Math.round(1000 / 314),
    });
    expect(perResultTile({ count: 0, spentPay: 1000, visits: null, clicks: 400 })).toEqual({ labelKey: "overview.tilePerTap", pay: 3 });
    expect(perResultTile({ count: 0, spentPay: 1000, visits: 0, clicks: 0 })).toBeNull();
    expect(perResultTile({ count: 3, spentPay: 0, visits: 1, clicks: 1 })).toBeNull();
  });
});

describe("#4238 learning week", () => {
  test("3 → 3, 10 → 7, no end → 7; the day is clamped", () => {
    expect(learningTotal(3)).toBe(3);
    expect(learningTotal(10)).toBe(7);
    expect(learningTotal(null)).toBe(7);
    expect(learningTotal(undefined)).toBe(7);
    expect(learningDay(1, null, 3)).toBe(1);
    expect(learningDay(5, null, 3)).toBe(3);
    expect(learningDay(null, 2, 7)).toBe(2);
    expect(learningDay(null, null, 7)).toBe(1);
    expect(learningDay(0, null, 7)).toBe(1);
  });
});

describe("#4238 updatedAgo", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  test("buckets: now, min, h, d; unknown is null", () => {
    expect(updatedAgo("2026-11-19T11:59:30Z", now)).toEqual({ key: "overview.updatedNow", count: 0 });
    expect(updatedAgo("2026-11-19T11:48:00Z", now)).toEqual({ key: "overview.updatedMin", count: 12 });
    expect(updatedAgo("2026-11-19T09:00:00Z", now)).toEqual({ key: "overview.updatedHours", count: 3 });
    expect(updatedAgo("2026-11-17T11:00:00Z", now)).toEqual({ key: "overview.updatedDays", count: 2 });
    expect(updatedAgo(null, now)).toBeNull();
    expect(updatedAgo("not a date", now)).toBeNull();
  });
});

describe("#4238 verdictCopy", () => {
  const v = (state: "too_early" | "on_track" | "behind" | "ahead", drop: "not_buying" | "too_dear" | null = null) => ({
    state,
    drop_off: drop,
    cost_per_result_cents: null,
    expected_cost_per_result_cents: 100,
  });
  test("title and body per state; sign-ups read 'signed up'", () => {
    expect(verdictCopy(v("behind", "not_buying"), "sales", 0)).toEqual({
      titleKey: "overview.verdictTitle.behind",
      bodyKey: "overview.dropOff.not_buying",
    });
    expect(verdictCopy(v("behind", "not_buying"), "signups", 0).bodyKey).toBe("overview.dropOff.not_signing_up");
    expect(verdictCopy(v("on_track"), "sales", 0).bodyKey).toBe("overview.verdictBody.onTrackNone");
    expect(verdictCopy(v("on_track"), "sales", 2).bodyKey).toBe("overview.verdictBody.on_track");
    expect(verdictCopy(v("too_early"), "sales", 0).bodyKey).toBe("overview.verdictBody.too_early");
    expect(verdictCopy(v("ahead"), "sales", 4).bodyKey).toBe("overview.verdictBody.ahead");
  });
});
