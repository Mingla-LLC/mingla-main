// ISSUE-865 PR1 WP-4 — admin "Conversions & ROI" panel (NEW, append-only).
//
// node:test — the house admin idiom: pure-logic unit tests + fs source
// assertions, no DOM. Proves:
//   • the ROI math NEVER fabricates ROAS/cost-per-result — both are null unless a
//     REAL spend figure is present (no in-DB spend source yet → honest "—");
//   • toCampaignRoiView is honest-empty safe (null/unauthorized → zeros, no data);
//   • adEngineService wires the ad_campaign_conversion_rollup RPC;
//   • CampaignsPage renders the panel below Ad sets & ads, gated on the selected
//     campaign, and shows "—" for spend/ROAS when spend is unknown.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  computeCostPerResult,
  computeRoas,
  toCampaignRoiView,
  totalValueCents,
} from "../lib/adRoi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), "utf8");

describe("adRoi — no fabricated ROAS", () => {
  it("totalValueCents sums a per-currency map (garbage-safe)", () => {
    assert.equal(totalValueCents({ GBP: 1000, USD: 500 }), 1500);
    assert.equal(totalValueCents({}), 0);
    assert.equal(totalValueCents(null), 0);
    assert.equal(totalValueCents({ GBP: "x" }), 0);
  });

  it("computeRoas returns null unless spend is a real positive number", () => {
    assert.equal(computeRoas(2000, 1000), 2);
    assert.equal(computeRoas(3000, 2000), 1.5);
    assert.equal(computeRoas(2000, null), null); // no spend source → NEVER a number
    assert.equal(computeRoas(2000, 0), null);
    assert.equal(computeRoas(2000, undefined), null);
  });

  it("computeCostPerResult null without spend or conversions", () => {
    assert.equal(computeCostPerResult(1000, 4), 250);
    assert.equal(computeCostPerResult(1000, 0), null);
    assert.equal(computeCostPerResult(null, 4), null);
  });

  it("toCampaignRoiView: populated payload → data, but ROAS null while spend is null", () => {
    const v = toCampaignRoiView({
      authorized: true,
      conversions: 3,
      value_cents: { GBP: 9000 },
      spend_cents: null,
      by_platform: [{ platform: "meta", conversions: 3, value_cents: 9000, sent: 3, failed: 0 }],
      send_health: { sent: 3, failed: 0, skipped: 1, pending: 0 },
    });
    assert.equal(v.hasData, true);
    assert.equal(v.conversions, 3);
    assert.equal(v.valueCents, 9000);
    assert.equal(v.spendCents, null);
    assert.equal(v.roas, null); // honest: no spend → no ROAS
    assert.equal(v.byPlatform.length, 1);
  });

  it("toCampaignRoiView: WITH a real spend → ROAS + cost-per-result computed", () => {
    const v = toCampaignRoiView({ conversions: 4, value_cents: { GBP: 8000 }, spend_cents: 4000, by_platform: [] });
    assert.equal(v.roas, 2); // 8000 / 4000
    assert.equal(v.costPerResultCents, 1000); // 4000 / 4
  });

  it("toCampaignRoiView: null / unauthorized → honest empty (no data, no numbers)", () => {
    for (const raw of [null, undefined, { authorized: false, conversions: 0 }]) {
      const v = toCampaignRoiView(raw);
      assert.equal(v.hasData, false);
      assert.equal(v.conversions, 0);
      assert.equal(v.roas, null);
      assert.deepEqual(v.byPlatform, []);
    }
  });
});

describe("wiring — adEngineService + CampaignsPage", () => {
  it("adEngineService calls the ad_campaign_conversion_rollup RPC", () => {
    const svc = read("../services/adEngineService.js");
    assert.ok(svc.includes("export async function getCampaignConversions"));
    assert.ok(svc.includes('supabase.rpc("ad_campaign_conversion_rollup"'));
    assert.ok(svc.includes("p_campaign_id: campaignId"));
  });

  it("CampaignsPage renders the panel below the detail card, gated on the selected campaign", () => {
    const page = read("../pages/CampaignsPage.jsx");
    assert.ok(page.includes("Conversions & ROI"));
    assert.ok(page.includes("getCampaignConversions"));
    assert.ok(page.includes("toCampaignRoiView"));
    // Placed AFTER the campaign-detail SectionCard.
    const detailIdx = page.indexOf('title="Campaign detail"');
    const roiIdx = page.indexOf('title="Conversions & ROI"');
    assert.ok(detailIdx > -1 && roiIdx > detailIdx, "ROI panel must render below Campaign detail");
    // Honest "—" for ROAS / spend when there is no real spend figure.
    assert.ok(page.includes("roi.roas === null ? \"—\""));
    assert.ok(page.includes("roi.spendCents === null ? \"—\""));
  });
});
