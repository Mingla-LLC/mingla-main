// MINGLA-INVARIANT: I-3697-CHANGE-BUDGET-SUMMARY-FROM-REAL-VALUES | issue #3697 | the Change budget summary is computed from the plan's real cap, daily budget and spend, refuses a cap below spend, and Save needs a reason
/**
 * Issue #3697 — Change budget on a live Mingla campaign.
 *
 * Before: no budget control existed in Admin; the only path was Meta Ads
 * Manager, which leaves Mingla's cap, auto-pause and funding hold stale.
 *
 * Run: node --test src/__tests__/issue3697_ads_ui_change_budget.test.js
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
  budgetChangeSummary,
  majorToMinor,
  planBudgetNow,
} from "../lib/adBudgetChangeSummary.js";
import { effectiveProviderMoney } from "../lib/adCampaignRow.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADMIN_ROOT = resolve(__dirname, "..", "..");
const SRC = (relativePath) =>
  readFileSync(resolve(__dirname, "..", relativePath), "utf8");

const NOW = new Date("2026-10-20T12:00:00.000Z");

const femzy = (overrides = {}) => ({
  id: "c1",
  name: "Deserted Island 6.0",
  platform: "meta",
  owner_kind: "mingla",
  status: "ACTIVE",
  plan_version_id: "534424c7-0000-4000-8000-000000000002",
  plan_hash: "1".repeat(64),
  provider_currency: "USD",
  provider_budget_cents: 12000,
  provider_delivery_budget_cents: 3000,
  lifetime_budget_cents: null,
  starts_at: "2026-10-20T09:00:00.000Z",
  ends_at: "2026-10-23T22:59:00.000Z",
  plan_version: { schedule_time_zone: "Africa/Lagos" },
  ad_spend_daily: [{ spend_cents: 5000, currency: "USD", synced_at: null }],
  ...overrides,
});

let vite;
let ChangeBudgetModal;

before(async () => {
  vite = await createServer({
    root: ADMIN_ROOT,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ ChangeBudgetModal } = await vite.ssrLoadModule(
    "/src/components/ad-engine/ChangeBudgetModal.jsx",
  ));
});

after(async () => {
  await vite?.close();
});

describe("#3697 what happens when you save", () => {
  it("$30 → $45 a day and $120 → $160 cap, from the real values", () => {
    const summary = budgetChangeSummary({
      planCampaigns: [femzy()],
      dailyText: "45",
      capText: "160",
      reason: "Clicks are cheap on day 1",
      endsAt: femzy().ends_at,
      now: NOW,
    });
    assert.deepEqual(summary.errors, []);
    assert.equal(summary.newDailyCents, 4500);
    assert.equal(summary.newCapCents, 16000);
    assert.deepEqual(summary.lines, [
      "Meta's daily budget changes from $30.00 to $45.00 within a minute.",
      "The hold on Mingla's ad account goes from $120.00 to $160.00 (nothing is charged).",
      "Auto-pause moves to $156.80 (98% of the new cap).",
      "Days left at $45.00/day: about 2 — the cap is reached before the end date if it runs at full speed.",
    ]);
    assert.equal(summary.canSave, true);
  });

  it("refuses a cap below what is already spent", () => {
    const summary = budgetChangeSummary({
      planCampaigns: [femzy()],
      capText: "40",
      reason: "x",
      now: NOW,
    });
    assert.equal(summary.canSave, false);
    assert.match(summary.errors.join(" "), /can't be below what's already spent \(\$50\.00\)/);
  });

  it("needs a reason and a real change", () => {
    assert.equal(
      budgetChangeSummary({ planCampaigns: [femzy()], dailyText: "45", reason: " " }).canSave,
      false,
    );
    assert.equal(
      budgetChangeSummary({ planCampaigns: [femzy()], dailyText: "30", reason: "x" }).canSave,
      false,
    );
    assert.ok(Number.isNaN(majorToMinor("4,5")));
    assert.equal(majorToMinor("45.5"), 4550);
    assert.equal(majorToMinor(""), null);
  });

  it("never invents spend for a live campaign that has not synced", () => {
    const now = planBudgetNow([femzy({ ad_spend_daily: [] })]);
    assert.equal(now.spendCents, null);
    const summary = budgetChangeSummary({
      planCampaigns: [femzy({ ad_spend_daily: [] })],
      capText: "160",
      reason: "x",
    });
    assert.match(summary.errors.join(" "), /isn't synced yet/);
    assert.equal(planBudgetNow([femzy({ status: "PAUSED", ad_spend_daily: [] })]).spendCents, 0);
  });

  it("reads an amended budget before the frozen allocation", () => {
    const money = effectiveProviderMoney(
      femzy({ amended_provider_budget_cents: 16000, amended_provider_delivery_budget_cents: 4500 }),
    );
    assert.equal(money.capCents, 16000);
    assert.equal(money.dailyCents, 4500);
  });
});

describe("#3697 the Change budget dialog", () => {
  it("renders the fields, the unchanged end date and the save rules", () => {
    const markup = renderToStaticMarkup(
      createElement(ChangeBudgetModal, {
        open: true,
        campaign: femzy(),
        planCampaigns: [femzy()],
        onClose() {},
        onSave() {},
        now: NOW,
      }),
    );
    assert.match(markup, /Daily budget \(USD\)/);
    assert.match(markup, /Now \$30\.00 \/ day/);
    assert.match(markup, /Hard cap \(USD\)/);
    assert.match(markup, /Now \$120\.00 · spent so far \$50\.00/);
    assert.match(markup, /End date \(Lagos time\)/);
    assert.match(markup, /Oct 23, 23:59 · unchanged/);
    assert.match(markup, /Why\? \(saved in the audit log\)/);
    assert.match(markup, /Save new budget/);
  });

  it("the page offers it only on Mingla plans and sends the governed action", () => {
    const page = SRC("pages/CampaignsPage.jsx");
    assert.match(page, /<ChangeBudgetModal/);
    assert.match(page, /handleAction\(target, "change_budget", change\)/);
    assert.match(page, /not available for Host campaigns yet/);
    assert.match(page, /amended_provider_budget_cents \?\? campaign\?\.provider_budget_cents/);
    const service = SRC("services/adEngineService.js");
    assert.match(service, /if \(action === "change_budget"\)/);
    assert.match(service, /body\.daily_budget_cents = extras\.daily_budget_cents/);
    assert.match(service, /body\.cap_cents = extras\.cap_cents/);
    const row = SRC("components/ad-engine/CampaignRow.jsx");
    assert.match(row, /Change budget/);
  });
});
