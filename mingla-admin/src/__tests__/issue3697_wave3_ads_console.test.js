/**
 * toward #3697 Wave 3 — Admin Ads console honesty (#3700 / #3706 / #3708 slice).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildLaunchSummary } from "../lib/adBuilder/launchSummary.js";
import {
  budgetPayloadFromState,
  resolvePlanCurrency,
} from "../lib/adBuilder/payload.js";
import {
  canLaunchCampaign,
  canPauseCampaign,
  formatCampaignMoney,
  HARD_CAP_PAUSE_RATIO,
  scheduleWindowLabel,
  spendCapProgress,
} from "../lib/adSpendCap.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ADMIN = path.join(ROOT, "mingla-admin/src");

test("spendCapProgress: 98% pause threshold matches server", () => {
  assert.equal(HARD_CAP_PAUSE_RATIO, 0.98);
  const under = spendCapProgress({ spendCents: 9700, capCents: 10000 });
  assert.equal(under.atPauseThreshold, false);
  assert.equal(under.pctLabel, "97%");
  const at = spendCapProgress({ spendCents: 9800, capCents: 10000 });
  assert.equal(at.atPauseThreshold, true);
  assert.equal(at.pctLabel, "98%");
  const over = spendCapProgress({ spendCents: 15000, capCents: 10000 });
  assert.equal(over.pctLabel, "150%");
  assert.equal(over.ratio, 1.5);
  assert.equal(over.barRatio, 1);
  assert.equal(over.atPauseThreshold, true);
  const missing = spendCapProgress({ spendCents: null, capCents: 10000 });
  assert.equal(missing.pctLabel, "—");
  assert.equal(missing.ratio, null);
});

test("formatCampaignMoney uses campaign currency (not always USD)", () => {
  const gbp = formatCampaignMoney("GBP", 1234);
  assert.match(gbp, /1\.34|£|GBP/);
  assert.equal(formatCampaignMoney("USD", null), "—");
});

test("Pause only for ACTIVE; Launch only for PAUSED (#3708)", () => {
  assert.equal(canPauseCampaign("ACTIVE"), true);
  assert.equal(canPauseCampaign("PAUSED"), false);
  assert.equal(canPauseCampaign("ARCHIVED"), false);
  assert.equal(canPauseCampaign("DELETED"), false);
  assert.equal(canLaunchCampaign("PAUSED"), true);
  assert.equal(canLaunchCampaign("ACTIVE"), false);
  assert.equal(canLaunchCampaign("ARCHIVED"), false);
});

test("scheduleWindowLabel formats start/end", () => {
  const label = scheduleWindowLabel({
    startsAt: "2026-10-01T12:00:00.000Z",
    endsAt: "2026-10-07T12:00:00.000Z",
  });
  assert.ok(label.includes("→"));
  assert.equal(scheduleWindowLabel({}), null);
});

test("Review summary surfaces hard cap + schedule", () => {
  const summary = buildLaunchSummary({
    destinations: [{ title: "Friday", dest_url: "https://host.usemingla.com/e/a/friday" }],
    channelRows: [{ platform: "meta", label: "Meta", eligible: true }],
    allocations: [{ platform: "meta", dailyCents: 5000 }],
    totalDailyCents: 35000,
    budgetMode: "lifetime",
    capCents: 35000,
    startsAt: "2026-10-01T00:00:00.000Z",
    endsAt: "2026-10-07T23:00:00.000Z",
    currency: "USD",
    creative: { kind: "image", name: "c" },
    copyCheck: { copyHardBlocks: 0, policyFindings: 0 },
  });
  assert.match(summary.hardCapLine, /Hard cap/);
  assert.match(summary.hardCapLine, /98%/);
  assert.ok(summary.scheduleLine);
  assert.match(summary.budgetLine, /Lifetime/i);
});

test("StepDestination uses listAdvertisablePages (all page types) — #3700", () => {
  const src = fs.readFileSync(
    path.join(ADMIN, "components/campaign-builder/StepDestination.jsx"),
    "utf8",
  );
  assert.match(src, /listAdvertisablePages/);
  assert.doesNotMatch(src, /listEventDestinations/);
  assert.doesNotMatch(src, /listBrandDestinations/);
  assert.doesNotMatch(src, /listStayDestinations/);
  for (const t of ["event", "rsvp", "trip", "experience", "brand", "venue", "reservation", "site"]) {
    assert.match(src, new RegExp(`id: "${t}"`));
  }
  assert.match(src, /includeUnavailable/);
});

test("Settings feature flags use flag_key / is_enabled — #3706", () => {
  const src = fs.readFileSync(path.join(ADMIN, "pages/SettingsPage.jsx"), "utf8");
  assert.match(src, /from\("feature_flags"\)\.select\("\*"\)\.order\("flag_key"\)/);
  assert.match(src, /insert\(\{\s*\n?\s*flag_key:/);
  assert.match(src, /is_enabled:\s*!flag\.enabled|is_enabled:\s*newFlag\.enabled|is_enabled:\s*editing\.enabled/);
  assert.doesNotMatch(src, /from\("feature_flags"\)[\s\S]{0,80}\.order\("key"\)/);
  assert.doesNotMatch(src, /from\("feature_flags"\)\.insert\(\{\s*key,/);
});

test("enable_ads_console is a known flag; migration seeds it", () => {
  const flags = fs.readFileSync(path.join(ADMIN, "lib/featureFlags.js"), "utf8");
  assert.match(flags, /enable_ads_console/);
  const mig = fs.readFileSync(
    path.join(ROOT, "supabase/migrations/20270816003697_issue_3697_wave3_ads_console_flag.sql"),
    "utf8",
  );
  assert.match(mig, /enable_ads_console/);
  assert.match(mig, /'true'/);
});

test("CampaignsPage spend-vs-cap + currency-honest money", () => {
  const src = fs.readFileSync(path.join(ADMIN, "pages/CampaignsPage.jsx"), "utf8");
  assert.match(src, /spendCapProgress/);
  assert.match(src, /formatCampaignMoney/);
  assert.match(src, /canPauseCampaign/);
  assert.match(src, /Spend vs hard cap/);
  assert.match(src, /Meta-only/);
  assert.match(src, /roiLoading \? null/);
  assert.doesNotMatch(src, /function centsToUsd/);
});

test("plan currency comes from ad_connections and rides the create budget", () => {
  assert.deepEqual(
    resolvePlanCurrency({ meta: { currency: "gbp" } }, ["meta", "tiktok"]),
    { currency: "GBP", mixed: false },
  );
  assert.equal(
    resolvePlanCurrency(
      { meta: { currency: "USD" }, tiktok: { currency: "GBP" } },
      ["meta", "tiktok"],
    ).mixed,
    true,
  );
  const { budget } = budgetPayloadFromState({
    mode: "daily",
    dailyCentsForChannel: 5000,
    currency: "GBP",
  });
  assert.equal(budget.currency, "GBP");
  const builder = fs.readFileSync(path.join(ADMIN, "pages/CampaignBuilderPage.jsx"), "utf8");
  assert.match(builder, /resolvePlanCurrency/);
  assert.match(builder, /currency: planCurrency\.currency/);
  assert.doesNotMatch(builder, /currency: "USD"/);
});
