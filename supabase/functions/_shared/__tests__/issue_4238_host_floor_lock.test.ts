// MINGLA-INVARIANT: I-4238-FEE-ONE-RATE | issue #4238 | the Host fee is 15%; credit = floor(pay x 0.85); a full withdraw of unspent credit returns the fee share; Host-facing amounts are grossed up only through hostMinimumPayCents.
// MINGLA-INVARIANT: I-4238-HOST-FLOOR-LOCK | issue #4238 | a Host / Ari minimum is the price of ONE ad set. In what the Host pays (HOST_FEE_RATIO via hostMinimumPayCents) a USD connection with the production floors gives Meta 118, Snapchat 589, TikTok 2353 per day, on every page and every goal. Nothing is added on top.
// MINGLA-INVARIANT: I-4238-HOST-ONE-ADSET | issue #4238 | admin-ad-create-campaign builds staged ad sets only for Admin (owner_kind "mingla"); Host and Ari ads are one ad set per app.
// Issue #4238 W1 — the binding floor rule (Seth, 16 Nov), the fee contract
// (F-1..F-3) and one ad set per app for Host and Ari (item 6b).
//
// @invariant I-4238-HOST-FLOOR-LOCK
//   owner: supabase/functions/_shared/adHostPlanRules.ts hostDailyMinimumCents
//          + supabase/functions/ad-plan/index.ts hostDailyMinimums
//   rule: a Host / Ari minimum is the price of ONE ad set. In what the Host
//         pays (HOST_FEE_RATIO via hostMinimumPayCents) a USD connection with
//         the production floors gives Meta 118, Snapchat 589, TikTok 2353 per
//         day, on every page and every goal. Nothing is added on top.
//
// @invariant I-4238-HOST-ONE-ADSET
//   owner: supabase/functions/_shared/adHostPlanRules.ts paidSocialStagesApply
//   rule: admin-ad-create-campaign builds staged ad sets only for Admin
//         (owner_kind "mingla"); Host and Ari ads are one ad set per app.
//
// @invariant I-4238-FEE-ONE-RATE
//   owner: supabase/functions/_shared/adMoney.ts HOST_FEE_RATIO
//   rule: the Host fee is 15%; credit = floor(pay x 0.85); a full withdraw of
//         unspent credit returns the fee share; Host-facing amounts are
//         grossed up only through hostMinimumPayCents.

import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  allocateWithdrawFromLots,
  creditCentsFromPay,
  feeCentsFromPay,
  HOST_FEE_RATIO,
  hostMinimumPayCents,
  quoteTopUp,
  quoteWithdraw,
} from "../adMoney.ts";
import {
  hostDailyMinimumCents,
  paidSocialStagesApply,
} from "../adHostPlanRules.ts";
import { hostDailyMinimums } from "../../ad-plan/index.ts";
import type { AdConnectionRow } from "../adChannelCore.ts";

const PRODUCTION_FLOORS = {
  imp: 100,
  video_views: 100,
  high_freq: 500,
  low_freq: 4000,
};

const EXPECTED_PAY = { meta: 118, snapchat: 589, tiktok: 2353 } as const;

function connections(): AdConnectionRow[] {
  return [
    {
      id: "c-meta",
      platform: "meta",
      currency: "USD",
      extra: { minimum_budgets: PRODUCTION_FLOORS },
    },
    { id: "c-snap", platform: "snapchat", currency: "USD", extra: {} },
    { id: "c-tiktok", platform: "tiktok", currency: "USD", extra: {} },
  ] as unknown as AdConnectionRow[];
}

/** The fx_rate_snapshots read hostDailyMinimums makes; a USD brand needs no rate. */
function fakeDb(): never {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };
  return {
    from: () => chain,
    rpc: () => Promise.reject(new Error("no FX expected for a USD brand")),
  } as never;
}

