import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import type { AdStagePlan } from "../adAudienceStages.ts";
import {
  buildStagedAdSetPlan,
  targetingForStage,
} from "../adStagedCreatePlan.ts";

const plan: AdStagePlan = {
  platform: "meta",
  blocked: false,
  blockedReason: null,
  minimumAudienceSize: 1000,
  stages: [
    {
      stage: "prospecting",
      enabled: true,
      executable: true,
      budgetPercent: 70,
      budgetCents: 8000,
      includeAudienceIds: ["lookalike"],
      excludeAudienceIds: ["event-buyers"],
      audienceCodes: ["M9"],
      audienceSizes: { M9: 12000 },
      widened: [],
      reason: null,
      advantageAudience: true,
      frequencyCap: null,
    },
    {
      stage: "retarget",
      enabled: true,
      executable: false,
      budgetPercent: 20,
      budgetCents: 0,
      includeAudienceIds: [],
      excludeAudienceIds: ["event-buyers", "checkout"],
      audienceCodes: [],
      audienceSizes: {},
      widened: [],
      reason: "Too small",
      advantageAudience: false,
      frequencyCap: { impressions: 3, days: 7 },
    },
    {
      stage: "abandoners",
      enabled: true,
      executable: true,
      budgetPercent: 10,
      budgetCents: 2000,
      includeAudienceIds: ["checkout"],
      excludeAudienceIds: ["event-buyers"],
      audienceCodes: ["M5"],
      audienceSizes: { M5: 1400 },
      widened: [],
      reason: null,
      advantageAudience: false,
      frequencyCap: { impressions: 3, days: 7 },
    },
  ],
};

Deno.test("#3697 executable stages carry the folded budget and buyer exclusion", () => {
  const stages = buildStagedAdSetPlan({
    platform: "meta",
    stagePlan: plan,
    budgetMode: "daily",
    baseAdSet: {
      namePrefix: "Lagos event",
      optimizationGoal: "LANDING_PAGE_VIEWS",
      billingEvent: "IMPRESSIONS",
      targeting: { geo_locations: { countries: ["NG"] } },
    },
  });
  assertEquals(stages.map((stage) => stage.stage), [
    "prospecting",
    "abandoners",
  ]);
  assertEquals(stages.map((stage) => stage.budgetCents), [8000, 2000]);
  assertEquals(stages[0].adSet.budgetCents, 8000);
  assertEquals(stages[0].adSet.targeting.excluded_custom_audiences, [{
    id: "event-buyers",
  }]);
  assertEquals(stages[0].adSet.targeting.targeting_automation, {
    advantage_audience: 1,
  });
  assertEquals(stages[1].audienceCodes, ["M5"]);
});

Deno.test("#3697 provider stage payloads all exclude event buyers", () => {
  const stage = plan.stages[2];
  assertEquals(
    targetingForStage("snapchat", { countries: ["NG"] }, stage),
    {
      countries: ["NG"],
      segment_include_ids: ["checkout"],
      segment_exclude_ids: ["event-buyers"],
    },
  );
  assertEquals(
    targetingForStage("tiktok", { location_ids: ["102"] }, stage),
    {
      location_ids: ["102"],
      audience_ids: ["checkout"],
      excluded_audience_ids: ["event-buyers"],
    },
  );
});

Deno.test("#3697 Snap frequency cap appears only for documented compatible goals", () => {
  const snapPlan: AdStagePlan = { ...plan, platform: "snapchat" };
  const impressions = buildStagedAdSetPlan({
    platform: "snapchat",
    stagePlan: snapPlan,
    budgetMode: "daily",
    baseAdSet: {
      namePrefix: "Snap compatible",
      optimizationGoal: "IMPRESSIONS",
      billingEvent: "IMPRESSION",
      targeting: { countries: ["NG"] },
    },
  });
  assertEquals(impressions[1].adSet.frequencyCap, {
    impressions: 3,
    days: 7,
  });
  const traffic = buildStagedAdSetPlan({
    platform: "snapchat",
    stagePlan: snapPlan,
    budgetMode: "daily",
    baseAdSet: {
      namePrefix: "Snap traffic",
      optimizationGoal: "PIXEL_PAGE_VIEW",
      billingEvent: "IMPRESSION",
      targeting: { countries: ["NG"] },
    },
  });
  assertEquals(traffic[1].adSet.frequencyCap, undefined);
});

Deno.test("#3697 staged create fails closed without buyer exclusion", () => {
  assertThrows(
    () =>
      targetingForStage("meta", {}, {
        ...plan.stages[0],
        excludeAudienceIds: [],
      }),
    Error,
    "stage_buyer_exclusion_required",
  );
  const blocked = { ...plan, blocked: true, blockedReason: "M6 missing" };
  assertThrows(
    () =>
      buildStagedAdSetPlan({
        platform: "meta",
        stagePlan: blocked,
        budgetMode: "daily",
        baseAdSet: {
          namePrefix: "blocked",
          optimizationGoal: "LANDING_PAGE_VIEWS",
          billingEvent: "IMPRESSIONS",
          targeting: {},
        },
      }),
    Error,
    "stage_plan_blocked",
  );
});

Deno.test("#3697 staged create refuses provider-plan mismatch", () => {
  assertThrows(
    () =>
      buildStagedAdSetPlan({
        platform: "snapchat",
        stagePlan: plan,
        budgetMode: "daily",
        baseAdSet: {
          namePrefix: "wrong",
          optimizationGoal: "PIXEL_PAGE_VIEW",
          billingEvent: "IMPRESSION",
          targeting: {},
        },
      }),
    Error,
    "stage_plan_platform_mismatch",
  );
  assert(
    plan.stages[0].excludeAudienceIds.includes("event-buyers"),
  );
});
