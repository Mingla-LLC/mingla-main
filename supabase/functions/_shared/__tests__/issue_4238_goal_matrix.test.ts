// Issue #4238 W1 item 3 — Host goals by page type and platform: sign-ups for
// RSVP and all-free pages, no ticket sales on a free event, live readiness,
// and the visits fallback the Host must acknowledge (amendment A U-3).
//
// @invariant I-4238-NO-PURCHASE-GOAL-WITHOUT-PURCHASE
//   owner: supabase/functions/_shared/adHostGoal.ts validateHostOptimization
//          + hostMetaCustomEventType
//   rule: a Host plan never optimises for an event the page cannot fire. An
//         all-free page cannot run sales; sign-ups only on RSVP or all-free
//         pages; Meta's promoted event follows the goal.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  HOST_AD_OPTIMIZATIONS,
  HOST_SALES_GOAL_PLATFORMS,
  HOST_SIGNUPS_GOAL_PLATFORMS,
  hostAdGoalFields,
  hostGoalBodyError,
  hostMetaCustomEventType,
  hostOptimizationFor,
  hostPageIsAllFree,
  validateHostOptimization,
} from "../adHostGoal.ts";
import {
  HOST_SIGNUPS_PLATFORMS,
  signupsReadiness,
} from "../adSalesReadiness.ts";
import {
  hostDailyMinimumCents,
  minimumsFromSetup,
} from "../adHostPlanRules.ts";
import type { AdConnectionRow } from "../adChannelCore.ts";

const PAID_EVENT = { page_type: "event", result_kind: "tickets" };
const RSVP = { page_type: "rsvp", result_kind: "sign_ups" };
const BRAND = { page_type: "brand", result_kind: "clicks" };
const PLATFORMS = ["meta", "snapchat", "tiktok", "google", "reddit"] as const;

Deno.test("SC-3.1 an RSVP page on Meta runs OUTCOME_LEADS / OFFSITE_CONVERSIONS / IMPRESSIONS on COMPLETE_REGISTRATION", () => {
  const result = validateHostOptimization({ meta: "signups" }, ["meta"], RSVP);
  assert(result.ok);
  assertEquals(result.map.meta, "signups");
  assertEquals(hostAdGoalFields("meta", "signups"), {
    objective: "OUTCOME_LEADS",
    optimization_goal: "OFFSITE_CONVERSIONS",
    billing_event: "IMPRESSIONS",
  });
  assertEquals(hostMetaCustomEventType("signups"), "COMPLETE_REGISTRATION");
  assertEquals(hostMetaCustomEventType("sales"), "PURCHASE");
  assertEquals(hostMetaCustomEventType("visits"), null);
  // Snapchat: SALES + PIXEL_SIGNUP (Z-2, official ad-squad docs).
  assertEquals(hostAdGoalFields("snapchat", "signups"), {
    objective: "SALES",
    optimization_goal: "PIXEL_SIGNUP",
  });
});

Deno.test("SC-3.2 an all-free event refuses ticket sales and accepts sign-ups", () => {
  const allFree = hostPageIsAllFree([
    { is_free: true, price_cents: 0 },
    { is_free: true, price_cents: 0 },
  ]);
  assert(allFree);
  const sales = validateHostOptimization(
    { meta: "sales" },
    ["meta"],
    PAID_EVENT,
    {
      allFree,
    },
  );
  assertEquals(sales.ok, false);
  assert(!sales.ok && sales.detail === "optimization_sales_free_event");
  const requested = validateHostOptimization(
    { meta: "visits" },
    ["meta"],
    PAID_EVENT,
    {
      allFree,
      requestedGoal: "sales",
    },
  );
  assert(!requested.ok && requested.detail === "optimization_sales_free_event");
  const signups = validateHostOptimization(
    { meta: "signups" },
    ["meta"],
    PAID_EVENT,
    {
      allFree,
    },
  );
  assert(signups.ok);
});

Deno.test("adversarial: a tier with is_free but a price is NOT free; a paid page refuses sign-ups", () => {
  assertEquals(hostPageIsAllFree([{ is_free: true, price_cents: 500 }]), false);
  assertEquals(hostPageIsAllFree([{ is_free: false, price_cents: 0 }]), false);
  assertEquals(
    hostPageIsAllFree([{ is_free: true, price_cents: 0 }, {
      is_free: false,
      price_cents: 1500,
    }]),
    false,
  );
  assertEquals(hostPageIsAllFree([]), false, "no tiers is not all free");
  assertEquals(hostPageIsAllFree(null), false);
  const paid = validateHostOptimization(
    { meta: "signups" },
    ["meta"],
    PAID_EVENT,
    {
      allFree: false,
    },
  );
  assert(!paid.ok && paid.detail === "optimization_signups_unsupported");
});

