/**
 * ISSUE-1002 tester adversarial — toward #3697 Wave 2 (#3707).
 *
 * [TEST-MOD-APPROVED #3697] Multi-destination fan-out is FORBIDDEN: it silently
 * multiplied channel budgets. This suite no longer models N×M create calls.
 * It proves:
 *   1. Single / empty destination boundaries stay honest.
 *   2. create endpoint source rejects destination_group_id and destinations.length>1
 *      with multi_destination_fanout_forbidden BEFORE any provider/adapter call.
 *   3. launchSummary refuses to count N×M campaigns when multiple pages are picked.
 *
 * Run: node --test src/__tests__/issue1002_multi_destination.tester_adversarial.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { buildCreatePayload } from "../lib/adBuilder/payload.js";
import { buildLaunchSummary } from "../lib/adBuilder/launchSummary.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = (rel) => readFileSync(resolve(__dirname, "..", "..", "..", rel), "utf8");

const DEST_EVENT_A = {
  id: "e-aaa",
  page_type: "event",
  brand_slug: "smokerhythm",
  slug: "friday-live",
  title: "Friday Live",
  brand_name: "Smoke & Rhythm",
  dest_url: "https://host.usemingla.com/e/smokerhythm/friday-live",
};
const DEST_EVENT_B = {
  id: "e-bbb",
  page_type: "event",
  brand_slug: "smokerhythm",
  slug: "sunday-jazz",
  title: "Sunday Jazz",
  brand_name: "Smoke & Rhythm",
  dest_url: "https://host.usemingla.com/e/smokerhythm/sunday-jazz",
};

const BASE_STATE = {
  lane: "consumer",
  name: "Smoke & Rhythm — Friday Live — 2026-07-20",
  goal: {
    metaObjective: "OUTCOME_TRAFFIC",
    metaOptimizationGoal: "LINK_CLICKS",
    platforms: {
      tiktok: { objective: "TRAFFIC" },
      reddit: { objective: "CLICKS" },
      snapchat: { objective: "TRAFFIC", optimization_goal: "SWIPES" },
      google: { objective: "TRAFFIC" },
    },
  },
  audience: { countries: ["GB"], cities: [], interests: [], ageMin: 18, ageMax: 65, gender: "all" },
  budget: { dailyCentsForChannel: 500 },
  creative: { kind: "image", imageUrl: "https://x/y.png", aiGenerated: true },
  copy: {
    primary: "The room only holds 40.",
    headline: "Book the night",
    description: "Live",
    cta: "BUY_TICKETS",
    googleHeadlines: ["Book Friday", "Live music", "Small room"],
    googleDescriptions: ["A night worth planning.", "Doors at 8."],
    keywords: ["smoke", "live music"],
    negativeKeywords: [],
  },
  specialAdCategory: "NONE",
};

describe("ISSUE-1002 adversarial · BOUNDARY — empty & single destination", () => {
  it("empty destinations → launchSummary is honest (no fabricated destination)", () => {
    const summary = buildLaunchSummary({
      channelRows: [],
      allocations: [],
      creative: null,
      totalDailyCents: 0,
      destinations: [],
    });
    assert.equal(summary.destinationLine, "No destination picked.");
    assert.equal(summary.campaignCount, 0);
  });

  it("single destination payload has no group id (DB dest_group_id stays NULL)", () => {
    const platforms = ["meta", "google", "tiktok", "reddit", "snapchat"];
    for (const platform of platforms) {
      const payload = buildCreatePayload(platform, {
        ...BASE_STATE,
        destination: {
          page_type: "event",
          brand_slug: "smokerhythm",
          entity_slug: "friday-live",
        },
        requestId: `${platform}::event:e-aaa`,
      });
      assert.equal(
        payload.destination_group_id,
        undefined,
        `${platform} single build must NOT carry a group id`,
      );
      assert.deepEqual(payload.destination, {
        page_type: "event",
        brand_slug: "smokerhythm",
        entity_slug: "friday-live",
      });
      assert.deepEqual(payload.destinations, [payload.destination]);
    }
  });
});

describe("ISSUE-1002 adversarial · Wave 2 forbids multi-destination fan-out", () => {
  it("create endpoint rejects destination_group_id and destinations.length>1 before provider work", () => {
    const src = REPO("supabase/functions/admin-ad-create-campaign/index.ts");
    const groupGate = src.indexOf("pickDestGroupId(body)");
    const multiLenGate = src.indexOf("body.destinations.length > 1");
    const forbidden = src.indexOf("multi_destination_fanout_forbidden");
    const adapterCall = src.indexOf("getAdapter(platform)");
    assert.ok(groupGate >= 0, "must resolve destination_group_id");
    assert.ok(multiLenGate >= 0, "must reject destinations[] length > 1");
    assert.ok(forbidden >= 0, "must return multi_destination_fanout_forbidden");
    assert.ok(adapterCall >= 0, "provider adapter path must still exist later");
    assert.ok(
      forbidden < adapterCall && groupGate < adapterCall && multiLenGate < adapterCall,
      "fan-out refusal must run before any provider/adapter call",
    );
    assert.match(src, /if \(destGroupId\)/, "destination_group_id alone is refused");
  });

  it("launchSummary does not multiply campaignCount across multiple destinations", () => {
    const summary = buildLaunchSummary({
      channelRows: [
        { platform: "meta", label: "Meta", eligible: true },
        { platform: "google", label: "Google", eligible: true },
      ],
      allocations: [
        { platform: "meta", dailyCents: 1000 },
        { platform: "google", dailyCents: 1000 },
      ],
      destinations: [DEST_EVENT_A, DEST_EVENT_B],
      creative: { kind: "image", name: "Hero" },
      totalDailyCents: 2000,
    });
    assert.equal(summary.campaignCount, 2, "one page only — never destinations × platforms");
    assert.match(summary.destinationLine, /Pick one page per campaign/);
  });
});
