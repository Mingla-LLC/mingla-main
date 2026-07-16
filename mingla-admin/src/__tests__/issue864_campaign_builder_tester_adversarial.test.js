// ISSUE-864 WP4 [Campaign Builder] — TESTER ADVERSARIAL suite (mingla-tester).
// Append-only, different angles than the implementor's 49 happy-path tests:
// exact boundaries (100/101, 1024/1025, 300/301, 30/31, 90/91), CJK×2 weighted
// counting AT the caps, emoji-stripped-length semantics, ALL-CAPS ratio edges,
// exclusion-precedence + the market gate exercised through a create-wired
// channel, hidden-goal unreachability through planChannels, budget-floor
// dollar-boundary framings ($4.99/$5.00), split conservation under odd cents,
// linter pattern-2 token-distance edges + the false-positive guard, payload
// negative-space scans, review-detail hostile shapes, and the launch-summary
// blocked-reason inline contract (this suite's own fails-on-revert anchor).
//
// One intentionally RED pin (P1-1, QA_ISSUE-864_WP4): the builder displays
// destination URLs on https://usemingla.com while the server-of-record
// resolves https://business.usemingla.com (live-proven: usemingla.com/e/* =
// HTTP 404, business.usemingla.com/e/* = 200, and the REAL Google ad created
// in QA carried finalUrls=[business.usemingla.com/...]). The pin goes green
// when the client host matches the server constant. Everything else passes.
//
// fails-on-revert (tester anchor, different module than the implementor's
// copyRules anchor): deleting the `reason: row.excludedReason` line in
// launchSummary.js fails "blocked channels carry their exclusion reason
// INLINE"; restoring passes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateCopyForChannel,
  weightedLength,
  stripEmoji,
  containsEmoji,
  isAllCaps,
  truncationPreview,
  TIKTOK_EMOJI_EXPLANATION,
} from "../lib/adBuilder/copyRules.js";
import {
  CREATE_WIRED,
  MARKET_GAPS,
  planChannels,
  splitBudget,
} from "../lib/adBuilder/channelPlan.js";
import { GOALS, platformsForGoal, platformsForGoals, visibleGoals } from "../lib/adBuilder/goals.js";
import {
  channelFloorCents,
  frequencyCapAllowed,
  launchConfirmCopy,
  learningLimitedWarning,
  metaBudgetCategoryForGoal,
  metaFloorCents,
  validateBudget,
} from "../lib/adBuilder/budgetRules.js";
import {
  lintAlcohol,
  lintPersonalAttributes,
  lintRedditDating,
  runPolicyPrecheck,
  validateSpecialAdCategory,
} from "../lib/adBuilder/policyLinter.js";
import { buildCreatePayload, dollarsToCents, suggestCampaignName } from "../lib/adBuilder/payload.js";
import { buildLaunchSummary } from "../lib/adBuilder/launchSummary.js";
import { mapReviewDetail, DELIVERY_BADGE_VARIANTS } from "../lib/adBuilder/reviewDetailMap.js";
import { validateAudience } from "../lib/adBuilder/audienceRules.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ADMIN_SRC, "../..");
const read = (p) => fs.readFileSync(p, "utf8");

// ── A4.b copy-cap BOUNDARY attacks (exactly at / one past every cap) ─────────

