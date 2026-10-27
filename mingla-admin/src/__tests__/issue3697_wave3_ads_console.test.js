// MINGLA-INVARIANT: I-3697-SOON-IS-GUIDANCE | issue #3697 | A public destination starting within 48 hours remains selectable in Admin Ads with a planning warning; hard-ineligible destinations stay disabled.
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
  destinationAvailabilityGuidance,
  isDestinationSelectable,
} from "../lib/adBuilder/destinationAvailability.js";
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
  assert.equal(formatCampaignMoney(null, 1234), "—");
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
  for (const t of [
    "event",
    "rsvp",
    "trip",
    "experience",
    "brand",
    "venue",
    "reservation",
    "site",
    "marketing",
  ]) {
    assert.match(src, new RegExp(`id: "${t}"`));
  }
  assert.match(src, /includeUnavailable/);
});

test("under-48-hour destinations warn without blocking Admin ad creation", () => {
  assert.equal(isDestinationSelectable({ availability: "available" }), true);
  assert.equal(isDestinationSelectable({ availability: "soon" }), true);
  assert.equal(isDestinationSelectable({}), true);

  for (const availability of [
    "draft",
    "private",
    "ended",
    "cancelled",
    "not_live",
    "unavailable",
  ]) {
    assert.equal(
      isDestinationSelectable({ availability }),
      false,
      `${availability} must remain blocked`,
    );
  }

  assert.match(
    destinationAvailabilityGuidance({ availability: "soon" }),
    /within 48 hours/i,
  );
  assert.equal(
    destinationAvailabilityGuidance({ availability: "available" }),
    null,
  );

  const src = fs.readFileSync(
    path.join(ADMIN, "components/campaign-builder/StepDestination.jsx"),
    "utf8",
  );
  assert.match(src, /disabled=\{!selectable\}/);
  assert.match(src, /\{guidance\}/);
  assert.doesNotMatch(src, /function isAvailable/);
});

// #4130 (Wave 4b): flags moved to their own page and change only through the
// server (admin_set_feature_flag, reason required), which reads flag_key /
// is_enabled itself; the page never touches the table.
test("Feature flags use flag_key / is_enabled — #3706", () => {
  const page = fs.readFileSync(path.join(ADMIN, "pages/FeatureFlagsPage.jsx"), "utf8");
  const service = fs.readFileSync(path.join(ADMIN, "services/systemPagesService.js"), "utf8");
  assert.match(page, /changing\.flag_key/);
  assert.match(page, /r\.is_enabled|v \? "On" : "Off"/);
  assert.doesNotMatch(page, /from\("feature_flags"\)/);
  assert.match(service, /p_flag_key: flagKey, p_enabled: enabled, p_reason: reason/);
  assert.doesNotMatch(fs.readFileSync(path.join(ADMIN, "pages/SettingsPage.jsx"), "utf8"), /feature_flags/);
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
  assert.match(src, /every enabled platform/);
  assert.match(src, /roiLoading \? null/);
  assert.doesNotMatch(src, /function centsToUsd/);
});

test("plan currency comes from ad_connections and rides the create budget", () => {
  assert.deepEqual(
    resolvePlanCurrency({ meta: { currency: "gbp" } }, ["meta", "tiktok"]),
    { currency: null, mixed: false, unresolved: true },
  );
  assert.deepEqual(
    resolvePlanCurrency(
      { meta: { currency: "gbp" }, tiktok: { currency: "GBP" } },
      ["meta", "tiktok"],
    ),
    { currency: "GBP", mixed: false, unresolved: false },
  );
  assert.deepEqual(
    resolvePlanCurrency({}, ["meta"]),
    { currency: null, mixed: false, unresolved: true },
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
  assert.match(builder, /currencyBlockedReason/);
  assert.doesNotMatch(builder, /currency: "USD"/);

  const unresolved = buildLaunchSummary({
    channelRows: [{ platform: "meta", label: "Meta", eligible: true }],
    allocations: [{ platform: "meta", dailyCents: 1000 }],
    totalDailyCents: 1000,
    currency: null,
  });
  assert.equal(unresolved.channels[0].dailyLabel, "Currency unavailable/day");
  assert.match(unresolved.budgetLine, /Currency unavailable/);
});
// #3697 v1.4: prior USD-fallback assertions were replaced because unresolved
// provider currency must now fail closed under the binding currency contract.