/** The floor lock: setup rows must equal the one-ad-set pay prices exactly. */
function assertFloorLock(rows: Record<string, unknown>[]): void {
  for (const [platform, pay] of Object.entries(EXPECTED_PAY)) {
    const row = rows.find((item) => item.platform === platform);
    assert(row, `${platform} row`);
    for (const goal of ["visits", "sales"]) {
      assertEquals(
        row[`${goal}_daily_minimum_pay_cents`],
        pay,
        `${platform} ${goal} pay minimum`,
      );
      assertEquals(
        hostMinimumPayCents(Number(row[`${goal}_daily_minimum_cents`])),
        pay,
        `${platform} ${goal} credit minimum grosses up to the pay minimum`,
      );
    }
  }
}

Deno.test("floor lock: ad-plan setup minimums are Meta 118, Snapchat 589, TikTok 2353 in pay terms", async () => {
  const rows = await hostDailyMinimums(fakeDb(), connections(), "USD");
  assertFloorLock(rows);
  // Credit terms (what the Host budget is sent in and the server compares).
  const meta = rows.find((row) => row.platform === "meta")!;
  assertEquals(meta.sales_daily_minimum_cents, 100);
  assertEquals(meta.visits_daily_minimum_cents, 100);
});

Deno.test("floor lock: the minimum is the same on event and non-event pages, visits and sales", () => {
  // hostDailyMinimumCents takes no page input: an event page is no longer
  // staged, so the event and non-event minimum are the same number.
  assertEquals(hostDailyMinimumCents.length, 3);
  const conns = connections();
  for (const conn of conns) {
    const expected = EXPECTED_PAY[conn.platform as keyof typeof EXPECTED_PAY];
    for (const goal of ["visits", "sales"] as const) {
      const credit = hostDailyMinimumCents(
        conn.platform,
        conn as unknown as Record<string, unknown>,
        goal,
      );
      assertEquals(hostMinimumPayCents(credit ?? -1), expected);
    }
  }
});

Deno.test("floor lock: preflight checks the one-ad-set minimum on every page", async () => {
  const source = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );
  const preflight = source.slice(
    source.indexOf("I-4238-APP-MINIMUM-BEFORE-HOLD"),
  ).slice(0, 2200);
  assert(preflight.includes("minimum_cents: hostDailyMinimumCents("));
  assert(!preflight.includes("{ staged:"), "no staged option on preflight");
  assert(!preflight.includes("event_id"), "the page's event never raises it");
});

// ── Separate failing cases: each old value breaks the lock ────────────────────

function rowsWith(
  platform: string,
  creditCents: number,
): Record<string, unknown>[] {
  const base = [
    { platform: "meta", credit: 100 },
    { platform: "snapchat", credit: 500 },
    { platform: "tiktok", credit: 2000 },
  ].map((row) =>
    row.platform === platform ? { ...row, credit: creditCents } : row
  );
  return base.map((row) => ({
    platform: row.platform,
    visits_daily_minimum_cents: row.credit,
    sales_daily_minimum_cents: row.credit,
    visits_daily_minimum_pay_cents: hostMinimumPayCents(row.credit),
    sales_daily_minimum_pay_cents: hostMinimumPayCents(row.credit),
  }));
}

Deno.test("floor lock fails on the old Meta low_freq 4000", () => {
  assertThrows(() => assertFloorLock(rowsWith("meta", 4000)));
});

Deno.test("floor lock fails on the staged worst case (991 / 4991 / 19991)", () => {
  assertThrows(() => assertFloorLock(rowsWith("meta", 991)));
  assertThrows(() => assertFloorLock(rowsWith("snapchat", 4991)));
  assertThrows(() => assertFloorLock(rowsWith("tiktok", 19991)));
});

Deno.test("floor lock fails on the old TikTok 5000", () => {
  assertThrows(() => assertFloorLock(rowsWith("tiktok", 5000)));
});

Deno.test("floor lock fails on the old Snapchat 2000", () => {
  assertThrows(() => assertFloorLock(rowsWith("snapchat", 2000)));
});

Deno.test("floor lock control: the correct rows pass", () => {
  assertFloorLock(rowsWith("meta", 100));
});

// ── F-3: the fee pin ──────────────────────────────────────────────────────────

