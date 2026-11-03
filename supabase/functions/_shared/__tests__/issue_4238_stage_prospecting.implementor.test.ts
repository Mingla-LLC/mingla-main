// Issue #4238 wave 2 — T11: the staged plan's prospecting slot is the plan's
// selected lists / lookalikes; the dead M9 / S6 / T6 codes are gone.

import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type AdAudienceRow, buildAdStagePlan } from "../adAudienceStages.ts";
import { buildAudienceDefinition } from "../adAudienceDefinitions.ts";
import { targetingForStage } from "../adStagedCreatePlan.ts";

const row = (code: string, size = 5000): AdAudienceRow => ({
  id: code,
  platform: code.startsWith("M") ? "meta" : code.startsWith("S") ? "snapchat" : "tiktok",
  code,
  scope: "market",
  market: "NG",
  brand_id: null,
  event_id: null,
  platform_audience_id: `px-${code}`,
  approx_size: size,
  status: "ready",
});

const input = {
  platform: "meta" as const,
  rows: [row("M3"), row("M5"), row("M6")],
  market: "NG",
  brandId: "b",
  eventId: "e",
  totalBudgetCents: 10_000,
};

Deno.test("T11 prospecting targets the selected lookalike with Advantage+ off", () => {
  const plan = buildAdStagePlan({ ...input, prospectingAudienceIds: ["lal-1"] })!;
  const prospecting = plan.stages.find((stage) => stage.stage === "prospecting")!;
  assertEquals(prospecting.includeAudienceIds, ["lal-1"]);
  assertEquals(prospecting.advantageAudience, false);
  const targeting = targetingForStage("meta", { countries: ["NG"] }, prospecting);
  assertEquals(targeting.custom_audiences, [{ id: "lal-1" }]);
  assertEquals(targeting.targeting_automation, { advantage_audience: 0 });
  // The buyer exclusion still applies.
  assertEquals(targeting.excluded_custom_audiences, [{ id: "px-M6" }]);
});

Deno.test("T11 with no selection prospecting stays broad (Advantage+ on)", () => {
  const plan = buildAdStagePlan(input)!;
  const prospecting = plan.stages.find((stage) => stage.stage === "prospecting")!;
  assertEquals(prospecting.includeAudienceIds, []);
  assertEquals(prospecting.advantageAudience, true);
});

Deno.test("T11 no M9, S6 or T6 code is left", async () => {
  for (const [platform, code] of [["meta", "M9"], ["snapchat", "S6"], ["tiktok", "T6"]] as const) {
    assertThrows(() =>
      buildAudienceDefinition({
        platform,
        code,
        scope: "market",
        market: "NG",
        brandId: null,
        brandSlug: null,
        eventId: null,
        eventSlug: null,
        pixelId: "p",
      })
    );
  }
  for (const file of ["../adAudienceStages.ts", "../adAudienceDefinitions.ts"]) {
    const source = await Deno.readTextFile(new URL(file, import.meta.url));
    assert(!/"M9"|"S6"|"T6"|\bM9:|\bS6:|\bT6:/.test(source), `${file} still names a prospecting code`);
  }
});
