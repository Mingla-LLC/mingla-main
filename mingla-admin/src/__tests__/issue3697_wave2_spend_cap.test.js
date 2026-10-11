/**
 * toward #3697 Wave 2 — D1 floors, single-destination, lifetime payload (#3707/#3709).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  channelFloorCents,
  computeAdminMinimumCents,
  calendarDaysBetween,
} from "../lib/adBuilder/budgetRules.js";
import { budgetPayloadFromState, buildCreatePayload } from "../lib/adBuilder/payload.js";
import { buildLaunchSummary } from "../lib/adBuilder/launchSummary.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("D1 floors: TikTok $50, Snap $20, Reddit $5, Google $0", () => {
  assert.equal(channelFloorCents("tiktok"), 5000);
  assert.equal(channelFloorCents("snapchat"), 2000);
  assert.equal(channelFloorCents("reddit"), 500);
  assert.equal(channelFloorCents("google"), 0);
});

test("D1 sum Meta+TikTok+Snap × 7 days = $525", () => {
  const r = computeAdminMinimumCents({
    platforms: ["meta", "tiktok", "snapchat"],
    mode: "lifetime",
    startsAt: "2026-10-01T00:00:00Z",
    endsAt: "2026-10-07T23:00:00Z",
    connection: { extra: { minimum_budgets: { high_freq: 500 } } },
    metaGoal: "LINK_CLICKS",
  });
  assert.equal(r.minBudgetCents, 52500);
  assert.equal(r.days, 7);
});

test("calendar days inclusive", () => {
  assert.equal(
    calendarDaysBetween("2026-10-01T12:00:00Z", "2026-10-07T01:00:00Z"),
    7,
  );
});

test("lifetime payload carries type, cap, schedule", () => {
  const { budget, schedule } = budgetPayloadFromState({
    mode: "lifetime",
    amountCents: 21000,
    capCents: 21000,
    startsAt: "2026-10-01T00:00:00.000Z",
    endsAt: "2026-10-07T23:00:00.000Z",
  });
  assert.equal(budget.type, "lifetime");
  assert.equal(budget.amount_cents, 21000);
  assert.equal(budget.cap_cents, 21000);
  assert.equal(schedule.starts_at, "2026-10-01T00:00:00.000Z");
  assert.equal(schedule.ends_at, "2026-10-07T23:00:00.000Z");
});

test("buildCreatePayload meta emits lifetime budget + schedule", () => {
  const body = buildCreatePayload("meta", {
    lane: "consumer",
    name: "Test",
    goal: {
      metaObjective: "OUTCOME_TRAFFIC",
      metaOptimizationGoal: "LINK_CLICKS",
      platforms: { meta: { objective: "OUTCOME_TRAFFIC" } },
    },
    destination: { page_type: "event", brand_slug: "acme", entity_slug: "friday" },
    audience: { countries: ["US"], ageMin: 21, ageMax: 55, gender: "all" },
    budget: {
      mode: "lifetime",
      amountCents: 35000,
      dailyCentsForChannel: 35000,
      capCents: 35000,
      startsAt: "2026-10-01T00:00:00.000Z",
      endsAt: "2026-10-07T23:00:00.000Z",
    },
    creative: { kind: "image", imageUrl: "https://example.com/a.jpg", aiGenerated: false },
    copy: { primary: "Come along", headline: "Friday", description: "Tickets", cta: "LEARN_MORE" },
    specialAdCategory: "NONE",
    requestId: "req-1",
  });
  assert.equal(body.budget.type, "lifetime");
  assert.equal(body.budget.amount_cents, 35000);
  assert.equal(body.schedule.ends_at, "2026-10-07T23:00:00.000Z");
});

test("#3707 launch summary never multiplies destinations into campaign count", () => {
  const summary = buildLaunchSummary({
    destinations: [
      { title: "A", dest_url: "https://host.usemingla.com/e/a/x" },
      { title: "B", dest_url: "https://host.usemingla.com/e/a/y" },
    ],
    channelRows: [{ platform: "meta", label: "Meta", eligible: true }],
    allocations: [{ platform: "meta", dailyCents: 5000 }],
    totalDailyCents: 5000,
    creative: { kind: "image", name: "c" },
    copyCheck: { copyHardBlocks: 0, policyFindings: 0 },
  });
  assert.equal(summary.campaignCount, 1);
  assert.match(String(summary.destinationLine), /one page|Multi-select/i);
});

test("StepDestination + builder refuse multi-dest fan-out (source)", () => {
  const dest = fs.readFileSync(
    path.join(ROOT, "src/components/campaign-builder/StepDestination.jsx"),
    "utf8",
  );
  assert.match(dest, /SINGLE select|single select/i);
  assert.doesNotMatch(dest, /\[\.\.\.selected, row\]/);

  const page = fs.readFileSync(path.join(ROOT, "src/pages/CampaignBuilderPage.jsx"), "utf8");
  assert.match(page, /destinations\.length > 1/);
  assert.match(page, /One page per campaign/);
});

test("create endpoint forbids destination_group_id (source)", () => {
  const create = fs.readFileSync(
    path.join(ROOT, "../supabase/functions/admin-ad-create-campaign/index.ts"),
    "utf8",
  );
  assert.match(create, /multi_destination_fanout_forbidden/);
  assert.match(create, /lifetime_budget_requires_end_date/);
  assert.match(create, /lifetime_budget_meta_only/);
  assert.match(create, /budget_below_platform_minimum/);
});
