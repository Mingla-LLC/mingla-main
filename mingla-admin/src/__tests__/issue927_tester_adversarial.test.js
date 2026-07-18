// ISSUE-927 QA — TESTER ADVERSARIAL suite #3 (wizard payload cascade + plan
// gates), node:test. Different angles than the implementor's
// issue927_create_wired_widened suite:
//
//   1. The D-1 mislabeling class, pinned STRUCTURALLY: for EVERY member of
//      CREATE_WIRED (iterated, not hardcoded) the payload carries its own
//      platform literal. If a sixth channel is ever added to CREATE_WIRED
//      without a payload branch — the EXACT mutation that produced the live
//      D-1 defect — this test goes red, because buildCreatePayload's
//      fallthrough would label it "meta".
//   2. End-to-end reachability boundary: every ELIGIBLE row planChannels can
//      emit builds a payload labeled with its own platform (the wizard's only
//      call path into buildCreatePayload is plan-row platforms).
//   3. Hostile state shapes: goal.platforms absent / null / prototype-chain
//      only — the three new branches must not crash and must not change their
//      platform label.
//   4. No `status`/`configured_status`/`operation_status` key in ANY payload
//      (the create-paused contract is server-owned — SC-10 class).
//   5. Cross-channel leak fuzz: reddit/tiktok/snapchat payloads never carry
//      another channel's fields (call_to_action_type, googleHeadlines,
//      special_ad_categories, ai_generated).
//   6. Market gates from a different angle: a plan spanning NG+GB excludes
//      BOTH reddit AND tiktok in one pass; a US plan admits all five (positive
//      control that the widening actually widened).
//
// KNOWN-CLASS NOTE (documented in QA_ISSUE-927.md): a platform string OUTSIDE
// CREATE_WIRED (e.g. a typo like "TikTok") still falls through to the Meta
// branch. Unreachable through the wizard today (plan rows are the only call
// path), so pinned here at the CREATE_WIRED boundary rather than asserted as
// throw-on-unknown.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CREATE_WIRED,
  planChannels,
} from "../lib/adBuilder/channelPlan.js";
import { buildCreatePayload } from "../lib/adBuilder/payload.js";
import { goalById } from "../lib/adBuilder/goals.js";

const trafficGoal = goalById("traffic");

const baseState = {
  lane: "consumer",
  name: "QA927 — Velvet Lounge — Friday Live",
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
    keywords: ["velvet lounge"],
    negativeKeywords: [],
  },
  specialAdCategory: "NONE",
  requestId: "req-qa927",
};

describe("927-QA — the D-1 mislabeling class, pinned at the CREATE_WIRED boundary", () => {
  it("EVERY member of CREATE_WIRED yields a payload labeled with its own platform (a 6th channel without a branch reds this)", () => {
    for (const platform of CREATE_WIRED) {
      const payload = buildCreatePayload(platform, baseState);
      assert.equal(
        payload.platform,
        platform,
        `CREATE_WIRED admits "${platform}" but buildCreatePayload labels it "${payload.platform}" — the D-1 mislabeled-create class is live again`,
      );
    }
  });

  it("only ONE payload in the whole wired set is labeled meta (no second path can produce a meta body)", () => {
    const labels = CREATE_WIRED.map((p) => buildCreatePayload(p, baseState).platform);
    assert.equal(labels.filter((l) => l === "meta").length, 1);
    assert.deepEqual([...new Set(labels)].sort(), [...CREATE_WIRED].sort());
  });

  it("end-to-end reachability: every ELIGIBLE plan row builds a payload carrying that row's platform", () => {
    const greenRow = (platform) => ({ platform, overall: "green", checks: [] });
    const rows = planChannels({
      preflightRows: ["meta", "tiktok", "snapchat", "google", "reddit"].map(greenRow),
      goalIds: ["traffic"],
      countries: ["US"],
      totalDailyCents: 20000,
      connections: {
        meta: { extra: { minimum_budgets: { imp: 100, video_views: 100, high_freq: 500, low_freq: 4000 } } },
      },
      metaGoal: "LINK_CLICKS",
    });
    const eligible = rows.filter((r) => r.eligible);
    assert.ok(eligible.length >= 5, `expected all five admitted on a US plan; got ${eligible.length}`);
    for (const row of eligible) {
      const payload = buildCreatePayload(row.platform, baseState);
      assert.equal(payload.platform, row.platform);
    }
  });
});

