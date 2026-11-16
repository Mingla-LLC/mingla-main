// Issue #4238 Fix 1 — Meta's minimum follows the billing event, the real
// TikTok / Snapchat per-ad-set limits (D-1), and the Host minimum covers
// staged ad sets (X-1 / SC-9).
//
// @invariant I-4238-META-FLOOR-FOLLOWS-BILLING
//   owner: supabase/functions/_shared/adChannelCore.ts metaBudgetCategoryForBillingEvent
//   mirror: mingla-admin/src/lib/adBuilder/budgetRules.js
//   rule: the Meta floor category comes from billing_event; unknown or empty
//         falls to low_freq. Host and Ari pass the billing event their goal
//         really sends (hostAdGoalFields), and the create gate uses the same.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { metaBudgetCategoryForBillingEvent } from "../adChannelCore.ts";
import {
  type AdAudienceRow,
  type AdStage,
  buildAdStagePlan,
} from "../adAudienceStages.ts";
import {
  hostDailyMinimumCents,
  providerDailyMinimumCents,
  stagedDailyMinimumCents,
} from "../adHostPlanRules.ts";
import { AD_PLATFORM_MINIMUMS_USD_CENTS_PER_DAY } from "../adMoney.ts";

/** The production Meta connection's floors (ad_connections.extra, USD). */
const PRODUCTION_FLOORS = {
  imp: 100,
  video_views: 100,
  high_freq: 500,
  low_freq: 4000,
};
const META_USD = {
  currency: "USD",
  extra: { minimum_budgets: PRODUCTION_FLOORS },
};

Deno.test("SC-1 happy path: a Host sales ad on Meta needs $1/day, not $40", () => {
  assertEquals(providerDailyMinimumCents("meta", META_USD, "sales"), 100);
});

Deno.test("SC-1 a Host page-visits ad on Meta needs $1/day, not $5", () => {
  assertEquals(providerDailyMinimumCents("meta", META_USD, "visits"), 100);
});

Deno.test("the category follows what Meta charges for", () => {
  const floorFor = (event: string) =>
    PRODUCTION_FLOORS[metaBudgetCategoryForBillingEvent(event)];
  assertEquals(floorFor("IMPRESSIONS"), 100);
  assertEquals(floorFor("THRUPLAY"), 100);
  assertEquals(
    floorFor("LINK_CLICKS"),
    500,
    "click-billed is high_freq (SC-4)",
  );
  assertEquals(floorFor("POST_ENGAGEMENT"), 500);
  assertEquals(floorFor("APP_INSTALLS"), 4000, "low-frequency billing (SC-4)");
});

Deno.test("adversarial: an unknown or empty billing event is never cheaper", () => {
  for (
    const event of [
      "",
      "UNKNOWN",
      "impressions",
      " IMPRESSIONS",
      "OFFER_CLAIMS",
      "PURCHASE",
    ]
  ) {
    assertEquals(
      metaBudgetCategoryForBillingEvent(event),
      "low_freq",
      JSON.stringify(event),
    );
  }
});

Deno.test("SC-7 missing floors fall back to $5; a non-USD account gives null", () => {
  assertEquals(
    providerDailyMinimumCents("meta", { currency: "USD" }, "sales"),
    500,
  );
  assertEquals(
    providerDailyMinimumCents("meta", {
      currency: "USD",
      extra: { minimum_budgets: { high_freq: 500 } },
    }, "sales"),
    500,
    "the imp key is missing: the fallback, never 0",
  );
  assertEquals(
    providerDailyMinimumCents(
      "meta",
      { ...META_USD, currency: "EUR" },
      "sales",
    ),
    null,
  );
  assertEquals(
    providerDailyMinimumCents("tiktok", { currency: "NGN" }, "visits"),
    null,
  );
});

Deno.test("SC-8 D-1: TikTok $20 per ad group, Snapchat $5 per ad squad", () => {
  assertEquals(
    providerDailyMinimumCents("tiktok", { currency: "USD" }, "visits"),
    2000,
  );
  assertEquals(
    providerDailyMinimumCents("tiktok", { currency: "USD" }, "sales"),
    2000,
  );
  assertEquals(
    providerDailyMinimumCents("snapchat", { currency: "USD" }, "visits"),
    500,
  );
  assertEquals(
    providerDailyMinimumCents("reddit", { currency: "USD" }, "visits"),
    500,
  );
  assertEquals(
    providerDailyMinimumCents("google", { currency: "USD" }, "visits"),
    0,
  );
  assertEquals(AD_PLATFORM_MINIMUMS_USD_CENTS_PER_DAY.tiktok, 2000);
  assertEquals(AD_PLATFORM_MINIMUMS_USD_CENTS_PER_DAY.snapchat, 500);
});

Deno.test("SC-3/SC-5 the create gate picks the category from billing_event, at campaign and at each stage", async () => {
  const source = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  assert(
    source.includes(
      "const category = metaBudgetCategoryForBillingEvent(billingEvent);",
    ),
  );
  assert(
    !source.includes("metaBudgetCategoryForGoal"),
    "the goal-based rule is gone",
  );
  // Lifetime: floor × days at the campaign and at every stage.
  assert(
    source.includes(
      "? floorCents * (schedule.days as number)\n    : floorCents;",
    ),
  );
  assert(
    source.includes(
      'const minimumPerStage = budgetType === "lifetime"\n        ? floorCents * (schedule.days as number)',
    ),
  );
});

// ── SC-9: the Host minimum covers staged ad sets ──────────────────────────────

