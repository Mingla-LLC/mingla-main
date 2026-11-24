/**
 * issue #4522 (rework N8) — custom amounts under a discount scale in exact
 * integer arithmetic, so TypeScript and SQL agree at every magnitude up to
 * 9e15. The retester's case (a numeric ratio of …99999999996 that SQL used to
 * round up a whole unit) and a 9e15-scale case pin the exact rows; the pg17
 * suite issue_4522_custom_discount_exact asserts the SAME numbers from SQL.
 *
 * FAILS-ON-REVERT: compute the share as Number(a × t / tList) / 100 (or a
 * float percent) -> the 9e15 case is off by units -> red.
 */
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { computeTripPlanV2Schedule, mulDivFloor, percentFloor } from "../tripPlanV2Math.ts";

const amounts = (r: ReturnType<typeof computeTripPlanV2Schedule>) =>
  r.rows.map((row) => [row.amount_minor, row.addon_portion_minor]);

Deno.test("N8 the retester's boundary case: exact rows", () => {
  const r = computeTripPlanV2Schedule({
    lineNetMinor: 124981992650, units: 1, lineListMinor: 528649633633,
    plan: { v: 2, deposit: { mode: "amount", amount_minor: 515951 }, count: 3, final_due_days_before_start: 0,
      auto_adjust: true, custom_amounts_minor: [129724499901, 199462308800] },
    tripStartAt: new Date("2027-05-07T18:48:00Z"), timeZone: "Asia/Kathmandu",
    bookedAt: new Date("2026-04-13T07:28:00Z"), addonTodayMinor: 0, addonSpreadMinor: 428879,
  });
  assertEquals(amounts(r), [[30669180200, 142900], [47156362500, 142900], [47156362878, 143079]]);
});

Deno.test("N8 9e15 magnitude: percent deposit and custom shares stay exact", () => {
  const r = computeTripPlanV2Schedule({
    lineNetMinor: 8_999_999_999_999_937, units: 1, lineListMinor: 8_999_999_999_999_999,
    plan: { v: 2, deposit: { mode: "percent", pct: 33.5 }, count: 3, final_due_days_before_start: 0,
      auto_adjust: true, custom_amounts_minor: [1_999_999_999_999_901, 2_000_000_000_000_099] },
    tripStartAt: new Date("2027-05-07T12:00:00Z"), timeZone: "UTC",
    bookedAt: new Date("2026-04-13T12:00:00Z"), addonTodayMinor: 0, addonSpreadMinor: 0,
  });
  assertEquals(r.deposit_minor, 3_014_999_999_999_978);
  assertEquals(amounts(r), [[1_999_999_999_999_800, 0], [2_000_000_000_000_000, 0], [1_985_000_000_000_159, 0]]);
});

Deno.test("N8 helpers are exact integer arithmetic", () => {
  assertEquals(percentFloor(8_999_999_999_999_999, 33.5), 3_014_999_999_999_999);
  assertEquals(percentFloor(101, 12.5), 12);
  assertEquals(mulDivFloor(7, 3, 2, 1), 10);
});