describe("copy caps — exact boundaries", () => {
  it("TikTok: exactly 100 passes, 101 hard-rejects", () => {
    assert.equal(validateCopyForChannel("tiktok", { primary: "x".repeat(100) }).hard.length, 0);
    assert.equal(validateCopyForChannel("tiktok", { primary: "x".repeat(101) }).hard.length, 1);
  });

  it("TikTok CJK ×2: 50 CJK (weight 100) passes; 51 CJK (weight 102) rejects; 99 latin + 1 CJK (101) rejects", () => {
    assert.equal(weightedLength("東".repeat(50)), 100);
    assert.equal(validateCopyForChannel("tiktok", { primary: "東".repeat(50) }).hard.length, 0);
    assert.equal(validateCopyForChannel("tiktok", { primary: "東".repeat(51) }).hard.length, 1);
    assert.equal(validateCopyForChannel("tiktok", { primary: "x".repeat(99) + "東" }).hard.length, 1);
  });

  it("TikTok cap applies to the EMOJI-STRIPPED text: 100 chars + emoji passes WITH the Spark explanation", () => {
    // raw length is >100 because of the emoji, but the TikTok rendition strips them first
    const result = validateCopyForChannel("tiktok", { primary: "x".repeat(100) + "🎉🔥" });
    assert.equal(result.hard.length, 0, "cap must be measured on the stripped rendition");
    assert.ok(result.warn.includes(TIKTOK_EMOJI_EXPLANATION));
    assert.ok(containsEmoji("🎉"));
    assert.equal(stripEmoji("🎉 party 🔥").stripped, 2);
  });

  it("Meta: exactly 1024 warns (never hard); 1025 hard. Exactly 125 clean; 126 warns", () => {
    const at1024 = validateCopyForChannel("meta", { primary: "x".repeat(1024) });
    assert.equal(at1024.hard.length, 0, "1024 is INSIDE the hard cap");
    assert.ok(at1024.warn.length >= 1, "1024 still carries the render-truncation warn");
    assert.equal(validateCopyForChannel("meta", { primary: "x".repeat(1025) }).hard.length, 1);
    assert.equal(validateCopyForChannel("meta", { primary: "x".repeat(125) }).warn.length, 0);
    assert.ok(validateCopyForChannel("meta", { primary: "x".repeat(126) }).warn.some((w) => w.includes("See more")));
    // CJK: 63 CJK = weight 126 → warns even at 63 visible glyphs
    assert.ok(validateCopyForChannel("meta", { primary: "東".repeat(63) }).warn.some((w) => w.includes("See more")));
  });

  it("Reddit: exactly 300 warns-not-blocks; 301 blocks; 80 clean; 81 warns; ALL-CAPS ratio edges", () => {
    assert.equal(validateCopyForChannel("reddit", { primary: "x".repeat(300) }).hard.length, 0);
    assert.equal(validateCopyForChannel("reddit", { primary: "x".repeat(301) }).hard.length, 1);
    assert.equal(validateCopyForChannel("reddit", { primary: "x".repeat(80) }).warn.length, 0);
    assert.equal(validateCopyForChannel("reddit", { primary: "x".repeat(81) }).warn.length, 1);
    // ratio boundary: >0.9 strictly — 9/10 upper does NOT trip, 10/11 does
    assert.equal(isAllCaps("ABCDEFGHIj"), false, "0.90 exactly must not trip");
    assert.equal(isAllCaps("ABCDEFGHIJk"), true, "10/11 ≈ 0.909 trips");
    assert.equal(isAllCaps("WOW"), false, "fewer than 4 letters never trips");
    // the headline field ALSO feeds the Reddit CAPS block
    const viaHeadline = validateCopyForChannel("reddit", { primary: "calm text", headline: "BUY TICKETS NOW TONIGHT" });
    assert.ok(viaHeadline.hard.some((h) => h.includes("CAPITALIZATION")));
  });

  it("Google: 15/16 headlines, 4/5 descriptions, 30/31 + 90/91 weighted caps, 80-char/10-word keyword edges", () => {
    const base = { googleDescriptions: ["d1", "d2"], keywords: ["k"] };
    const h15 = validateCopyForChannel("google", { ...base, googleHeadlines: Array.from({ length: 15 }, (_, i) => `h${i}`) });
    assert.equal(h15.hard.length, 0);
    const h16 = validateCopyForChannel("google", { ...base, googleHeadlines: Array.from({ length: 16 }, (_, i) => `h${i}`) });
    assert.ok(h16.hard.some((m) => m.includes("at most 15")));
    const d5 = validateCopyForChannel("google", { googleHeadlines: ["a", "b", "c"], googleDescriptions: ["1", "2", "3", "4", "5"], keywords: ["k"] });
    assert.ok(d5.hard.some((m) => m.includes("at most 4")));
    assert.equal(validateCopyForChannel("google", { ...base, googleHeadlines: ["x".repeat(30), "b", "c"] }).hard.length, 0);
    assert.ok(validateCopyForChannel("google", { ...base, googleHeadlines: ["x".repeat(31), "b", "c"] }).hard.some((m) => m.includes("30")));
    // CJK weighting on Google too: 15 CJK = weight 30 passes; 16 CJK rejects
    assert.equal(validateCopyForChannel("google", { ...base, googleHeadlines: ["東".repeat(15), "b", "c"] }).hard.length, 0);
    assert.ok(validateCopyForChannel("google", { ...base, googleHeadlines: ["東".repeat(16), "b", "c"] }).hard.some((m) => m.includes("30")));
    const g = { googleHeadlines: ["a", "b", "c"], googleDescriptions: ["x".repeat(90), "d2"], keywords: ["k"] };
    assert.equal(validateCopyForChannel("google", g).hard.length, 0);
    assert.ok(validateCopyForChannel("google", { ...g, googleDescriptions: ["x".repeat(91), "d2"] }).hard.some((m) => m.includes("90")));
    const kw80 = validateCopyForChannel("google", { googleHeadlines: ["a", "b", "c"], googleDescriptions: ["1", "2"], keywords: ["x".repeat(80)] });
    assert.equal(kw80.hard.length, 0);
    const kw81 = validateCopyForChannel("google", { googleHeadlines: ["a", "b", "c"], googleDescriptions: ["1", "2"], keywords: ["x".repeat(81)] });
    assert.ok(kw81.hard.some((m) => m.includes("80 characters")));
    const kw11words = validateCopyForChannel("google", { googleHeadlines: ["a", "b", "c"], googleDescriptions: ["1", "2"], keywords: ["one two three four five six seven eight nine ten eleven"] });
    assert.ok(kw11words.hard.some((m) => m.includes("10 words")));
  });

  it("whitespace-only Google entries do not satisfy the minimums", () => {
    const padded = validateCopyForChannel("google", {
      googleHeadlines: ["real", "  ", "\t"],
      googleDescriptions: ["real", "   "],
      keywords: ["  "],
    });
    assert.ok(padded.hard.some((m) => m.includes("at least 3 headlines")));
    assert.ok(padded.hard.some((m) => m.includes("at least 2 descriptions")));
    assert.ok(padded.hard.some((m) => m.includes("without keywords")));
  });

  it("truncation strip: TikTok row reports the ✗ over-cap state; Reddit row keeps ✓ under 300", () => {
    const rows = truncationPreview({ primary: "x".repeat(150) }, ["tiktok", "reddit"]);
    assert.ok(rows.find((r) => r.surface === "TikTok").suffix.startsWith("✗ 150/100"));
    assert.ok(rows.find((r) => r.surface === "Reddit").suffix.startsWith("✓ 150"));
  });
});

