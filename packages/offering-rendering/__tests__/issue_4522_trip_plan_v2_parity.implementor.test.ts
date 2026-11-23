/**
 * issue #4522 slice 2 — the display mirror `tripPlanV2Math.ts` agrees with
 * `issue_4522_plan_v2_schedule` (migration 20281202034522).
 *
 * 1. The spec §6.2 vectors give exactly the listed dates (09:00 Africa/Lagos)
 *    and amounts (SC-2), and the late / window / full-only answers (SC-3).
 * 2. 200 seeded random cases (MINSTD, seed 4522) are drawn exactly as the pg17
 *    suite `issue_4522_plan_v2_checkout.implementor.pg17.test.sql` (part B)
 *    draws them; the md5 of their compact lines must equal the digest that
 *    suite pins for the SQL outputs. Either side drifting fails both tests.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createHash } from "node:crypto";

import {
  computeTripPlanV2Schedule,
  TRIP_PLAN_V2_LIMITS,
  type TripPaymentPlanV2,
  TripPlanV2Error,
  type TripPlanV2Schedule,
} from "../tripPlanV2Math.ts";

/** The digest pinned in the pg17 suite, part B. */
const SQL_PARITY_DIGEST = "342cb624b2008d433818c99589f86866";

const line = (i: number, s: TripPlanV2Schedule): string =>
  `${i}|${s.availability}|${s.deposit_minor}|${s.count_given}|${s.final_due_at}|` +
  s.rows.map((r) => `${r.due_at}:${r.amount_minor}:${r.addon_portion_minor}`)
    .join(",");

const BASE_PLAN: TripPaymentPlanV2 = {
  v: 2,
  deposit: { mode: "percent", pct: 25 },
  count: 3,
  final_due_days_before_start: 30,
  auto_adjust: true,
  flex: { enabled: false },
};

const lagosVector = (booked: string, plan = BASE_PLAN): string =>
  line(
    0,
    computeTripPlanV2Schedule({
      lineNetMinor: 120_000_000,
      units: 1,
      plan,
      tripStartAt: new Date("2027-03-12T08:00:00Z"),
      timeZone: "Africa/Lagos",
      bookedAt: new Date(`${booked}T12:00:00+01:00`),
    }),
  );

Deno.test("SC-2: the spec §6.2 vectors", () => {
  assertEquals(
    lagosVector("2026-11-19"),
    "0|plan|30000000|3|2027-02-10T08:00:00Z|2026-12-17T08:00:00Z:30000000:0,2027-01-13T08:00:00Z:30000000:0,2027-02-10T08:00:00Z:30000000:0",
  );
  assertEquals(
    lagosVector("2027-01-20"),
    "0|plan|30000000|3|2027-02-10T08:00:00Z|2027-01-27T08:00:00Z:30000000:0,2027-02-03T08:00:00Z:30000000:0,2027-02-10T08:00:00Z:30000000:0",
  );
  assertEquals(
    lagosVector("2027-01-25"),
    "0|plan|30000000|2|2027-02-10T08:00:00Z|2027-02-02T08:00:00Z:45000000:0,2027-02-10T08:00:00Z:45000000:0",
  );
  assertEquals(
    lagosVector("2027-02-05"),
    "0|full_window|120000000|0|2027-02-10T08:00:00Z|",
  );
  assertEquals(
    line(
      0,
      computeTripPlanV2Schedule({
        lineNetMinor: 120_000,
        units: 1,
        plan: {
          v: 2,
          deposit: { mode: "amount", amount_minor: 25_000 },
          count: 4,
          final_due_days_before_start: 30,
        },
        tripStartAt: new Date("2027-03-12T08:00:00Z"),
        timeZone: "UTC",
        bookedAt: new Date("2026-11-12T10:00:00Z"),
      }),
    ),
    "0|plan|25000|4|2027-02-10T09:00:00Z|2026-12-05T09:00:00Z:23700:0,2026-12-27T09:00:00Z:23700:0,2027-01-19T09:00:00Z:23700:0,2027-02-10T09:00:00Z:23900:0",
  );
});