const BRAND = "4238f100-0000-4000-8000-000000000001";
const EVENT = "4238f100-0000-4000-8000-000000000002";
const CODES: Record<
  "meta" | "tiktok" | "snapchat",
  { retarget: string; checkout: string; buyer: string }
> = {
  meta: { retarget: "M1", checkout: "M5", buyer: "M6" },
  tiktok: { retarget: "T1", checkout: "T3", buyer: "T4" },
  snapchat: { retarget: "S1", checkout: "S3", buyer: "S4" },
};
const row = (
  platform: "meta" | "tiktok" | "snapchat",
  code: string,
): AdAudienceRow => ({
  id: `${platform}-${code}`,
  platform,
  code,
  scope: "event",
  market: "US",
  brand_id: BRAND,
  event_id: EVENT,
  platform_audience_id: `pa-${code}`,
  approx_size: 50_000,
  status: "ready",
});

/** The stage budgets the create path would send, for one audience mix. */
function createStageBudgets(
  platform: "meta" | "tiktok" | "snapchat",
  total: number,
  stages: { retarget: boolean; abandoners: boolean },
): number[] {
  const codes = CODES[platform];
  const rows = [row(platform, codes.buyer)];
  if (stages.retarget) rows.push(row(platform, codes.retarget));
  if (stages.abandoners) rows.push(row(platform, codes.checkout));
  const plan = buildAdStagePlan({
    platform,
    rows,
    market: "US",
    brandId: BRAND,
    eventId: EVENT,
    totalBudgetCents: total,
  });
  assert(plan && !plan.blocked);
  return plan.stages.filter((stage) => stage.enabled && stage.executable)
    .map((stage) => stage.budgetCents);
}

const MIXES = [
  { retarget: false, abandoners: false },
  { retarget: true, abandoners: false },
  { retarget: false, abandoners: true },
  { retarget: true, abandoners: true },
];

Deno.test("SC-9 every total at or above the staged minimum clears every stage, for every audience mix", () => {
  for (
    const [platform, floor] of [
      ["meta", 100],
      ["snapchat", 500],
      ["tiktok", 2000],
    ] as const
  ) {
    const minimum = stagedDailyMinimumCents(floor);
    for (let total = minimum; total <= minimum + 3 * floor; total += 1) {
      for (const mix of MIXES) {
        for (const budget of createStageBudgets(platform, total, mix)) {
          assert(
            budget >= floor,
            `${platform} total ${total} ${
              JSON.stringify(mix)
            }: stage ${budget} < ${floor}`,
          );
        }
      }
    }
  }
});

Deno.test("SC-9 one cent under the staged minimum, some audience mix is refused at create", () => {
  for (const floor of [100, 500, 2000, 4000]) {
    const minimum = stagedDailyMinimumCents(floor);
    const refused = MIXES.some((mix) =>
      createStageBudgets("meta", minimum - 1, mix).some((budget) =>
        budget < floor
      )
    );
    assert(refused, `floor ${floor}: ${minimum - 1} must fail one stage`);
  }
  // The worst case is three stages: the 10% abandoners stage binds.
  assertEquals(stagedDailyMinimumCents(100), 991);
  assertEquals(stagedDailyMinimumCents(500), 4991);
  assertEquals(stagedDailyMinimumCents(2000), 19991);
});

Deno.test("SC-9 the Host minimum: staged on event pages for Meta, TikTok and Snapchat only", () => {
  const staged = { staged: true };
  const single = { staged: false };
  assertEquals(hostDailyMinimumCents("meta", META_USD, "sales", single), 100);
  assertEquals(hostDailyMinimumCents("meta", META_USD, "sales", staged), 991);
  assertEquals(
    hostDailyMinimumCents("tiktok", { currency: "USD" }, "visits", staged),
    19991,
  );
  assertEquals(
    hostDailyMinimumCents("snapchat", { currency: "USD" }, "visits", staged),
    4991,
  );
  assertEquals(
    hostDailyMinimumCents("reddit", { currency: "USD" }, "visits", staged),
    500,
    "Reddit is never staged",
  );
  assertEquals(
    hostDailyMinimumCents("google", { currency: "USD" }, "visits", staged),
    0,
  );
  assertEquals(
    hostDailyMinimumCents(
      "meta",
      { ...META_USD, currency: "EUR" },
      "sales",
      staged,
    ),
    null,
  );
});

Deno.test("SC-9 ad-plan setup shows the staged worst case and preflight stages event pages", async () => {
  const source = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );
  const setup = source.slice(
    source.indexOf("async function hostDailyMinimums("),
  );
  assert(
    setup.slice(0, 900).includes("{ staged: true }"),
    "setup minimums use the staged worst case",
  );
  assert(
    source.includes("{ staged: destinationIsStaged }"),
    "preflight stages by destination",
  );
  assert(source.includes('typeof resolvedDestination.event_id === "string"'));
  // Same rule the create path uses: stages run when the destination has an event.
  const create = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  assert(create.includes("const destEventId = resolvedDestination.event_id;"));
  assert(create.includes("if (destEventId) {"));
});

Deno.test("SC-9 the stage list the Host minimum assumes is the create path's", () => {
  const stages: AdStage[] = ["prospecting", "retarget", "abandoners"];
  const plan = buildAdStagePlan({
    platform: "meta",
    rows: [row("meta", "M6")],
    market: "US",
    brandId: BRAND,
    eventId: EVENT,
    totalBudgetCents: 1000,
  });
  assertEquals(plan?.stages.map((stage) => stage.stage), stages);
  assertEquals(plan?.stages.map((stage) => stage.budgetPercent), [70, 20, 10]);
});