// ── A4.0(1) channel plan — precedence, market gate, hidden goals ─────────────

const green = (platform) => ({ platform, overall: "green", checks: [] });
const METACONN = { extra: { minimum_budgets: { imp: 100, video_views: 100, high_freq: 500, low_freq: 4000 } } };

describe("channel plan — exclusion precedence + market gate", () => {
  it("create-endpoint gap outranks a red preflight (most structural reason wins)", () => {
    const rows = planChannels({
      preflightRows: [{ platform: "tiktok", overall: "red", checks: [{ status: "fail", detail: "token dead" }] }],
      goalIds: ["traffic"],
      countries: ["US"],
      totalDailyCents: 2000,
    });
    const tiktok = rows.find((r) => r.platform === "tiktok");
    assert.ok(tiktok.excludedReason.includes("no TikTok create branch"), "endpoint gap must outrank preflight red");
  });

  it("a create-wired platform with NO preflight row is excluded loudly, never assumed green", () => {
    const rows = planChannels({ preflightRows: [green("meta")], goalIds: ["traffic"], countries: ["US"], totalDailyCents: 2000, connections: { meta: METACONN } });
    const google = rows.find((r) => r.platform === "google");
    assert.equal(google.eligible, false);
    assert.ok(google.excludedReason.includes("Preflight hasn't run"));
  });

  it("the GB market gate FIRES once a gapped channel becomes create-wired (London plan excludes TikTok)", () => {
    assert.deepEqual(MARKET_GAPS.tiktok.unavailable, ["GB"]);
    CREATE_WIRED.push("tiktok");
    try {
      const rows = planChannels({
        preflightRows: [green("tiktok")],
        goalIds: ["traffic"],
        countries: ["US", "GB", "NG"],
        totalDailyCents: 5000,
      });
      const tiktok = rows.find((r) => r.platform === "tiktok");
      assert.equal(tiktok.eligible, false);
      assert.ok(tiktok.excludedReason.includes("can't target the UK"), "GB in the plan must exclude TikTok with the live-proof reason");
      // and WITHOUT GB the same setup is eligible — the gate is the market, nothing else
      const usOnly = planChannels({ preflightRows: [green("tiktok")], goalIds: ["traffic"], countries: ["US"], totalDailyCents: 5000 });
      assert.equal(usOnly.find((r) => r.platform === "tiktok").eligible, true);
    } finally {
      CREATE_WIRED.pop();
    }
    assert.deepEqual([...CREATE_WIRED].sort(), ["google", "meta"], "restored");
  });

  it("hidden goals are unreachable through the plan: 'conversions'/'retargeting' admit ZERO channels", () => {
    for (const goalId of ["conversions", "retargeting"]) {
      assert.equal(visibleGoals().some((g) => g.id === goalId), false, `${goalId} card must not render`);
      assert.deepEqual(platformsForGoal(goalId), [], `${goalId} maps to no platform`);
      const rows = planChannels({
        preflightRows: ["meta", "google"].map(green),
        goalIds: [goalId],
        countries: ["US"],
        totalDailyCents: 2000,
        connections: { meta: METACONN },
      });
      assert.equal(rows.filter((r) => r.eligible).length, 0, `${goalId} must produce an empty channel set`);
    }
  });

  it("disjoint goal selections fall back to the union AND flag disjoint=true", () => {
    const { platforms, disjoint } = platformsForGoals(["traffic", "conversions"]);
    assert.equal(disjoint, true, "no shared channel → disjoint");
    assert.ok(platforms.includes("meta"), "union fallback keeps the expressible platforms");
    assert.equal(platformsForGoals([]).platforms.length, 0);
  });
});

