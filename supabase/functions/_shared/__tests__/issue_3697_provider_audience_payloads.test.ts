import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { buildSnapchatAdSquadBody } from "../snapchat.ts";
import { buildTikTokAdGroupBody } from "../tiktok.ts";

Deno.test("#3697 Snap ad squad sends compact segment include/exclude targeting", () => {
  const body = buildSnapchatAdSquadBody("campaign-1", {
    name: "Mingla retarget",
    optimizationGoal: "PIXEL_PAGE_VIEW",
    countries: ["NG"],
    budgetCents: 500,
    pixelId: "pixel-1",
    segmentIncludeIds: ["visitor-1", "visitor-2"],
    segmentExcludeIds: ["buyer-1"],
    nowMs: Date.parse("2026-10-22T12:00:00Z"),
  });
  assertEquals((body.targeting as Record<string, unknown>).segments, [
    { segment_id: ["visitor-1", "visitor-2"], operation: "INCLUDE" },
    { segment_id: ["buyer-1"], operation: "EXCLUDE" },
  ]);
  assertEquals(body.status, "PAUSED");
});

Deno.test("#3697 TikTok ad group sends audience include/exclude ids", () => {
  const body = buildTikTokAdGroupBody("advertiser-1", "campaign-1", {
    name: "Mingla retarget",
    optimizationGoal: "TRAFFIC_LANDING_PAGE_VIEW",
    billingEvent: "CPC",
    budgetCents: 2_000,
    locationIds: ["1022634"],
    audienceIds: ["visitor-1", "visitor-2"],
    excludedAudienceIds: ["buyer-1"],
    nowMs: Date.parse("2026-10-22T12:00:00Z"),
  });
  assertEquals(body.audience_ids, ["visitor-1", "visitor-2"]);
  assertEquals(body.excluded_audience_ids, ["buyer-1"]);
  assertEquals(body.operation_status, "DISABLE");
});

Deno.test("#3697 providers reject an audience included and excluded together", () => {
  assertThrows(
    () =>
      buildSnapchatAdSquadBody("campaign-1", {
        name: "Mingla overlap",
        optimizationGoal: "PIXEL_PAGE_VIEW",
        countries: ["NG"],
        budgetCents: 500,
        pixelId: "pixel-1",
        segmentIncludeIds: ["same"],
        segmentExcludeIds: ["same"],
      }),
    Error,
    "included and excluded",
  );
  assertThrows(
    () =>
      buildTikTokAdGroupBody("advertiser-1", "campaign-1", {
        name: "Mingla overlap",
        optimizationGoal: "TRAFFIC_LANDING_PAGE_VIEW",
        billingEvent: "CPC",
        budgetCents: 2_000,
        locationIds: ["1022634"],
        audienceIds: ["same"],
        excludedAudienceIds: ["same"],
      }),
    Error,
    "included and excluded",
  );
});