describe("927-QA — hostile state shapes never crash or relabel", () => {
  const hostileGoals = [
    { label: "platforms absent", goal: { metaObjective: "OUTCOME_TRAFFIC", metaOptimizationGoal: "LINK_CLICKS" } },
    { label: "platforms null", goal: { metaObjective: "OUTCOME_TRAFFIC", metaOptimizationGoal: "LINK_CLICKS", platforms: null } },
    { label: "platforms empty", goal: { metaObjective: "OUTCOME_TRAFFIC", metaOptimizationGoal: "LINK_CLICKS", platforms: {} } },
  ];
  for (const { label, goal } of hostileGoals) {
    it(`tiktok/reddit/snapchat with goal ${label} — safe defaults, own labels`, () => {
      const state = { ...baseState, goal };
      const tiktok = buildCreatePayload("tiktok", state);
      assert.equal(tiktok.platform, "tiktok");
      assert.equal(tiktok.objective, "TRAFFIC");
      assert.equal(tiktok.optimization_goal, "TRAFFIC_LANDING_PAGE_VIEW");
      assert.equal(tiktok.billing_event, "CPC");
      const reddit = buildCreatePayload("reddit", state);
      assert.equal(reddit.platform, "reddit");
      assert.equal(reddit.objective, "CLICKS");
      const snap = buildCreatePayload("snapchat", state);
      assert.equal(snap.platform, "snapchat");
      assert.equal(snap.optimization_goal, "SWIPES");
    });
  }

  it("an unknown TikTok goal objective falls back to the TRAFFIC pair (never an inconsistent pair)", () => {
    const state = {
      ...baseState,
      goal: { ...baseState.goal, platforms: { tiktok: { objective: "PRODUCT_SALES" } } },
    };
    const p = buildCreatePayload("tiktok", state);
    assert.equal(p.objective, "PRODUCT_SALES", "the native objective rides through; the SERVER validates it loudly");
    assert.equal(p.optimization_goal, "TRAFFIC_LANDING_PAGE_VIEW");
    assert.equal(p.billing_event, "CPC");
  });
});

describe("927-QA — no client-side status key, ever (create-paused is server-owned)", () => {
  it("no payload for any wired channel carries status/configured_status/operation_status at any depth", () => {
    for (const platform of CREATE_WIRED) {
      const flat = JSON.stringify(buildCreatePayload(platform, baseState));
      for (const key of ['"status"', '"configured_status"', '"operation_status"']) {
        assert.ok(
          !flat.includes(key),
          `${platform} payload smuggles ${key} — the server owns create-PAUSED`,
        );
      }
    }
  });
});

describe("927-QA — cross-channel field leaks", () => {
  it("reddit/tiktok/snapchat payloads never carry another channel's fields", () => {
    for (const platform of ["reddit", "tiktok", "snapchat"]) {
      const flat = JSON.stringify(buildCreatePayload(platform, baseState));
      for (const foreign of [
        "call_to_action_type", // Meta-only
        "googleHeadlines",
        "special_ad_categories", // Meta-only
        "ai_generated", // Meta-only creative flag
        "keywords", // Google-only top-level
      ]) {
        assert.ok(!flat.includes(foreign), `${platform} payload leaks ${foreign}`);
      }
    }
  });

  it("reddit payload carries no gender either (unrepresentable client-side; the server serializer owns genders)", () => {
    const p = buildCreatePayload("reddit", {
      ...baseState,
      audience: { ...baseState.audience, gender: "female" },
    });
    assert.ok(!JSON.stringify(p).includes("gender"), "reddit payload must not smuggle gender");
  });
});

describe("927-QA — market gates, combined-market angle", () => {
  const greenRow = (platform) => ({ platform, overall: "green", checks: [] });
  const base = {
    preflightRows: ["meta", "tiktok", "snapchat", "google", "reddit"].map(greenRow),
    goalIds: ["traffic"],
    totalDailyCents: 20000,
    connections: {
      meta: { extra: { minimum_budgets: { imp: 100, video_views: 100, high_freq: 500, low_freq: 4000 } } },
    },
    metaGoal: "LINK_CLICKS",
  };

  it("an NG+GB plan excludes BOTH reddit (naira) AND tiktok (UK) in one pass", () => {
    const rows = planChannels({ ...base, countries: ["NG", "GB"] });
    const reddit = rows.find((r) => r.platform === "reddit");
    const tiktok = rows.find((r) => r.platform === "tiktok");
    assert.equal(reddit.eligible, false);
    assert.match(reddit.excludedReason, /naira|NGN/i);
    assert.equal(tiktok.eligible, false);
    assert.match(tiktok.excludedReason, /UK/);
    // The gates are market gates, not endpoint gates — the reason must NOT
    // read as a create-endpoint gap.
    assert.ok(!/create branch|endpoint gap/i.test(reddit.excludedReason));
    assert.ok(!/create branch|endpoint gap/i.test(tiktok.excludedReason));
  });

  it("positive control: a US plan admits all five (the widening actually widened the DEFAULT plan)", () => {
    const rows = planChannels({ ...base, countries: ["US"] });
    const eligiblePlatforms = rows.filter((r) => r.eligible).map((r) => r.platform).sort();
    assert.deepEqual(eligiblePlatforms, ["google", "meta", "reddit", "snapchat", "tiktok"]);
  });
});