describe("channel plan — budget floor dollar boundaries", () => {
  const frame = (cents, platforms) => planChannels({
    preflightRows: platforms.map(green),
    goalIds: ["traffic"],
    countries: ["US"],
    totalDailyCents: cents,
    connections: { meta: METACONN },
  });

  it("$4.99 in a Meta-only frame → NO eligible channel + the cheapest-floor message names $5.00", () => {
    const rows = frame(499, ["meta"]);
    assert.equal(rows.filter((r) => r.eligible).length, 0, "$4.99 < the $5 link-clicks floor");
    const errors = validateBudget({ totalDailyCents: 499, channelRows: rows });
    assert.ok(errors.some((e) => e.includes("$4.99/day is below every channel's minimum") && e.includes("$5.00/day")));
  });

  it("$5.00 exactly in the Meta-only frame → Meta eligible (floor is inclusive)", () => {
    const rows = frame(500, ["meta"]);
    assert.deepEqual(rows.filter((r) => r.eligible).map((r) => r.platform), ["meta"]);
    assert.equal(validateBudget({ totalDailyCents: 500, channelRows: rows }).length, 0);
  });

  it("$4.99 with Google present → Google-only (Google has NO invented floor — A4.0(4)); truth pinned", () => {
    const rows = frame(499, ["meta", "google"]);
    assert.deepEqual(rows.filter((r) => r.eligible).map((r) => r.platform), ["google"]);
    assert.equal(channelFloorCents("google", {}), null, "never invent a Google floor");
    assert.equal(channelFloorCents("reddit", {}), null, "never invent a Reddit floor");
  });

  it("split conserves ODD cent totals exactly (no cent minted or lost)", () => {
    const rows = frame(2001, ["meta", "google"]);
    const allocations = splitBudget({ totalDailyCents: 2001, channelRows: rows, strategy: "auto" });
    assert.equal(allocations.reduce((s, a) => s + a.dailyCents, 0), 2001);
    assert.equal(allocations.length, 2);
    // priority channel (meta) absorbs the odd cent
    assert.equal(allocations.find((a) => a.platform === "meta").dailyCents, 1001);
  });

  it("split with zero eligible rows or zero budget returns [] (never a phantom allocation)", () => {
    assert.deepEqual(splitBudget({ totalDailyCents: 0, channelRows: frame(2000, ["meta"]), strategy: "auto" }), []);
    assert.deepEqual(splitBudget({ totalDailyCents: 2000, channelRows: [], strategy: "auto" }), []);
  });
});

// ── A4.e budget rules — formula boundaries + unknown-goal fail-safety ────────

describe("budget rules — edges", () => {
  it("unknown optimization goals fall to the LOW_FREQ (highest, $40) floor — conservative, never $1", () => {
    assert.equal(metaBudgetCategoryForGoal("SOME_FUTURE_GOAL"), "low_freq");
    assert.equal(metaFloorCents(METACONN, "SOME_FUTURE_GOAL"), 4000);
    assert.equal(metaFloorCents(null, "LINK_CLICKS"), null, "no connection → null, server 424s");
    assert.equal(metaFloorCents({ extra: { minimum_budgets: { imp: 100 } } }, "LINK_CLICKS"), null, "missing category key → null, never a guess");
  });

  it("learning-limited boundary: exactly 50 events/week is clean; 49.98 warns", () => {
    assert.equal(learningLimitedWarning(2500, 350), null, "2500×7/350 = 50 exactly — at the bar, no warn");
    assert.ok(learningLimitedWarning(2499, 350), "one cent under warns");
    assert.equal(learningLimitedWarning(0), null);
    assert.equal(learningLimitedWarning(-500), null);
    assert.equal(learningLimitedWarning(500, 0), null, "zero CPA never divides");
  });

  it("frequency cap gate is exact-match only (case + null hostile inputs)", () => {
    assert.equal(frequencyCapAllowed("reach"), false);
    assert.equal(frequencyCapAllowed("REACH "), false);
    assert.equal(frequencyCapAllowed(null), false);
    assert.equal(frequencyCapAllowed(undefined), false);
  });

  it("launch confirm copy pluralizes and carries the 175% truth at any amount", () => {
    assert.ok(launchConfirmCopy({ channelCount: 1, totalDailyCents: 1000 }).includes("across 1 channel?"));
    assert.ok(launchConfirmCopy({ channelCount: 2, totalDailyCents: 2000 }).includes("across 2 channels?"));
    assert.ok(launchConfirmCopy({ channelCount: 1, totalDailyCents: 1 }).includes("$0.01/day"));
  });
});

