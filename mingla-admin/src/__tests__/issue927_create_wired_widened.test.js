// ISSUE-927 — CREATE_WIRED widened to all five channels + the payload-builder
// cascade (node:test — the house admin pattern).
//
// The widening is only safe BECAUSE buildCreatePayload gained per-platform
// branches: before ISSUE-927 a non-google platform fell into the Meta branch
// and returned `platform: "meta"` — a tiktok allocation would have created a
// MISLABELED META CAMPAIGN. These tests pin:
//   1. CREATE_WIRED = the five deployed create branches; CREATE_GAP_REASONS
//      is empty (no channel behind the endpoint gap).
//   2. Every platform's payload carries ITS OWN platform literal (the
//      mislabeling class is dead).
//   3. TikTok payload: native objective (goals.js map), consistent
//      (optimization_goal, billing_event) pair, ad_text = primary copy,
//      gender mapping, NO call_to_action (the SERVER owns per-platform CTA
//      maps — GR-29).
//   4. Reddit payload: headline = primary (copyRules lints primary AS the
//      Reddit headline), NO age keys (unrepresentable on Reddit — R-8),
//      NO call_to_action.
//   5. Snapchat payload: objective/optimization_goal from the goal map
//      (SWIPES default — A1.1(6)), the #866 library id rides along,
//      brand_name conditional.
//   6. Meta + Google payloads are UNCHANGED by the new state keys (no
//      leakage of creativeLibraryId/brandName/platforms).
//   7. The market gates fire in the DEFAULT plan: NG excludes Reddit
//      (naira), GB excludes TikTok (live-proof reason) — no injection.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CREATE_GAP_REASONS,
  CREATE_WIRED,
  MARKET_GAPS,
  planChannels,
} from "../lib/adBuilder/channelPlan.js";
import { buildCreatePayload } from "../lib/adBuilder/payload.js";
import { GOALS, goalById } from "../lib/adBuilder/goals.js";

const trafficGoal = goalById("traffic");

const baseState = {
  lane: "consumer",
  name: "Velvet Lounge — Friday Live — 2026-07-16",
  goal: {
    metaObjective: "OUTCOME_TRAFFIC",
    metaOptimizationGoal: "LINK_CLICKS",
    platforms: trafficGoal.platforms,
  },
  destination: { page_type: "event", brand_slug: "velvet-lounge", entity_slug: "friday-live" },
  audience: { countries: ["US"], ageMin: 21, ageMax: 45, gender: "all" },
  budget: { dailyCentsForChannel: 2000 },
  creative: {
    imageUrl: "https://cdn.example/creative.jpg",
    aiGenerated: false,
    creativeLibraryId: "11111111-2222-4333-8444-555555555555",
    brandName: "Velvet Lounge",
  },
  copy: {
    primary: "Friday Live at Velvet Lounge",
    headline: "Friday Live",
    description: "Come through.",
    cta: "LEARN_MORE",
    googleHeadlines: ["Friday Live", "Velvet Lounge", "Live Music Friday"],
    googleDescriptions: ["Live music this Friday.", "Book your table now."],
    keywords: ["velvet lounge", "live music"],
    negativeKeywords: [],
  },
  specialAdCategory: "NONE",
  requestId: "req-927-test",
};

describe("ISSUE-927 — CREATE_WIRED widened", () => {
  it("all five channels are create-wired; the endpoint gap register is empty", () => {
    assert.deepEqual(
      [...CREATE_WIRED].sort(),
      ["google", "meta", "reddit", "snapchat", "tiktok"],
    );
    assert.deepEqual(CREATE_GAP_REASONS, {}, "no channel sits behind the endpoint gap");
  });

  it("every payload carries its OWN platform literal — the pre-927 mislabeling class is dead", () => {
    for (const platform of ["meta", "google", "tiktok", "reddit", "snapchat"]) {
      const payload = buildCreatePayload(platform, baseState);
      assert.equal(
        payload.platform,
        platform,
        `${platform} allocation must never produce a payload labeled "${payload.platform}"`,
      );
    }
  });
});

describe("ISSUE-927 — TikTok payload branch", () => {
  it("carries the native objective + the consistent goal/billing pair; ad_text = primary; NO client CTA", () => {
    const p = buildCreatePayload("tiktok", baseState);
    assert.equal(p.objective, "TRAFFIC");
    assert.equal(p.optimization_goal, "TRAFFIC_LANDING_PAGE_VIEW");
    assert.equal(p.billing_event, "CPC");
    assert.equal(p.creative.ad_text, "Friday Live at Velvet Lounge");
    assert.equal(p.creative.image_url, "https://cdn.example/creative.jpg");
    assert.equal(p.creative.creative_library_id, "11111111-2222-4333-8444-555555555555");
    assert.equal("call_to_action" in p.creative, false, "the SERVER owns the TikTok CTA map (GR-29)");
    assert.deepEqual(p.budget, { type: "daily", amount_cents: 2000 });
    assert.equal(p.targeting.age_min, 21);
    assert.equal(p.targeting.age_max, 45);
    assert.equal("gender" in p.targeting, false, 'gender "all" sends no gender key');
  });

  it("awareness maps to REACH + the REACH/CPM pair (never TRAFFIC defaults under a REACH objective)", () => {
    const awareness = goalById("awareness");
    const p = buildCreatePayload("tiktok", {
      ...baseState,
      goal: { ...baseState.goal, platforms: awareness.platforms },
    });
    assert.equal(p.objective, "REACH");
    assert.equal(p.optimization_goal, "REACH");
    assert.equal(p.billing_event, "CPM");
  });

  it("gender maps female/male to the TikTok enum", () => {
    const p = buildCreatePayload("tiktok", {
      ...baseState,
      audience: { ...baseState.audience, gender: "female" },
    });
    assert.equal(p.targeting.gender, "GENDER_FEMALE");
  });

  it("validate_only rides through", () => {
    const p = buildCreatePayload("tiktok", { ...baseState, validateOnly: true });
    assert.equal(p.validate_only, true);
  });
});

