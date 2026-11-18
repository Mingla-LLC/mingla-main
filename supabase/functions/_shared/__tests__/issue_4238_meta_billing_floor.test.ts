// Issue #4238 Fix 1 — Meta's minimum follows the billing event, the real
// TikTok / Snapchat per-ad-set limits (D-1). W1: the Host minimum is one ad
// set (item 6b), so the X-1 / SC-9 staged worst case is removed.
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
  hostDailyMinimumCents,
  providerDailyMinimumCents,
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

// ── W1 (6b): the staged Host minimum is gone ─────────────────────────────────
// Item 1 shipped a staged worst case (991 / 4991 / 19991) because Host event
// ads were staged at create. Item 6b makes Host and Ari ads one ad set, and
// the binding floor rule removes the staged figure. The full floor lock lives
// in issue_4238_host_floor_lock.test.ts.

Deno.test("W1 the Host minimum is one ad set on every page, for every goal", () => {
  for (const goal of ["visits", "sales"] as const) {
    assertEquals(hostDailyMinimumCents("meta", META_USD, goal), 100);
    assertEquals(
      hostDailyMinimumCents("tiktok", { currency: "USD" }, goal),
      2000,
    );
    assertEquals(
      hostDailyMinimumCents("snapchat", { currency: "USD" }, goal),
      500,
    );
  }
  assertEquals(
    hostDailyMinimumCents("reddit", { currency: "USD" }, "visits"),
    500,
  );
  assertEquals(
    hostDailyMinimumCents("google", { currency: "USD" }, "visits"),
    0,
  );
  assertEquals(
    hostDailyMinimumCents("meta", { ...META_USD, currency: "EUR" }, "sales"),
    null,
  );
});

Deno.test("W1 ad-plan setup and preflight no longer use a staged minimum", async () => {
  const source = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );
  assert(!source.includes("staged: true"), "setup staged worst case removed");
  assert(!source.includes("destinationIsStaged"), "preflight staging removed");
  const rules = await Deno.readTextFile(
    new URL("../adHostPlanRules.ts", import.meta.url),
  );
  assert(!rules.includes("stagedDailyMinimumCents"));
  assert(!rules.includes("HOST_STAGED_PLATFORMS"));
});