// ── A4.d linter — pattern boundaries + the false-positive guard ──────────────

describe("policy linter — adversarial", () => {
  it("'Are you tired of being alone?' fires patterns 1 AND 3 — and they are findings, never blocks", () => {
    const findings = lintPersonalAttributes("Are you tired of being alone?");
    assert.ok(findings.some((f) => f.pattern === 1));
    assert.ok(findings.some((f) => f.pattern === 3));
    const panel = runPolicyPrecheck({ copyText: "Are you tired of being alone?", channelSet: ["meta", "reddit"] });
    assert.ok(!("hard" in panel), "the panel has NO hard-block channel — warn-only by construction");
  });

  it("FALSE-POSITIVE GUARD: 'Meet people near you' carries zero personal-attribute findings", () => {
    assert.equal(lintPersonalAttributes("Meet people near you").length, 0);
    // …while the Reddit DATING rule (a different, channel-scoped rule) still catches it — only with reddit in the set
    assert.ok(lintRedditDating("Meet people near you"));
    assert.equal(runPolicyPrecheck({ copyText: "Meet people near you", channelSet: ["meta", "google"] }).dating, null);
  });

  it("pattern 2 token window is 5: attribute 5 tokens from 'your' fires, 6 tokens away does not", () => {
    assert.ok(lintPersonalAttributes("your one two three four depression").some((f) => f.pattern === 2));
    assert.equal(lintPersonalAttributes("your one two three four five depression").some((f) => f.pattern === 2), false);
  });

  it("pattern 4 is template-token scoped: {name}/[first_name] fire; a plain first name does not", () => {
    assert.ok(lintPersonalAttributes("Hey {name}, tonight's plan").some((f) => f.pattern === 4));
    assert.ok(lintPersonalAttributes("Hey [first_name], tonight").some((f) => f.pattern === 4));
    assert.equal(lintPersonalAttributes("Billy plans the night").some((f) => f.pattern === 4), false);
  });

  it("alcohol lexicon: BYOB/open bar/prosecco case-insensitive; clean copy null", () => {
    assert.ok(lintAlcohol("BYOB rooftop tonight"));
    assert.ok(lintAlcohol("Open Bar until midnight"));
    assert.ok(lintAlcohol("prosecco on arrival"));
    assert.equal(lintAlcohol("Live music and small plates"), null);
  });

  it("special categories: every whitelist value ok; CREDIT and unknown values rejected", () => {
    for (const v of ["NONE", "HOUSING", "EMPLOYMENT", "FINANCIAL_PRODUCTS_SERVICES", "ISSUES_ELECTIONS_POLITICS"]) {
      assert.equal(validateSpecialAdCategory(v).ok, true, v);
    }
    assert.equal(validateSpecialAdCategory("CREDIT").ok, false);
    assert.equal(validateSpecialAdCategory("ONLINE_GAMBLING_AND_GAMING").ok, false, "no such Meta category — gambling is an authorization flow");
    assert.equal(validateSpecialAdCategory("").ok, false);
  });
});

// ── payload — negative-space scans + money edges ─────────────────────────────