Deno.test("adversarial: unknown goal and a body naming its own conversion event are refused", () => {
  const unknown = validateHostOptimization({ meta: "leads" }, ["meta"], RSVP);
  assert(!unknown.ok && unknown.detail === "optimization_invalid");
  const badRequest = validateHostOptimization(
    { meta: "visits" },
    ["meta"],
    RSVP,
    {
      requestedGoal: "purchases",
    },
  );
  assert(!badRequest.ok && badRequest.detail === "optimization_invalid");
  assertEquals(
    hostGoalBodyError({ custom_event_type: "PURCHASE" }),
    "plan_optimization_mismatch",
  );
  assertEquals(
    hostGoalBodyError({ promoted_object: { custom_event_type: "PURCHASE" } }),
    "plan_optimization_mismatch",
  );
  assertEquals(
    hostOptimizationFor(
      { optimization_by_platform: { meta: "signups" } },
      "meta",
    ),
    "signups",
  );
  assertEquals(
    hostOptimizationFor(
      { optimization_by_platform: { meta: "leads" } },
      "meta",
    ),
    null,
  );
});

/** The page × platform × goal matrix (SC-3.5, server side). */
type Page = "paid_event" | "free_event" | "rsvp" | "brand";
const PAGES: Record<
  Page,
  { destination: Record<string, string>; allFree: boolean }
> = {
  paid_event: { destination: PAID_EVENT, allFree: false },
  free_event: { destination: PAID_EVENT, allFree: true },
  rsvp: { destination: RSVP, allFree: false },
  brand: { destination: BRAND, allFree: false },
};

function expectedCell(page: Page, platform: string, goal: string): boolean {
  if (goal === "visits") return true;
  if (goal === "sales") {
    return page === "paid_event" &&
      (HOST_SALES_GOAL_PLATFORMS as readonly string[]).includes(platform);
  }
  return (page === "rsvp" || page === "free_event") &&
    (HOST_SIGNUPS_GOAL_PLATFORMS as readonly string[]).includes(platform);
}

Deno.test("SC-3.5 every (page x platform x goal) cell matches the matrix", () => {
  let cells = 0;
  for (
    const [page, spec] of Object.entries(PAGES) as [Page, typeof PAGES[Page]][]
  ) {
    for (const platform of PLATFORMS) {
      for (const goal of HOST_AD_OPTIMIZATIONS) {
        const result = validateHostOptimization(
          { [platform]: goal },
          [platform],
          spec.destination,
          { allFree: spec.allFree },
        );
        assertEquals(
          result.ok,
          expectedCell(page, platform, goal),
          `${page} ${platform} ${goal}`,
        );
        // Every accepted conversion cell has provider fields to send.
        if (result.ok && goal !== "visits") {
          assert(
            hostAdGoalFields(platform, goal),
            `${platform} ${goal} fields`,
          );
        }
        cells += 1;
      }
    }
  }
  assertEquals(cells, 4 * 5 * 3);
  // Step 0 fallbacks: TikTok (Z-1), Reddit (Z-3) and Google (#4452) have no
  // sign-ups path; Google and Reddit stay off sales (no conversion path built).
  assertEquals(hostAdGoalFields("tiktok", "signups"), null);
  assertEquals(hostAdGoalFields("reddit", "signups"), null);
  assertEquals(hostAdGoalFields("google", "signups"), null);
  assertEquals(hostAdGoalFields("google", "sales"), null);
  assertEquals(hostAdGoalFields("reddit", "sales"), null);
  assertEquals([...HOST_SIGNUPS_PLATFORMS], [...HOST_SIGNUPS_GOAL_PLATFORMS]);
});

