import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

import {
  creativeFatigue,
  validateStageCreativeSelection,
} from "../lib/adBuilder/stageCreativeRules.js";

const brandId = "11111111-1111-4111-8111-111111111111";
const row = (id, overrides = {}) => ({
  id,
  brand_id: brandId,
  name: `Creative ${id}`,
  placement_formats: [
    "Reels & stories · 9:16",
    "Portrait feed · 4:5",
    "Square feed · 1:1",
  ],
  has_audio: true,
  usage: { active_campaign_count: 0 },
  ...overrides,
});

describe("#3697 stage creative guard", () => {
  it("requires two to four brand-owned, covered, audible creatives per enabled stage", () => {
    const rows = [row("a"), row("b"), row("c")];
    const valid = validateStageCreativeSelection({
      rows,
      brandId,
      platforms: ["meta", "snapchat", "tiktok"],
      enabledStages: { prospecting: true, retarget: true, abandoners: true },
      stageCreativeIds: {
        prospecting: ["a", "b"],
        retarget: ["a", "c"],
        abandoners: ["b", "c"],
      },
    });
    assert.equal(valid.ok, true);

    const short = validateStageCreativeSelection({
      rows,
      brandId,
      platforms: ["meta"],
      enabledStages: { prospecting: true, retarget: false, abandoners: false },
      stageCreativeIds: { prospecting: ["a"] },
    });
    assert.equal(short.ok, false);
    assert.match(short.reason, /at least 2/);
  });

  it("fails closed on cross-brand, missing sizes and missing Snap/TikTok audio", () => {
    const invalid = validateStageCreativeSelection({
      rows: [
        row("a"),
        row("b", {
          brand_id: "22222222-2222-4222-8222-222222222222",
          placement_formats: ["Square feed · 1:1"],
          has_audio: false,
        }),
      ],
      brandId,
      platforms: ["meta", "snapchat"],
      enabledStages: { prospecting: true, retarget: false, abandoners: false },
      stageCreativeIds: { prospecting: ["a", "b"] },
    });
    assert.equal(invalid.ok, false);
    assert.match(invalid.stages.prospecting.errors.join(" "), /another brand/);
  });

  it("uses factual active-campaign counts for the fatigue chip", () => {
    assert.equal(creativeFatigue(row("a")).label, "Fresh");
    assert.equal(
      creativeFatigue(row("a", { usage: { active_campaign_count: 1 } })).label,
      "In rotation",
    );
    assert.equal(
      creativeFatigue(row("a", { usage: { active_campaign_count: 3 } })).label,
      "Heavy rotation",
    );
  });

  it("loads the selected destination's server-resolved brand library and freezes ids into the plan", () => {
    const step = readFileSync(
      new URL("../components/campaign-builder/StepCreative.jsx", import.meta.url),
      "utf8",
    );
    const page = readFileSync(
      new URL("../pages/CampaignBuilderPage.jsx", import.meta.url),
      "utf8",
    );
    assert.match(step, /resolveAdvertisablePage\(destination\)/);
    assert.match(step, /brand_id: brandId/);
    assert.match(step, /Creative rotation by stage/);
    assert.match(page, /stage_creative_ids: creative\.stageCreativeIds/);
    assert.match(page, /!stageCreativeValidation\.ok/);
  });
});
