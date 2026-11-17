// MINGLA-INVARIANT: I-4238-HOST-MIN-ONE-AD-SET | issue #4238 | cross-currency minimums = one ad set's floor converted, × 1.02, grossed up for the fee; never step-rounded; no rate → no amount and currency_unavailable: true.
// Issue #4238 W4b — item 4 floor rule end to end in another currency
// (amendment B §4, SC-B4.1): an NGN brand on a USD account gets
// ceil(ceil(convert(F) × 1.02) ÷ 0.85) — the 2% FX margin is the only
// allowance, nothing is rounded to a step, and a missing rate says so.
//
// @invariant I-4238-HOST-MIN-ONE-AD-SET (FX leg)
//   owner: supabase/functions/ad-plan/index.ts hostDailyMinimums
//   rule: cross-currency minimums = one ad set's floor converted, × 1.02,
//         grossed up for the fee; never step-rounded; no rate → no amount
//         and currency_unavailable: true.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hostDailyMinimums } from "../../ad-plan/index.ts";
import { hostMinimumPayCents } from "../adMoney.ts";
import type { AdConnectionRow } from "../adChannelCore.ts";

const RATE = 1_600; // ₦1,600 = $1 (design v8 sample)
const conns = [
  {
    id: "m",
    platform: "meta",
    currency: "USD",
    extra: {
      minimum_budgets: {
        imp: 100,
        video_views: 100,
        high_freq: 500,
        low_freq: 4000,
      },
    },
  },
  { id: "s", platform: "snapchat", currency: "USD", extra: {} },
  { id: "t", platform: "tiktok", currency: "USD", extra: {} },
] as unknown as AdConnectionRow[];

function db(snapshot: boolean): never {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () =>
      Promise.resolve({ data: snapshot ? { id: "fx1" } : null, error: null }),
  };
  return {
    from: () => chain,
    rpc: (_name: string, args: { p_amount: number }) =>
      Promise.resolve({ data: args.p_amount * RATE, error: null }),
  } as never;
}

Deno.test("SC-B4.1 FX: NGN on a USD account = ceil(ceil(F × rate × 1.02) / 0.85), no step rounding", async () => {
  const rows = await hostDailyMinimums(db(true), conns, "NGN");
  for (
    const [platform, floor] of [["meta", 100], ["snapchat", 500], [
      "tiktok",
      2000,
    ]] as const
  ) {
    const row = rows.find((item) => item.platform === platform)!;
    const credit = Math.ceil(floor * RATE * 1.02);
    assertEquals(row.sales_daily_minimum_cents, credit, `${platform} credit`);
    assertEquals(
      row.sales_daily_minimum_pay_cents,
      hostMinimumPayCents(credit),
      `${platform} pay`,
    );
    assertEquals(
      row.visits_daily_minimum_pay_cents,
      row.sales_daily_minimum_pay_cents,
    );
    assertEquals(
      row.sales_daily_minimum_pay_cents,
      Math.ceil((credit * 100) / 85),
      `${platform} independent gross-up`,
    );
  }
  // Meta: ₦1,632 of spend → ₦1,920 a day in pay terms (not rounded up to ₦2,000).
  assertEquals(
    rows.find((r) => r.platform === "meta")!.sales_daily_minimum_pay_cents,
    192_000,
  );
  // Meta at an uneven rate is never pushed to a step.
  const odd = await hostDailyMinimums(
    {
      ...db(true) as object,
      rpc: (_n: string, a: { p_amount: number }) =>
        Promise.resolve({ data: a.p_amount * 1_583, error: null }),
    } as never,
    conns,
    "NGN",
  );
  const metaOdd = odd.find((r) => r.platform === "meta")!;
  const credit = Math.ceil(100 * 1_583 * 1.02);
  assertEquals(
    metaOdd.sales_daily_minimum_pay_cents,
    Math.ceil((credit * 100) / 85),
  );
  assertEquals(metaOdd.sales_daily_minimum_pay_cents, 189_960);
  assert(
    Number(metaOdd.sales_daily_minimum_pay_cents) % 100 !== 0,
    "not rounded to a major unit",
  );
});

Deno.test("adversarial: no FX snapshot → currency_unavailable, no amount", async () => {
  const rows = await hostDailyMinimums(db(false), conns, "NGN");
  for (const row of rows) {
    assertEquals(row.currency_unavailable, true);
    assertEquals(row.sales_daily_minimum_pay_cents, undefined);
  }
});