describe("payload — negative space", () => {
  const state = {
    lane: "consumer",
    name: "n",
    goal: { metaObjective: "OUTCOME_TRAFFIC", metaOptimizationGoal: "LINK_CLICKS" },
    destination: { page_type: "event", brand_slug: "b", entity_slug: "e" },
    audience: { countries: ["US"], ageMin: 18, ageMax: 65, gender: "women" },
    budget: { dailyCentsForChannel: 1000 },
    creative: { imageUrl: "https://x/y.jpg", aiGenerated: false },
    copy: {
      primary: "p", headline: "h", description: "d", cta: "BUY_TICKETS",
      googleHeadlines: ["a", " b ", ""], googleDescriptions: ["1", ""], keywords: [" k "], negativeKeywords: [],
    },
    specialAdCategory: "NONE",
    requestId: "r",
  };

  it("the Google body carries NO Meta-shaped fields at all (CTA, objective, optimization, image, genders, ages)", () => {
    const json = JSON.stringify(buildCreatePayload("google", state));
    for (const banned of ["call_to_action_type", "optimization_goal", "objective", "image_url", "billing_event", "genders", "age_min", "special_ad_categor"]) {
      assert.ok(!json.includes(banned), `google payload must not carry ${banned}`);
    }
    const payload = buildCreatePayload("google", state);
    assert.deepEqual(payload.creative.headlines, ["a", "b"], "entries trimmed, empties dropped");
    assert.deepEqual(payload.keywords, ["k"]);
    assert.equal("negative_keywords" in payload, false, "empty negatives omitted entirely");
  });

  it("Meta gender mapping: women→[2], men→[1], all→field omitted", () => {
    assert.deepEqual(buildCreatePayload("meta", state).targeting.genders, [2]);
    assert.deepEqual(buildCreatePayload("meta", { ...state, audience: { ...state.audience, gender: "men" } }).targeting.genders, [1]);
    const all = buildCreatePayload("meta", { ...state, audience: { ...state.audience, gender: "all" } });
    assert.equal("genders" in all.targeting, false);
  });

  it("special_ad_category_country appears ONLY when a category is set; validate_only appears ONLY when true", () => {
    const none = buildCreatePayload("meta", state);
    assert.equal("special_ad_category_country" in none, false);
    assert.equal("validate_only" in none, false);
    const housing = buildCreatePayload("meta", { ...state, specialAdCategory: "HOUSING", validateOnly: true });
    assert.deepEqual(housing.special_ad_category_country, ["US"]);
    assert.equal(housing.validate_only, true);
  });

  it("dollars-in/cents-at-rest hostile inputs: NaN/negative/empty → 0; never micro anywhere in the builder", () => {
    assert.equal(dollarsToCents("banana"), 0);
    assert.equal(dollarsToCents(-5), 0);
    assert.equal(dollarsToCents(""), 0);
    assert.equal(dollarsToCents("19.999"), 2000, "rounds, never truncates");
    assert.equal(dollarsToCents("0.01"), 1);
    const json = JSON.stringify(buildCreatePayload("meta", state)) + JSON.stringify(buildCreatePayload("google", state));
    assert.ok(!/micro/i.test(json), "micro conversion is the server adapter's job");
  });

  it("suggestCampaignName drops missing pieces without dangling separators", () => {
    const name = suggestCampaignName({ brandName: null, title: "Tuesdays", date: new Date("2026-07-16T00:00:00Z") });
    assert.equal(name, "Tuesdays — 2026-07-16");
  });
});

// ── §1.8 launch summary — blocked-reason inline (tester fails-on-revert) ─────

describe("launch summary — blocked reasons are INLINE (tester revert anchor)", () => {
  const rows = [
    { platform: "meta", label: "Meta", eligible: true, amber: "billing pending", excludedReason: null },
    { platform: "google", label: "Google", eligible: true, amber: null, excludedReason: null },
    { platform: "tiktok", label: "TikTok", eligible: false, excludedReason: "Not available: TikTok can't target the UK" },
  ];

  it("every excluded channel line carries its exclusionReason verbatim — a dash with no why is forbidden", () => {
    const summary = buildLaunchSummary({
      channelRows: rows,
      allocations: [{ platform: "meta", dailyCents: 1000 }, { platform: "google", dailyCents: 1000 }],
      goalIds: ["traffic"],
      destination: { title: "T", dest_url: "https://business.usemingla.com/e/b/e" },
      creative: { kind: "image", name: "hero", width: 1080, height: 1080 },
      copyCheck: { policyFindings: 0, copyHardBlocks: 0 },
      totalDailyCents: 2000,
    });
    const tiktok = summary.blocked.find((b) => b.platform === "tiktok");
    assert.ok(tiktok, "excluded channel must appear in blocked[]");
    assert.equal(tiktok.reason, "Not available: TikTok can't target the UK");
    assert.ok(summary.warnings.some((w) => w.includes("billing pending")), "ambers ride into the warnings");
  });

  it("eligible-but-unfunded channels are named 'Not funded by the split.' — never silently dropped", () => {
    const summary = buildLaunchSummary({
      channelRows: rows,
      allocations: [{ platform: "meta", dailyCents: 2000 }],
      goalIds: ["traffic"],
      destination: null,
      creative: null,
      copyCheck: { policyFindings: 0, copyHardBlocks: 0 },
      totalDailyCents: 2000,
    });
    assert.ok(summary.blocked.some((b) => b.platform === "google" && b.reason === "Not funded by the split."));
  });

  it("copy line precedence: unresolved hard blocks outrank policy warnings", () => {
    const base = { channelRows: rows, allocations: [], goalIds: [], destination: null, creative: null, totalDailyCents: 0 };
    assert.ok(buildLaunchSummary({ ...base, copyCheck: { policyFindings: 3, copyHardBlocks: 2 } }).copyLine.includes("2 unresolved hard block"));
    assert.ok(buildLaunchSummary({ ...base, copyCheck: { policyFindings: 3, copyHardBlocks: 0 } }).copyLine.includes("3 policy warning"));
  });
});