describe("ISSUE-927 — Reddit payload branch", () => {
  it("headline = the primary copy (copyRules lints primary AS the Reddit headline); NO age keys; NO client CTA", () => {
    const p = buildCreatePayload("reddit", baseState);
    assert.equal(p.creative.headline, "Friday Live at Velvet Lounge");
    assert.equal(p.creative.image_url, "https://cdn.example/creative.jpg");
    assert.equal("call_to_action" in p.creative, false, "the SERVER owns the Title-Case CTA map (GR-29)");
    // R-8: age is unrepresentable on Reddit — the payload must not smuggle it.
    const flat = JSON.stringify(p);
    assert.ok(!flat.includes("age_min") && !flat.includes("age_max"), "no age keys anywhere in a Reddit payload");
    assert.equal(p.objective, "CLICKS");
    assert.deepEqual(p.targeting, { countries: ["US"] });
  });
});

describe("ISSUE-927 — Snapchat payload branch", () => {
  it("objective/optimization_goal come from the goal map (SWIPES default — A1.1(6)); the #866 library id rides", () => {
    const p = buildCreatePayload("snapchat", baseState);
    assert.equal(p.objective, "TRAFFIC");
    assert.equal(p.optimization_goal, "SWIPES");
    assert.equal(p.creative.creative_library_id, "11111111-2222-4333-8444-555555555555");
    assert.equal(p.creative.brand_name, "Velvet Lounge");
    assert.equal(p.creative.headline, "Friday Live");
    assert.equal("call_to_action" in p.creative, false, "the SERVER defaults the S-3 CTA");
  });

  it("brand_name and creative_library_id are conditional — absent keys, not nulls", () => {
    const p = buildCreatePayload("snapchat", {
      ...baseState,
      creative: { ...baseState.creative, creativeLibraryId: null, brandName: null },
    });
    assert.equal("brand_name" in p.creative, false);
    assert.equal("creative_library_id" in p.creative, false);
  });
});

describe("ISSUE-927 — Meta/Google payloads unchanged by the new state keys", () => {
  it("meta payload leaks none of the new creative keys and keeps its contract", () => {
    const p = buildCreatePayload("meta", baseState);
    assert.equal(p.platform, "meta");
    assert.equal(p.objective, "OUTCOME_TRAFFIC");
    assert.equal(p.creative.call_to_action_type, "LEARN_MORE");
    const flat = JSON.stringify(p);
    assert.ok(!flat.includes("creative_library_id"), "no library id in the Meta payload");
    assert.ok(!flat.includes("brand_name"), "no brand_name in the Meta payload");
  });

  it("google payload still NEVER carries call_to_action_type (A4.b) and leaks nothing new", () => {
    const p = buildCreatePayload("google", baseState);
    assert.equal(p.platform, "google");
    const flat = JSON.stringify(p);
    assert.ok(!flat.includes("call_to_action"), "Search ads have no CTA button");
    assert.ok(!flat.includes("creative_library_id"), "no library id in the Google payload");
  });
});

describe("ISSUE-927 — market gates fire in the DEFAULT plan (no injection)", () => {
  const greenRow = (platform) => ({ platform, overall: "green", checks: [] });
  const metaConn = { extra: { minimum_budgets: { imp: 100, video_views: 100, high_freq: 500, low_freq: 4000 } } };
  const base = {
    preflightRows: ["meta", "tiktok", "snapchat", "google", "reddit"].map(greenRow),
    goalIds: ["traffic"],
    totalDailyCents: 5000,
    connections: { meta: metaConn },
    metaGoal: "LINK_CLICKS",
  };

  it("a Lagos plan excludes Reddit with the naira reason (WP4 P2-1, now live by default)", () => {
    const rows = planChannels({ ...base, countries: ["NG"] });
    const reddit = rows.find((r) => r.platform === "reddit");
    assert.equal(reddit.eligible, false);
    assert.match(reddit.excludedReason, /naira|NGN/i);
  });

  it("a London plan excludes TikTok with the live-proof reason (T-P2, now live by default)", () => {
    assert.deepEqual(MARKET_GAPS.tiktok.unavailable, ["GB"]);
    const rows = planChannels({ ...base, countries: ["GB"] });
    const tiktok = rows.find((r) => r.platform === "tiktok");
    assert.equal(tiktok.eligible, false);
    assert.ok(tiktok.excludedReason.includes("can't target the UK"));
  });

  it("goals.js carries a native mapping for every newly wired channel on the traffic goal", () => {
    const traffic = GOALS.find((g) => g.id === "traffic");
    for (const platform of ["tiktok", "reddit", "snapchat"]) {
      assert.ok(traffic.platforms[platform], `${platform} has a native traffic mapping`);
    }
  });
});