Deno.test("U-3 a sales plan where an app falls back to visits needs the Host's acknowledgement", () => {
  const map = { meta: "sales", tiktok: "visits", google: "visits" };
  const refused = validateHostOptimization(
    map,
    ["meta", "tiktok", "google"],
    PAID_EVENT,
    {
      requestedGoal: "sales",
      ready: { meta: { sales: true } },
    },
  );
  assert(!refused.ok);
  assertEquals(refused.status, 409);
  assertEquals(refused.detail, "host_ad_goal_fallback_unacknowledged");
  assertEquals(refused.platforms, ["tiktok", "google"]);
  const accepted = validateHostOptimization(
    map,
    ["meta", "tiktok", "google"],
    PAID_EVENT,
    {
      requestedGoal: "sales",
      ready: { meta: { sales: true } },
      acknowledgedFallback: ["tiktok", "google", "snapchat"],
    },
  );
  assert(
    accepted.ok,
    "an acknowledgement naming an app that didn't fall back is ignored",
  );
  const partial = validateHostOptimization(
    map,
    ["meta", "tiktok", "google"],
    PAID_EVENT,
    {
      requestedGoal: "sales",
      ready: { meta: { sales: true } },
      acknowledgedFallback: ["tiktok"],
    },
  );
  assert(!partial.ok && partial.platforms?.join() === "google");
  // A visits plan needs no acknowledgement.
  assert(
    validateHostOptimization({ meta: "visits" }, ["meta"], PAID_EVENT, {
      requestedGoal: "visits",
    }).ok,
  );
});

Deno.test("U-3 a forged sales or sign-ups goal for a not-ready app is refused by the server", () => {
  const sales = validateHostOptimization(
    { snapchat: "sales" },
    ["snapchat"],
    PAID_EVENT,
    {
      ready: { snapchat: { sales: false } },
    },
  );
  assert(!sales.ok && sales.detail === "optimization_sales_not_ready:snapchat");
  const signups = validateHostOptimization(
    { meta: "signups" },
    ["meta"],
    RSVP,
    {
      ready: {},
    },
  );
  assert(
    !signups.ok && signups.detail === "optimization_signups_not_ready:meta",
  );
});

Deno.test("sign-ups readiness: Meta needs a live dataset, Snapchat a pixel, others unsupported", async () => {
  const probes = {
    metaHasSignal: () => Promise.resolve(true),
    snapchatPurchases28d: () => Promise.resolve(0),
    tiktokPurchases28d: () => Promise.resolve(0),
  };
  const conn = (platform: string, extra: Record<string, unknown>) =>
    ({ id: `c-${platform}`, platform, extra }) as unknown as AdConnectionRow;
  assertEquals(
    (await signupsReadiness(conn("meta", { dataset_id: "ds" }), probes)).ready,
    true,
  );
  assertEquals(
    (await signupsReadiness(conn("meta", {}), probes)).reason,
    "no_pixel",
  );
  assertEquals(
    (await signupsReadiness(conn("snapchat", { pixel_id: "px" }), probes))
      .ready,
    true,
  );
  assertEquals(
    (await signupsReadiness(conn("tiktok", { pixel_id: "px" }), probes)).reason,
    "not_supported",
  );
  const failing = {
    ...probes,
    metaHasSignal: () => Promise.reject(new Error("x")),
  };
  assertEquals(
    (await signupsReadiness(conn("meta", { dataset_id: "ds" }), failing)).ready,
    false,
    "fails closed",
  );
});

Deno.test("sign-ups minimum is the one-ad-set Meta impression floor; split reads the goal's row", () => {
  const meta = {
    currency: "USD",
    extra: { minimum_budgets: { imp: 100, high_freq: 500, low_freq: 4000 } },
  };
  assertEquals(hostDailyMinimumCents("meta", meta, "signups"), 100);
  assertEquals(
    minimumsFromSetup([
      {
        platform: "meta",
        visits_daily_minimum_cents: 100,
        sales_daily_minimum_cents: 101,
        signups_daily_minimum_cents: 102,
      },
    ], { meta: "signups" }),
    { meta: 102 },
  );
});

Deno.test("wiring: create sends the goal's Meta event; ad-plan passes tiers, readiness and the acknowledgement", async () => {
  const create = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  assert(
    create.includes('custom_event_type: hostMetaCustomEvent ?? "PURCHASE",'),
  );
  assert(create.includes("hostMetaCustomEventType(hostOptimization)"));
  const plan = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );
  assert(plan.includes("allFree: hostPageIsAllFree(offeringTiers.rows),"));
  assert(plan.includes("requestedGoal: canonicalInput.optimization_goal,"));
  assert(
    plan.includes(
      "acknowledgedFallback: canonicalInput.acknowledged_visits_fallback,",
    ),
  );
  assert(plan.includes("}, optimization.status ?? 422);"));
});
