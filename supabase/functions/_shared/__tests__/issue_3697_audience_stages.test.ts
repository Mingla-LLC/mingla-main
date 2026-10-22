import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { type AdAudienceRow, buildAdStagePlan } from "../adAudienceStages.ts";

const row = (
  code: string,
  scope: "event" | "brand" | "market",
  size: number,
  id = `${code}-${scope}`,
): AdAudienceRow => ({
  id: crypto.randomUUID(),
  platform: "meta",
  code,
  scope,
  market: scope === "market" ? "NG" : null,
  brand_id: scope === "brand" ? "brand-1" : null,
  event_id: scope === "event" ? "event-1" : null,
  platform_audience_id: id,
  approx_size: size,
  status: size >= 1000 ? "ready" : "too_small",
});

Deno.test("#3697 stage plan excludes event buyers everywhere and stores 70/20/10", () => {
  const plan = buildAdStagePlan({
    platform: "meta",
    market: "NG",
    brandId: "brand-1",
    eventId: "event-1",
    totalBudgetCents: 10_000,
    rows: [
      row("M3", "event", 2_000),
      row("M4", "brand", 5_000),
      row("M5", "event", 1_100),
      row("M6", "event", 600, "buyers"),
      row("M9", "market", 12_000),
    ],
  });
  assert(plan);
  assertEquals(plan.blocked, false);
  assertEquals(plan.stages.map((stage) => stage.budgetCents), [
    7000,
    2000,
    1000,
  ]);
  for (const stage of plan.stages) {
    assert(stage.excludeAudienceIds.includes("buyers"));
  }
  assertEquals(plan.stages[0].advantageAudience, true);
  assertEquals(plan.stages[1].frequencyCap, { impressions: 3, days: 7 });
});

Deno.test("#3697 too-small event audiences widen brand then market", () => {
  const plan = buildAdStagePlan({
    platform: "meta",
    market: "NG",
    brandId: "brand-1",
    eventId: "event-1",
    totalBudgetCents: 10_001,
    rows: [
      row("M3", "event", 300),
      row("M3", "brand", 900),
      row("M3", "market", 4_000, "m3-market"),
      row("M5", "event", 100),
      row("M6", "event", 20, "buyers"),
    ],
  });
  assert(plan);
  const retarget = plan.stages.find((stage) => stage.stage === "retarget")!;
  const abandoners = plan.stages.find((stage) => stage.stage === "abandoners")!;
  const prospecting = plan.stages.find((stage) =>
    stage.stage === "prospecting"
  )!;
  assertEquals(retarget.includeAudienceIds, ["m3-market"]);
  assertEquals(retarget.widened, [{ code: "M3", from: "event", to: "market" }]);
  assertEquals(abandoners.executable, false);
  assertEquals(abandoners.budgetCents, 0);
  assertEquals(prospecting.budgetCents, 8001);
});

Deno.test("#3697 retargeting shortcut conserves budget without prospecting", () => {
  const plan = buildAdStagePlan({
    platform: "meta",
    market: "NG",
    brandId: "brand-1",
    eventId: "event-1",
    totalBudgetCents: 10_001,
    enabledStages: {
      prospecting: false,
      retarget: true,
      abandoners: true,
    },
    rows: [
      row("M3", "event", 2_000, "visitors"),
      row("M5", "event", 1_500, "checkout"),
      row("M6", "event", 1_200, "buyers"),
    ],
  });
  assert(plan);
  assertEquals(plan.stages.map((stage) => stage.budgetCents), [
    0,
    6_667,
    3_334,
  ]);
  assertEquals(
    plan.stages.reduce((total, stage) => total + stage.budgetCents, 0),
    10_001,
  );
  assertEquals(plan.stages[0].executable, false);
});

Deno.test("#3697 retargeting shortcut gives the full budget to its only viable stage", () => {
  const plan = buildAdStagePlan({
    platform: "meta",
    market: "NG",
    brandId: "brand-1",
    eventId: "event-1",
    totalBudgetCents: 10_000,
    enabledStages: {
      prospecting: false,
      retarget: true,
      abandoners: true,
    },
    rows: [
      row("M3", "event", 2_000, "visitors"),
      row("M5", "event", 900, "checkout"),
      row("M6", "event", 1_200, "buyers"),
    ],
  });
  assert(plan);
  assertEquals(plan.stages.map((stage) => stage.budgetCents), [0, 10_000, 0]);
});

Deno.test("#3697 missing buyer audience blocks every stage fail closed", () => {
  const plan = buildAdStagePlan({
    platform: "meta",
    market: "NG",
    brandId: "brand-1",
    eventId: "event-1",
    totalBudgetCents: 10_000,
    rows: [row("M3", "event", 5_000), row("M5", "event", 2_000)],
  });
  assert(plan?.blocked);
  assert(plan.stages.every((stage) => stage.executable === false));
  assert(
    plan.stages.every((stage) => !stage.excludeAudienceIds.includes("buyers")),
  );
});

Deno.test("#3697 non-paid-social providers keep their existing single-stage path", () => {
  assertEquals(
    buildAdStagePlan({
      platform: "google",
      market: "NG",
      brandId: "brand-1",
      eventId: "event-1",
      totalBudgetCents: 10_000,
      rows: [],
    }),
    null,
  );
});
