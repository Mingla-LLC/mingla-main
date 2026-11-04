/**
 * @jest-environment ./__tests__/support/issue3801TimeZoneEnvironment.cjs
 *
 * #4238 media-buyer, wave C — budget as a total for the run, split so every
 * app gets its minimum first. The number of days (and so the daily amount)
 * is the same in every viewer time zone: the days come from the page's own
 * calendar, never the viewer's.
 */
import { describe, expect, it } from "@jest/globals";

import { hostAdDayOf } from "../hostAdBuilderRules";
import {
  hostAdAllocations,
  hostAdDailyFromTotal,
  hostAdDaysInRun,
  hostAdProportionalCents,
  hostAdRecommendedDaily,
  hostAdSplitWithMinimums,
} from "../hostAdBudget";

const VIEWERS = ["America/New_York", "Africa/Lagos", "Pacific/Kiritimati", "America/Los_Angeles", "UTC"];

function viewIn(zone: string): void {
  (globalThis as unknown as { __setProcessTimeZone: (z: string) => void }).__setProcessTimeZone(zone);
  const probe = new Date("2026-12-06T12:00:00Z");
  const expectedHour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hourCycle: "h23" }).format(probe),
  );
  expect(probe.getHours()).toBe(expectedHour);
}

describe("#4238 C1 total for the run, in every viewer zone", () => {
  it.each(VIEWERS)("a Lagos page from 3 Nov to 6 Dec is 34 days for a viewer in %s", (zone) => {
    viewIn(zone);
    // 23:30 Lagos time on 3 Nov is already 4 Nov in Kiritimati and still
    // 3 Nov in Los Angeles; the page's own day is what counts.
    const start = hostAdDayOf("2026-11-03T22:30:00Z", "Africa/Lagos");
    const end = hostAdDayOf("2026-12-06T22:59:00Z", "Africa/Lagos");
    expect([start, end]).toEqual(["2026-11-03", "2026-12-06"]);
    const days = hostAdDaysInRun(start, end);
    expect(days).toBe(34);
    expect(hostAdDailyFromTotal(5_000_000_00, days as number)).toBe(14_705_882);
  });
});

describe("#4238 C2 minimums first, the rest evenly", () => {
  const mins = { meta: 2_000_00, tiktok: 78_000_00, snapchat: 31_000_00 };
  it("each app gets its minimum, then an even share, adding up exactly", () => {
    const split = hostAdSplitWithMinimums(150_000_00, ["meta", "tiktok", "snapchat"], mins);
    expect(split.ok).toBe(true);
    expect(split.rows.map((row) => row.dailyCents)).toEqual([15_000_00, 91_000_00, 44_000_00]);
    expect(split.rows.reduce((sum, row) => sum + row.dailyCents, 0)).toBe(150_000_00);
  });
  it("too little names the app that can't run, before any money is set aside", () => {
    const split = hostAdSplitWithMinimums(90_000_00, ["meta", "tiktok", "snapchat"], mins);
    expect(split.ok).toBe(false);
    expect(split.short).toEqual({ platform: "tiktok", minimumCents: 78_000_00 });
  });
  it("the cap follows the daily shares and keeps every minor unit", () => {
    expect(hostAdProportionalCents(1001, [1, 1, 1])).toEqual([334, 334, 333]);
    const plan = hostAdAllocations({
      mode: "total",
      totalCents: 5_000_000_00,
      dailyCents: 0,
      days: 34,
      apps: ["meta", "tiktok", "snapchat"],
      minimums: mins,
    });
    expect(plan.ok).toBe(true);
    expect(plan.capShares.reduce((a, b) => a + b, 0)).toBe(5_000_000_00);
    expect(plan.capShares.every((cap, i) => cap >= plan.split.rows[i].dailyCents)).toBe(true);
  });
  it("recommends 1.6× the minimums, rounded up", () => {
    // NGN 111,000 of minimums → NGN 177,600 → NGN 180,000 a day.
    expect(hostAdRecommendedDaily(111_000_00)).toBe(180_000_00);
    expect(hostAdRecommendedDaily(0)).toBe(0);
  });
});
