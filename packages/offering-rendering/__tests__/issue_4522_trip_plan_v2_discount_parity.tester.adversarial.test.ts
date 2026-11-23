/**
 * issue #4522 rework (tester F3) — under a discount the display mirror
 * `tripPlanV2Math.ts` and `issue_4522_plan_v2_schedule` still agree.
 *
 * Custom amounts are set against the list price: when the net line total is
 * below the list total they scale by the trip part's ratio (whole units, the
 * last row takes the exact remainder), and rows that cannot hold degrade the
 * line to `full_only` instead of throwing. 600 seeded cases (MINSTD, seed
 * 45229) are drawn exactly as part B of the pg17 suite
 * `issue_4522_discount_plan.tester.adversarial.pg17.test.sql` draws them; the
 * md5 of their compact lines must equal the digest that suite pins for SQL.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createHash } from "node:crypto";

import {
  computeTripPlanV2Schedule,
  type TripPaymentPlanV2,
  TripPlanV2Error,
  type TripPlanV2Schedule,
} from "../tripPlanV2Math.ts";

/** The digest pinned in the pg17 suite, part B. */
const SQL_DISCOUNT_PARITY_DIGEST = "4cfb26a24c1d6a321f2ef953c849841a";

const line = (i: number, s: TripPlanV2Schedule): string =>
  `${i}|${s.availability}|${s.deposit_minor}|${s.count_given}|${s.final_due_at}|` +
  s.rows.map((r) => `${r.due_at}:${r.amount_minor}:${r.addon_portion_minor}`)
    .join(",");

Deno.test("F3: the tester's case scales with the sale and never throws", () => {
  const plan: TripPaymentPlanV2 = {
    v: 2,
    deposit: { mode: "percent", pct: 25 },
    count: 3,
    final_due_days_before_start: 30,
    auto_adjust: true,
    flex: { enabled: false },
    custom_amounts_minor: [40_000, 30_000],
  };
  const at = (lineNetMinor: number, lineListMinor: number | null) =>
    computeTripPlanV2Schedule({
      lineNetMinor,
      lineListMinor,
      units: 1,
      plan,
      tripStartAt: new Date("2027-06-10T18:00:00Z"),
      timeZone: "America/New_York",
      bookedAt: new Date("2026-11-22T15:00:00Z"),
    });
  const sale = at(90_000, 100_000);
  assertEquals(sale.availability, "plan");
  assertEquals(sale.deposit_minor, 22_500);
  assertEquals(sale.rows.map((r) => r.amount_minor), [36_000, 27_000, 4_500]);
  // Without a list price the host's amounts are used as set.
  assertEquals(at(100_000, null).rows.map((r) => r.amount_minor), [
    40_000,
    30_000,
    5_000,
  ]);
  // A deep discount with an amount deposit: the rows cannot hold.
  const deep = computeTripPlanV2Schedule({
    lineNetMinor: 1_000,
    lineListMinor: 100_000,
    units: 1,
    plan: { ...plan, deposit: { mode: "amount", amount_minor: 900 } },
    tripStartAt: new Date("2027-06-10T18:00:00Z"),
    timeZone: "America/New_York",
    bookedAt: new Date("2026-11-22T15:00:00Z"),
  });
  assertEquals(deep.availability, "full_only");
  assertEquals(deep.rows, []);
  assertEquals(deep.deposit_minor, 1_000);
});

Deno.test("F3 parity: 600 discounted cases hash to the SQL suite's digest", () => {
  let x = 45229;
  const next = (): number => {
    x = (x * 48271) % 2147483647;
    return x;
  };
  const zones = ["Africa/Lagos", "America/New_York", "Europe/London", "UTC"];
  const out: string[] = [];
  let errors = 0;
  for (let i = 1; i <= 600; i += 1) {
    const units = 1 + (next() % 4);
    const list = (100 + (next() % 50_000_000)) * units;
    let bps = 0;
    if (next() % 4 !== 0) bps = next() % 9_900;
    const net = list - Math.floor((list * bps) / 10_000);
    const deposit: TripPaymentPlanV2["deposit"] = next() % 2 === 0
      ? { mode: "percent", pct: 1 + (next() % 100) }
      : { mode: "amount", amount_minor: 100 + (next() % 200_000) };
    const count = 1 + (next() % 12);
    const finalDays = next() % 181;
    const auto = next() % 3 !== 0;
    let custom: number[] | undefined;
    if (next() % 2 === 0 && count > 1) {
      const cap = Math.max(1, Math.floor(Math.floor((2 * list) / units) / count));
      custom = [];
      for (let k = 1; k <= count - 1; k += 1) custom.push(100 + (next() % cap));
    }
    const zone = zones[next() % 4];
    let start = 1_798_761_600 + (next() % 730) * 86_400;
    start += next() % 86_400;
    let booked = start - (next() % 400) * 86_400;
    booked -= next() % 86_400;
    let addonToday = 0;
    if (next() % 3 === 0) addonToday = next() % 50_000;
    let addonSpread = 0;
    if (next() % 3 === 0) addonSpread = next() % 80_000;
    const plan: TripPaymentPlanV2 = {
      v: 2,
      deposit,
      count,
      final_due_days_before_start: finalDays,
      auto_adjust: auto,
      ...(custom !== undefined ? { custom_amounts_minor: custom } : {}),
    } as TripPaymentPlanV2;
    try {
      out.push(line(
        i,
        computeTripPlanV2Schedule({
          lineNetMinor: net,
          lineListMinor: list,
          units,
          plan,
          tripStartAt: new Date(start * 1000),
          timeZone: zone,
          bookedAt: new Date(booked * 1000),
          addonTodayMinor: addonToday,
          addonSpreadMinor: addonSpread,
        }),
      ));
    } catch (error) {
      errors += 1;
      if (!(error instanceof TripPlanV2Error)) throw error;
      out.push(`${i}|ERR:${error.code}`);
    }
  }
  assertEquals(errors, 0);
  const digest = createHash("md5").update(out.join("\n")).digest("hex");
  if (digest !== SQL_DISCOUNT_PARITY_DIGEST && Deno.env.get("PARITY_DUMP")) {
    Deno.writeTextFileSync(Deno.env.get("PARITY_DUMP")!, out.join("\n"));
  }
  assertEquals(digest, SQL_DISCOUNT_PARITY_DIGEST);
});
