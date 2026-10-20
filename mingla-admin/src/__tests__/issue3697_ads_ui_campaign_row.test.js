// MINGLA-INVARIANT: I-3697-CAMPAIGN-ROW-ONE-STATUS | issue #3697 | a campaign row shows exactly one plain-English status chip, never the raw advertiser and delivery badges side by side
// MINGLA-INVARIANT: I-3697-CAMPAIGN-ROW-OWN-ZONE | issue #3697 | a campaign row shows start and end in the plan's schedule zone with the zone named, never the viewer's browser zone
/**
 * Issue #3697 — Admin Ads campaign row cleanup.
 *
 * Live evidence (2026-10-20): the Femzy row showed "ACTIVE ACTIVE" (advertiser
 * + delivery badges) and "Oct 20, 5:00 AM → Oct 23, 6:59 PM" in the viewer's
 * browser zone for a Lagos campaign, with no spend, cap or daily budget, and
 * End plan one click away beside Pause.
 *
 * Run: node --test src/__tests__/issue3697_ads_ui_campaign_row.test.js
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import {
  campaignMoneyFacts,
  campaignScheduleInZone,
  campaignStatusChip,
  providerManagerUrl,
  relativeTimeLabel,
  zoneCityLabel,
} from "../lib/adCampaignRow.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADMIN_ROOT = resolve(__dirname, "..", "..");
const SRC = (relativePath) =>
  readFileSync(resolve(__dirname, "..", relativePath), "utf8");

const NOW = new Date("2026-10-20T12:00:00.000Z");

function femzyRow(overrides = {}) {
  return {
    id: "c0000000-0000-4000-8000-000000000001",
    name: "Deserted Island 6.0 — Halloween Camping Weekend",
    platform: "meta",
    owner_kind: "mingla",
    owner_label: "Mingla",
    objective: "OUTCOME_TRAFFIC",
    status: "ACTIVE",
    delivery_status: "ACTIVE",
    currency_status: "aligned",
    status_synced_at: "2026-10-20T11:48:00.000Z",
    starts_at: "2026-10-20T09:00:00.000Z",
    ends_at: "2026-10-23T22:59:00.000Z",
    provider_currency: "USD",
    provider_budget_cents: 12000,
    provider_delivery_budget_cents: 3000,
    lifetime_budget_cents: null,
    external_campaign_id: "52609719519999",
    dest_url: "https://host.usemingla.com/e/deserted-island",
    plan_version: { schedule_time_zone: "Africa/Lagos" },
    connection: { external_account_id: "act_1234567890", platform: "meta" },
    ad_spend_daily: [
      { spend_cents: 1000, currency: "USD", synced_at: "2026-10-20T11:50:00.000Z" },
      { spend_cents: 500, currency: "USD", synced_at: "2026-10-20T11:40:00.000Z" },
    ],
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

async function rowHtml(props) {
  return renderToStaticMarkup(createElement(CampaignRow, props));
}

function collectElements(node, elements = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, elements);
    return elements;
  }
  if (!node || typeof node !== "object" || !node.props) return elements;
  elements.push(node);
  collectElements(node.props.children, elements);
  return elements;
}

function textContent(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  return textContent(node.props?.children);
}

describe("#3697 one status chip in plain words", () => {
  it("maps every lifecycle to exactly one label", () => {
    assert.equal(campaignStatusChip(femzyRow(), NOW).label, "Live · delivering");
    assert.equal(
      campaignStatusChip(femzyRow({ status: "PAUSED", delivery_status: "PAUSED" }), NOW).label,
      "Paused",
    );
    assert.equal(
      campaignStatusChip(
        femzyRow({ status: "PAUSED", starts_at: "2026-10-25T09:00:00.000Z" }),
        NOW,
      ).label,
      "Scheduled",
    );
    assert.equal(
      campaignStatusChip(femzyRow({ status: "ARCHIVED", delivery_status: "ARCHIVED" }), NOW).label,
      "Ended",
    );
    assert.equal(
      campaignStatusChip(femzyRow({ delivery_status: "DISAPPROVED" }), NOW).label,
      "Needs attention",
    );
  });

  it("never claims delivery while the provider is still reviewing", () => {
    const chip = campaignStatusChip(femzyRow({ delivery_status: "IN_PROCESS" }), NOW);
    assert.notEqual(chip.label, "Live · delivering");
    assert.notEqual(chip.variant, "success");
  });

  it("renders one chip and never the raw ACTIVE ACTIVE pair", async () => {
    const html = await rowHtml({ campaign: femzyRow(), now: NOW, canPause: true });
    assert.match(html, /Live · delivering/);
    assert.equal((html.match(/>ACTIVE</g) ?? []).length, 0, html);
  });
});

describe("#3697 dates in the campaign's own zone", () => {
  it("shows Lagos wall-clock times labelled Lagos time", () => {
    const zoned = campaignScheduleInZone({
      startsAt: "2026-10-20T09:00:00.000Z",
      endsAt: "2026-10-23T22:59:00.000Z",
      timeZone: "Africa/Lagos",
      now: NOW,
    });
    assert.equal(zoned.range, "Oct 20, 10:00 → Oct 23, 23:59");
    assert.equal(zoned.zoneLabel, "Lagos time");
    assert.equal(zoned.daysLeftLabel, "4 days left");
  });

  it("falls back to labelled UTC, never the browser zone", () => {
    const zoned = campaignScheduleInZone({
      startsAt: "2026-10-20T09:00:00.000Z",
      endsAt: null,
      timeZone: null,
      now: NOW,
    });
    assert.equal(zoned.range, "Starts Oct 20, 09:00");
    assert.equal(zoned.zoneLabel, "UTC");
    assert.equal(zoneCityLabel("America/New_York"), "New York time");
    assert.equal(zoneCityLabel("Not/AZone"), null);
  });

  it("the row reads the plan's schedule zone, not toLocaleString", async () => {
    const html = await rowHtml({ campaign: femzyRow(), now: NOW });
    assert.match(html, /Oct 20, 10:00 → Oct 23, 23:59/);
    assert.match(html, /Lagos time/);
    const row = SRC("components/ad-engine/CampaignRow.jsx");
    assert.doesNotMatch(row, /toLocaleString/);
    assert.match(row, /plan_version\?\.schedule_time_zone/);
  });
});

describe("#3697 spend vs cap from the spend-sync rows", () => {
  it("computes spend, cap, the 98% pause point and the busy-day ceiling", () => {
    const money = campaignMoneyFacts(femzyRow());
    assert.equal(money.spendCents, 1500);
    assert.equal(money.capCents, 12000);
    assert.equal(money.pauseAtCents, 11760);
    assert.equal(money.dailyCents, 3000);
    assert.equal(money.busyDayCents, 5250);
    assert.equal(money.lastSyncedAt, "2026-10-20T11:50:00.000Z");
  });

  it("shows — instead of inventing spend when no sync row exists", () => {
    const money = campaignMoneyFacts(femzyRow({ ad_spend_daily: [] }));
    assert.equal(money.spendCents, null);
    assert.equal(money.spendLabel, "—");
    assert.equal(money.barRatio, null);
  });

  it("refuses to sum a row in another currency", () => {
    const money = campaignMoneyFacts(
      femzyRow({
        ad_spend_daily: [
          { spend_cents: 1000, currency: "USD", synced_at: null },
          { spend_cents: 90000, currency: "NGN", synced_at: null },
        ],
      }),
    );
    assert.equal(money.spendCents, null);
  });

  it("renders the bar, daily budget, auto-pause and last sync", async () => {
    const html = await rowHtml({ campaign: femzyRow(), now: NOW });
    assert.match(html, /\$15\.00 of \$120\.00/);
    assert.match(html, /Auto-pauses at \$117\.60 \(98%\)/);
    assert.match(html, /\$30\.00 \/ day/);
    assert.match(html, /Meta may spend up to \$52\.50 on a busy day/);
    assert.match(html, /10 min ago/);
    assert.match(html, /role="progressbar"/);
    assert.equal(relativeTimeLabel(null, NOW), null);
  });
});

describe("#3697 row actions", () => {
  it("links Open in Meta with the connection account and campaign ids", () => {
    assert.equal(
      providerManagerUrl(femzyRow()),
      "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=1234567890&selected_campaign_ids=52609719519999",
    );
    assert.equal(providerManagerUrl(femzyRow({ platform: "google" })), null);
    assert.equal(providerManagerUrl(femzyRow({ connection: null })), null);
    assert.equal(providerManagerUrl(femzyRow({ external_campaign_id: "" })), null);
  });

  it("puts End plan and Sync in a labelled overflow menu, not beside Pause", () => {
    const tree = CampaignRow({
      campaign: femzyRow(),
      now: NOW,
      canPause: true,
      canEnd: true,
      onPause() {},
      onEnd() {},
      onSync() {},
    });
    const elements = collectElements(tree);
    const menu = elements.find((element) => typeof element.props.ariaLabel === "string");
    assert.ok(menu, "the overflow menu must exist");
    assert.match(menu.props.ariaLabel, /More actions for Deserted Island 6\.0/);
    const items = textContent(menu.props.children(() => {}));
    assert.match(items, /End plan/);
    assert.match(items, /Sync/);
    const visible = elements
      .filter((element) => element !== menu && typeof element.props.onClick === "function")
      .map((element) => textContent(element.props.children));
    assert.ok(visible.includes("Pause"));
    assert.ok(!visible.some((label) => /End plan/.test(label)), visible.join(" | "));
  });

  it("uses 44px targets and Open in Meta on the row", async () => {
    const html = await rowHtml({ campaign: femzyRow(), now: NOW, canPause: true });
    assert.match(html, /Open in Meta/);
    assert.match(html, /adsmanager\.facebook\.com/);
    assert.match(html, /min-h-11/);
    assert.match(html, /h-11 w-11/);
  });

  it("keeps the LAUNCH and END PLAN typed gates on the page", () => {
    const page = SRC("pages/CampaignsPage.jsx");
    assert.match(page, /<CampaignRow/);
    assert.match(page, /onLaunch=\{\(\) => setLaunchTarget\(campaign\)\}/);
    assert.match(page, /onEnd=\{\(\) => setEndTarget\(campaign\)\}/);
    assert.match(page, /confirmPhrase=\{LAUNCH_CONFIRM_PHRASE\}/);
    assert.match(page, /confirmPhrase="END PLAN"/);
    assert.doesNotMatch(page, /\{campaign\.status\}\s*<\/Badge>/);
  });

  it("loads the plan zone, connection account and spend rows with the list", () => {
    const service = SRC("services/adEngineService.js");
    assert.match(service, /schedule_time_zone:canonical_plan->schedule->>time_zone/);
    assert.match(service, /connection:ad_connections\(external_account_id,platform\)/);
    assert.match(service, /ad_spend_daily\(spend_cents,currency,synced_at\)/);
    assert.match(service, /\.select\(CAMPAIGN_LIST_SELECT\)/);
  });
});