// ── §1.9b review detail — hostile shapes ─────────────────────────────────────

describe("review detail map — hostile shapes", () => {
  it("Reddit: rejection_reasons ARRAY variant + DATING_* prefix family + ALCOHOL_* family all map", () => {
    const cards = mapReviewDetail({
      platform: "reddit",
      ad: { review_detail: { rejection_reasons: ["DATING_FOCUS_ON_INFIDELITY", "ALCOHOL_GLORIFICATION", "SOMETHING_NEW"] } },
    });
    assert.ok(cards.some((c) => c.title.includes("dating ad")));
    assert.ok(cards.some((c) => c.title.includes("alcohol")));
    assert.ok(cards.some((c) => c.title === "Reddit: SOMETHING_NEW"), "unknown reasons surface verbatim, never swallowed");
  });

  it("Meta: HARD_ERROR→error, SOFT_ERROR→warning; the recommendations field is NEVER read as a rejection", () => {
    const cards = mapReviewDetail({
      platform: "meta",
      ad: { review_detail: {
        issues_info: [
          { error_type: "HARD_ERROR", error_summary: "S1", error_message: "m", level: "ad" },
          { error_type: "SOFT_ERROR", error_summary: "S2", error_message: "m", level: "ad set" },
        ],
        recommendations: [{ code: 1, title: "Meta upsell", message: "raise budget" }],
      } },
    });
    assert.equal(cards.find((c) => c.title === "S1").severity, "error");
    assert.equal(cards.find((c) => c.title === "S2").severity, "warning");
    assert.equal(cards.some((c) => `${c.title} ${c.body}`.includes("upsell")), false, "recommendations are an optimization feed, not rejections");
  });

  it("Google: LIMITED→warning, FULLY_LIMITED→error; DestinationNotWorking evidence maps to the offer card", () => {
    const cards = mapReviewDetail({
      platform: "google",
      ad: { review_detail: { policy_topic_entries: [
        { topic: "T1", type: "LIMITED", evidences: [] },
        { topic: "T2", type: "FULLY_LIMITED", evidences: [] },
        { topic: "T3", type: "PROHIBITED", evidences: [{ DestinationNotWorking: { lastCheckedDateTime: "x" } }] },
      ] } },
    });
    assert.equal(cards.find((c) => c.title.includes("T1")).severity, "warning");
    assert.equal(cards.find((c) => c.title.includes("T2")).severity, "error");
    assert.ok(cards.some((c) => c.title.includes("offer isn't available")));
  });

  it("billing states (incl. NO_BUDGET) render the not-a-rejection card; empty detail renders NO fabricated card", () => {
    for (const status of ["PENDING_BILLING_INFO", "BALANCE_EXCEED", "NO_BUDGET"]) {
      const cards = mapReviewDetail({ platform: "tiktok", ad: {}, deliveryStatus: status });
      assert.equal(cards.length, 1);
      assert.equal(cards[0].severity, "warning");
    }
    assert.deepEqual(mapReviewDetail({ platform: "meta", ad: { review_detail: null }, deliveryStatus: "PAUSED" }), []);
  });

  it("badge variant map covers every review/delivery state the sync persists", () => {
    for (const s of ["ACTIVE", "PAUSED", "PENDING_REVIEW", "DISAPPROVED", "WITH_ISSUES", "PENDING_BILLING_INFO", "BALANCE_EXCEED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS", "PREAPPROVED", "REJECTED"]) {
      assert.ok(DELIVERY_BADGE_VARIANTS[s], `badge variant missing for ${s}`);
    }
  });
});

// ── audience — boundary + hostile input ──────────────────────────────────────