Deno.test("SC-3: auto-adjust off gives full_only; custom rows fold; add-ons split", () => {
  assertEquals(
    lagosVector("2027-01-25", { ...BASE_PLAN, auto_adjust: false }),
    "0|full_only|120000000|0|2027-02-10T08:00:00Z|",
  );
  assertEquals(
    lagosVector("2027-01-25", {
      ...BASE_PLAN,
      custom_amounts_minor: [10_000_000, 20_000_000],
    }),
    "0|plan|30000000|2|2027-02-10T08:00:00Z|2027-02-02T08:00:00Z:30000000:0,2027-02-10T08:00:00Z:60000000:0",
  );
  assertEquals(
    line(
      0,
      computeTripPlanV2Schedule({
        lineNetMinor: 120_000_000,
        units: 1,
        plan: BASE_PLAN,
        tripStartAt: new Date("2027-03-12T08:00:00Z"),
        timeZone: "Africa/Lagos",
        bookedAt: new Date("2026-11-19T12:00:00+01:00"),
        addonTodayMinor: 500_000,
        addonSpreadMinor: 1_000_050,
      }),
    ),
    "0|plan|30500000|3|2027-02-10T08:00:00Z|2026-12-17T08:00:00Z:30333300:333300,2027-01-13T08:00:00Z:30333300:333300,2027-02-10T08:00:00Z:30333450:333450",
  );
  assertEquals(TRIP_PLAN_V2_LIMITS.countMax, 12);
  assertEquals(TRIP_PLAN_V2_LIMITS.minGapDays, 7);
});

const TIME_ZONES = [
  "Africa/Lagos",
  "America/New_York",
  "Europe/London",
  "UTC",
] as const;

/** The pg17 suite's part B, draw for draw. */
function seededLines(): string[] {
  let x = 4522;
  const r = (): number => {
    x = (x * 48271) % 2147483647;
    return x;
  };
  const out: string[] = [];
  for (let i = 1; i <= 200; i += 1) {
    const p = 100 + (r() % 50_000_000);
    const units = 1 + (r() % 4);
    const deposit: TripPaymentPlanV2["deposit"] = r() % 2 === 0
      ? { mode: "percent", pct: 1 + (r() % 100) }
      : { mode: "amount", amount_minor: 100 + (r() % 200_000) };
    const count = 1 + (r() % 12);
    const finalDays = r() % 181;
    const auto = r() % 3 !== 0;
    let custom: number[] | undefined;
    if (r() % 5 === 0 && count > 1) {
      custom = [];
      for (let k = 1; k <= count - 1; k += 1) custom.push(100 + (r() % 20_000));
    }
    const zone = TIME_ZONES[r() % 4];
    let start = 1_798_761_600 + (r() % 730) * 86_400;
    start += r() % 86_400;
    let booked = start - (r() % 400) * 86_400;
    booked -= r() % 86_400;
    if (r() % 10 === 0) booked += 3 * 86_400;
    let addonToday = 0;
    if (r() % 3 === 0) addonToday = r() % 50_000;
    let addonSpread = 0;
    if (r() % 3 === 0) addonSpread = r() % 80_000;
    const plan: TripPaymentPlanV2 = {
      v: 2,
      deposit,
      count,
      final_due_days_before_start: finalDays,
      auto_adjust: auto,
      ...(custom !== undefined ? { custom_amounts_minor: custom } : {}),
    };
    try {
      out.push(
        line(
          i,
          computeTripPlanV2Schedule({
            lineNetMinor: p,
            units,
            plan,
            tripStartAt: new Date(start * 1000),
            timeZone: zone,
            bookedAt: new Date(booked * 1000),
            addonTodayMinor: addonToday,
            addonSpreadMinor: addonSpread,
          }),
        ),
      );
    } catch (error) {
      if (!(error instanceof TripPlanV2Error)) throw error;
      out.push(`${i}|ERR:${error.code}`);
    }
  }
  return out;
}

Deno.test("parity: 200 seeded cases hash to the SQL suite's digest", () => {
  const lines = seededLines();
  assertEquals(lines.length, 200);
  const digest = createHash("md5").update(lines.join("\n")).digest("hex");
  assertEquals(
    digest,
    SQL_PARITY_DIGEST,
    `first lines: ${lines.slice(0, 3).join(" / ")}`,
  );
});
