import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import type { AdAudienceRow } from "../adAudienceStages.ts";
import { buildPaidSocialStageRuntime } from "../adStageRuntime.ts";

const A = "10000000-0000-4000-8000-000000000001";
const B = "20000000-0000-4000-8000-000000000002";

function audience(
  code: string,
  id: string,
  size: number,
  scope: "event" | "market" = "event",
): AdAudienceRow {
  return {
    id: `${code}-${scope}`,
    platform: "meta",
    code,
    scope,
    market: "NG",
    brand_id: scope === "event" ? "brand-1" : null,
    event_id: scope === "event" ? "event-1" : null,
    platform_audience_id: id,
    approx_size: size,
    status: "ready",
  };
}

const base = {
  platform: "meta" as const,
  canonicalPlan: {
    stage_selection: {
      prospecting: true,
      retarget: true,
      abandoners: true,
    },
    stage_creative_ids: {
      prospecting: [A, B],
      retarget: [A, B],
      abandoners: [A, B],
    },
  },
  market: "NG",
  brandId: "brand-1",
  eventId: "event-1",
  totalBudgetCents: 10_000,
  baseAdSet: {
    namePrefix: "Friday",
    optimizationGoal: "LANDING_PAGE_VIEWS",
    billingEvent: "IMPRESSIONS",
    targeting: { geo_locations: { countries: ["NG"] } },
  },
  budgetMode: "daily" as const,
};

Deno.test("#3697 reviewed plan becomes buyer-safe executable stage rows", () => {
  const runtime = buildPaidSocialStageRuntime({
    ...base,
    audiences: [
      audience("M3", "visitor", 2_000),
      audience("M5", "checkout", 1_200),
      audience("M6", "buyer", 12),
    ],
  });
  assertEquals(runtime.adSets.map((row) => row.stage), [
    "prospecting",
    "retarget",
    "abandoners",
  ]);
  assertEquals(runtime.adSets.map((row) => row.budgetCents), [
    7_000,
    2_000,
    1_000,
  ]);
  for (const stage of runtime.adSets) {
    const excluded = stage.adSet.targeting
      .excluded_custom_audiences as Array<{ id: string }>;
    assert(excluded.some((row) => row.id === "buyer"));
  }
  assertEquals(runtime.snapshotRows.length, 3);
});

Deno.test("#3697 no buyer pool means zero provider stage payloads", () => {
  assertThrows(
    () =>
      buildPaidSocialStageRuntime({
        ...base,
        audiences: [audience("M3", "visitor", 2_000)],
      }),
    Error,
    "stage_plan_blocked",
  );
});