describe("audience rules — boundaries", () => {
  it("13/65 inclusive; 12 and 66 reject; equal min=max passes", () => {
    assert.equal(validateAudience({ countries: ["US"], ageMin: 13, ageMax: 65 }).length, 0);
    assert.ok(validateAudience({ countries: ["US"], ageMin: 12, ageMax: 65 }).length > 0);
    assert.ok(validateAudience({ countries: ["US"], ageMin: 18, ageMax: 66 }).length > 0);
    assert.equal(validateAudience({ countries: ["US"], ageMin: 30, ageMax: 30 }).length, 0);
  });

  it("Advantage+ cap: 25 passes, 26 rejects WITH the turn-it-off explanation; fractional ages reject", () => {
    assert.equal(validateAudience({ countries: ["US"], ageMin: 25, ageMax: 65, advantagePlusAudience: true }).length, 0);
    const rejected = validateAudience({ countries: ["US"], ageMin: 26, ageMax: 65, advantagePlusAudience: true });
    assert.ok(rejected.some((e) => e.includes("turn Advantage+ audience off")));
    assert.ok(validateAudience({ countries: ["US"], ageMin: "18.5", ageMax: 65 }).length > 0);
  });
});

// ── SC-10 + wiring source traps (different angle: builder cannot even import it) ──

describe("SC-10 + destination-filter source traps", () => {
  it("no campaign-builder file references the action service OR the launch action string", () => {
    const files = [
      "pages/CampaignBuilderPage.jsx",
      ...fs.readdirSync(path.join(ADMIN_SRC, "components/campaign-builder")).map((f) => `components/campaign-builder/${f}`),
    ];
    for (const file of files) {
      const source = read(path.join(ADMIN_SRC, file));
      assert.ok(!source.includes("campaignAction"), `${file}: campaignAction leaked into the builder`);
      assert.ok(!source.includes("admin-ad-campaign-action"), `${file}: action endpoint leaked into the builder`);
      assert.ok(!/action:\s*["']launch["']/.test(source), `${file}: launch action constructed in the builder`);
    }
  });

  it("the destination reader keeps BOTH load-bearing filters (status ∈ scheduled|live AND future start)", () => {
    const source = read(path.join(ADMIN_SRC, "services/adDestinationsService.js"));
    assert.ok(/\.in\(\s*["']status["']\s*,\s*\[\s*["']scheduled["']\s*,\s*["']live["']\s*\]\s*\)/.test(source), "ended/cancelled must stay excluded — the view exposes them");
    assert.ok(/\.gt\(\s*["']master_start_at["']/.test(source), "past events must stay excluded — ads at a past event get rejected as unavailable offers");
  });

  it("the campaign-builder CI job is registered and points at the happy suite", () => {
    const workflow = read(path.join(REPO_ROOT, ".github/workflows/strict-grep-mingla-business.yml"));
    assert.ok(workflow.includes("issue-864-campaign-builder-node-tests"));
    assert.ok(workflow.includes("issue864_campaign_builder_happy.test.js"));
  });
});

// ── P1-1 PIN (RED by design until the fix lands — QA_ISSUE-864_WP4 finding) ──
// The builder's displayed destination host MUST match the server of record.
// Live-proven 2026-07-16: https://usemingla.com/e/smokerhythm/fifa-grill-night
// → HTTP 404, while the deployed create endpoint resolves and persists
// https://business.usemingla.com/... (the REAL Google ad's finalUrls carried it).
// SC-3 requires "the correct resolved URL" — a 404 host is not it.

describe("P1-1 pin — destination display host parity with the server", () => {
  it("PUBLIC_WEB_ORIGIN equals the server's PRODUCTION_BUSINESS_WEB_ORIGIN", () => {
    // (adDestinationsService imports the supabase client, which needs Vite env —
    // read both constants from source instead of importing the module.)
    const serverConst = read(path.join(REPO_ROOT, "supabase/functions/_shared/businessWebOrigin.ts"))
      .match(/PRODUCTION_BUSINESS_WEB_ORIGIN\s*=\s*\n?\s*["']([^"']+)["']/);
    const clientConst = read(path.join(ADMIN_SRC, "services/adDestinationsService.js"))
      .match(/PUBLIC_WEB_ORIGIN\s*=\s*["']([^"']+)["']/);
    assert.ok(serverConst, "server constant must exist");
    assert.ok(clientConst, "client constant must exist");
    assert.equal(
      clientConst[1],
      serverConst[1],
      "the wizard shows operators a URL on a host the ad will never use — usemingla.com/e/* is a live 404 while the ad's real final URL is business.usemingla.com/e/* (P1-1)",
    );
  });
});
