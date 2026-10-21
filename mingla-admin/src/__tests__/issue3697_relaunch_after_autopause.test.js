/**
 * Issue #3697 — staff can see why spend sync paused a campaign before launch.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import { campaignAutoPauseLabel } from "../lib/adCampaignRow.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADMIN_ROOT = resolve(__dirname, "..", "..");

function campaign(overrides = {}) {
  return {
    id: "36970000-0000-4000-8000-000000000741",
    name: "Issue 3697 relaunch",
    platform: "snapchat",
    owner_kind: "mingla",
    owner_label: "Mingla",
    objective: "TRAFFIC",
    status: "PAUSED",
    delivery_status: "PAUSED",
    auto_pause_reason: "spend_fetch_failed",
    status_synced_at: "2026-10-21T10:00:00.000Z",
    starts_at: "2026-10-20T09:00:00.000Z",
    ends_at: "2026-10-23T22:59:00.000Z",
    provider_currency: "USD",
    provider_budget_cents: 8000,
    provider_delivery_budget_cents: 2000,
    lifetime_budget_cents: null,
    external_campaign_id: "snap-campaign-3697",
    dest_url: "https://usemingla.com/",
    plan_version: { schedule_time_zone: "Africa/Lagos" },
    connection: { external_account_id: "snap-account", platform: "snapchat" },
    ad_spend_daily: [],
    ...overrides,
  };
}

let vite;
let CampaignRow;

before(async () => {
  vite = await createServer({
    root: ADMIN_ROOT,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ CampaignRow } = await vite.ssrLoadModule(
    "/src/components/ad-engine/CampaignRow.jsx",
  ));
});

after(async () => {
  await vite?.close();
});

describe("#3697 automatic pause reason", () => {
  it("maps the three staff-critical reasons without showing a raw code", () => {
    assert.equal(
      campaignAutoPauseLabel(campaign()),
      "Paused automatically — spend couldn't be read",
    );
    assert.equal(
      campaignAutoPauseLabel(campaign({ auto_pause_reason: "cap_98_percent" })),
      "Paused automatically — cap reached",
    );
    assert.equal(
      campaignAutoPauseLabel(campaign({ auto_pause_reason: "end_date_passed" })),
      "Paused automatically — ended",
    );
  });

  it("does not show a stale automatic reason on an active or manual pause", () => {
    assert.equal(campaignAutoPauseLabel(campaign({ status: "ACTIVE" })), null);
    assert.equal(campaignAutoPauseLabel(campaign({ auto_pause_reason: null })), null);
  });

  it("renders the reason on the campaign row before the Launch action", () => {
    const html = renderToStaticMarkup(createElement(CampaignRow, {
      campaign: campaign({ auto_pause_reason: "cap_98_percent" }),
      canLaunch: true,
      onLaunch() {},
      now: new Date("2026-10-21T12:00:00.000Z"),
    }));
    assert.match(html, /Paused automatically — cap reached/);
    assert.match(html, />Launch</);
    assert.doesNotMatch(html, />cap_98_percent</);
  });
});