Deno.test("F-3 HOST_FEE_RATIO is 0.15; a 50,000 top-up gives 42,500 credit", () => {
  assertEquals(HOST_FEE_RATIO, 0.15);
  assertEquals(creditCentsFromPay(50_000), 42_500);
  assertEquals(feeCentsFromPay(50_000), 7_500);
  const quote = quoteTopUp(50_000, "USD");
  assert(quote.ok);
  assertEquals(quote.fee_cents, 7_500);
  assertEquals(quote.credit_cents, 42_500);
});

Deno.test("F-3 a full withdraw of unspent credit returns the fee share", () => {
  const lots = [{
    id: "lot-1",
    credit_remaining_cents: 42_500,
    pay_remaining_cents: 50_000,
    fee_remaining_cents: 7_500,
  }];
  const result = allocateWithdrawFromLots(lots, 42_500);
  assert(result.ok);
  assertEquals(result.fee_returned_cents, 7_500);
  assertEquals(result.refund_cents, 50_000);
  const quote = quoteWithdraw(42_500);
  assert(quote.ok);
  assertEquals(quote.fee_returned_cents, 7_500);
});

Deno.test("F-3 a 100-cent provider floor is ceil(100 / 0.85) = 118 in pay terms", () => {
  assertEquals(hostMinimumPayCents(100), Math.ceil(100 / 0.85));
  assertEquals(hostMinimumPayCents(100), 118);
  // Round trip: paying the pay minimum buys exactly the credit floor.
  for (const floor of [100, 500, 2000]) {
    assertEquals(creditCentsFromPay(hostMinimumPayCents(floor)), floor);
  }
  assertEquals(hostMinimumPayCents(0), 0);
  assertEquals(hostMinimumPayCents(-5), 0);
});

Deno.test("F-1 no second copy of the fee rate in the W1 Host money paths", async () => {
  for (
    const path of ["../../ad-plan/index.ts", "../adHostPlanRules.ts"]
  ) {
    const source = await Deno.readTextFile(new URL(path, import.meta.url));
    assert(!/0\.85\b/.test(source), `${path} has a 0.85 literal`);
    assert(!/\b0\.15\b/.test(source), `${path} has a 0.15 literal`);
  }
});

// ── 6b: one ad set per app for Host and Ari ───────────────────────────────────

Deno.test("6b staging applies only to Admin event ads", () => {
  assertEquals(paidSocialStagesApply("host", "event-1"), false);
  assertEquals(paidSocialStagesApply("mingla", "event-1"), true);
  assertEquals(paidSocialStagesApply("mingla", null), false);
  assertEquals(paidSocialStagesApply("mingla", "  "), false);
  assertEquals(paidSocialStagesApply("host", null), false);
});

Deno.test("6b every paid-social stage branch in create asks paidSocialStagesApply", async () => {
  const source = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  for (
    const branch of [
      "if (paidSocialStagesApply(requestedOwnerKind, destEventIdS)) {",
      "if (paidSocialStagesApply(requestedOwnerKind, destEventIdT)) {",
      "if (paidSocialStagesApply(requestedOwnerKind, destEventId)) {",
    ]
  ) assert(source.includes(branch), branch);
  // preparePaidSocialStages runs only inside those three branches.
  assertEquals(source.split("await preparePaidSocialStages(").length - 1, 3);
  assert(!source.includes("    if (destEventIdS) {"));
  assert(!source.includes("      if (destEventIdT) {"));
  assert(!source.includes("  if (destEventId) {"));
  // X-4 is gone for Host: the stage_creative_ids check sits in
  // preparePaidSocialStages, which a Host ad never reaches.
  const prepare = source.slice(
    source.indexOf("async function preparePaidSocialStages("),
  );
  assert(prepare.slice(0, 3000).includes("stage_creative_ids"));
  // Spark (staged-only) is refused for Host at create and in ad-plan.
  assert(source.includes('detail: "tiktok_spark_admin_only"'));
  const plan = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );
  assert(plan.includes('plan.owner_kind === "host" && spark.present'));
});
