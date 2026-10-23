import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  campaignStageViews,
  stageMetricView,
} from "../lib/adStageCampaignView.js";

describe("#3697 per-stage campaign rows", () => {
  it("aggregates provider facts without cross-stage or invented spend", () => {
    const view = stageMetricView({
      stage: "retarget",
      audience_sizes: { M3: 2400, M4: 850 },
      ad_stage_metrics_daily: [
        { spend_cents: 1000, results: 2, reach: 100, impressions: 250, currency: "USD" },
        { spend_cents: 500, results: 1, reach: 50, impressions: 100, currency: "USD" },
      ],
    });
    assert.equal(view.spendCents, 1500);
    assert.equal(view.results, 3);
    assert.equal(view.costPerResultCents, 500);
    assert.equal(view.frequency, 350 / 150);
    assert.deepEqual(view.audienceTooSmallCodes, ["M4"]);
  });

  it("orders the three stored stages and excludes legacy unstaged rows", () => {
    assert.deepEqual(
      campaignStageViews({
        ad_sets: [
          { stage: "abandoners", ad_stage_metrics_daily: [] },
          { stage: null, ad_stage_metrics_daily: [] },
          { stage: "prospecting", ad_stage_metrics_daily: [] },
          { stage: "retarget", ad_stage_metrics_daily: [] },
        ],
      }).map((row) => row.stage),
      ["prospecting", "retarget", "abandoners"],
    );
  });

  it("loads stage metrics for both list expansion and campaign detail", () => {
    const service = readFileSync(
      new URL("../services/adEngineService.js", import.meta.url),
      "utf8",
    );
    const row = readFileSync(
      new URL("../components/ad-engine/CampaignRow.jsx", import.meta.url),
      "utf8",
    );
    assert.match(service, /ad_stage_metrics_daily\(\*\)/);
    assert.match(row, /campaignStageViews\(campaign\)/);
    assert.match(row, /Cost \/ sale/);
    assert.match(row, /Budget folds into prospecting/);
  });
});
