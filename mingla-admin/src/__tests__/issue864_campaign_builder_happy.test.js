// ISSUE-864 WP4 [Full Rooms Ad Engine — Campaign Builder UI] — HAPPY-PATH
// regression suite (node:test — the house admin pattern: pure-logic module
// tests + fs source assertions, no DOM).
//
// What this suite pins (SPEC A4, per-rule):
//   A4.b  per-channel copy caps NEVER shared: Meta warn-not-reject at 125 /
//         hard 1024; TikTok 100-hard + emoji strip-with-explanation; Google
//         3–15 headlines ≤30 / 2–4 descriptions ≤90 + keywords REQUIRED +
//         NO call_to_action_type in the Google payload; Snap 34/32; Reddit
//         300-block / 100-warn / 80-warn + ALL-CAPS block; CJK counts ×2.
//   A4.d  4-pattern personal-attributes linter (WARN-only), Reddit DATING
//         lexicon, alcohol warning, CREDIT rejected with migration message.
//   A4.0  channel picker = preflight ∩ goal ∩ market ∩ budget OUTPUT;
//         create-wired = {meta, google} (deployed-endpoint truth);
//         goal cards for Reservations/Retargeting HIDDEN entirely.
//   A4.e  honest badges: learning-limited formula, Meta 175% pacing copy;
//         Meta per-category floors from the CONNECTION row ($5/day clicks).
//   A4.g  frequency-cap gate: REACH/THRUPLAY only.
//   §1.8  launch summary shape; §1.9b review_detail cause→fix map.
//   SC-10 the builder NEVER launches (no campaignAction path in the wizard).
//
// FAILS-ON-REVERT: deleting the TikTok hard-cap line in copyRules fails the
// TikTok test; deleting CREATE_WIRED's gate fails the channel-plan test;
// adding call_to_action_type to the Google payload fails the payload test.
// The tester writes a SECOND, adversarial suite on a different angle.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateCopyForChannel,
  validateCopy,
  weightedLength,
  stripEmoji,
  truncationPreview,
  isAllCaps,
  TIKTOK_EMOJI_EXPLANATION,
} from "../lib/adBuilder/copyRules.js";
import {
  lintPersonalAttributes,
  lintRedditDating,
  lintAlcohol,
  validateSpecialAdCategory,
  CREDIT_MIGRATION_MESSAGE,
  runPolicyPrecheck,
} from "../lib/adBuilder/policyLinter.js";
import {
  metaFloorCents,
  channelFloorCents,
  frequencyCapAllowed,
  learningLimitedWarning,
  launchConfirmCopy,
  PACING_DISCLOSURES,
} from "../lib/adBuilder/budgetRules.js";
import {
  CREATE_WIRED,
  planChannels,
  splitBudget,
  MARKET_GAPS,
} from "../lib/adBuilder/channelPlan.js";
import { GOALS, visibleGoals, platformsForGoals } from "../lib/adBuilder/goals.js";
import { buildCreatePayload, dollarsToCents, suggestCampaignName } from "../lib/adBuilder/payload.js";
import { buildLaunchSummary } from "../lib/adBuilder/launchSummary.js";
import { mapReviewDetail } from "../lib/adBuilder/reviewDetailMap.js";
import { validateAudience, ADVANTAGE_PLUS_AGE_EXPLANATION } from "../lib/adBuilder/audienceRules.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ADMIN_SRC, "../..");
const read = (p) => fs.readFileSync(p, "utf8");

// ── A4.b — per-channel copy caps, never shared ────────────────────────────────

describe("A4.b copy caps", () => {
  it("Meta warns (never rejects) between 125 and 1024, hard-rejects above 1024", () => {
    const at150 = validateCopyForChannel("meta", { primary: "x".repeat(150) });
    assert.equal(at150.hard.length, 0, "150 chars must NOT hard-reject on Meta");
    assert.ok(at150.warn.some((w) => w.includes("See more")), "150 chars warns about 'See more'");
    const at1100 = validateCopyForChannel("meta", { primary: "x".repeat(1100) });
    assert.ok(at1100.hard.some((h) => h.includes("1,024")), "1100 chars hard-rejects at Meta's 1024");
  });

  it("TikTok hard-rejects ad_text over 100 (after emoji strip)", () => {
    const result = validateCopyForChannel("tiktok", { primary: "x".repeat(101) });
    assert.ok(
      result.hard.some((h) => h.includes("100 characters")),
      "TikTok >100 must be a HARD reject — 125 shared-cap guidance actively broke TikTok",
    );
    const ok = validateCopyForChannel("tiktok", { primary: "x".repeat(100) });
    assert.equal(ok.hard.length, 0);
  });

  it("TikTok strips emoji with the Spark explanation (warn, not silent)", () => {
    const { text, stripped } = stripEmoji("Big night 🎉🔥 downtown");
    assert.equal(stripped, 2);
    assert.ok(!/🎉|🔥/.test(text));
    const result = validateCopyForChannel("tiktok", { primary: "Big night 🎉 out" });
    assert.ok(result.warn.includes(TIKTOK_EMOJI_EXPLANATION), "emoji strip must carry the Spark explanation");
  });

  it("Google enforces 3–15 headlines ≤30, 2–4 descriptions ≤90, keywords REQUIRED", () => {
    const bad = validateCopyForChannel("google", {
      googleHeadlines: ["one", "two"],
      googleDescriptions: ["only one"],
      keywords: [],
    });
    assert.ok(bad.hard.some((h) => h.includes("at least 3 headlines")));
    assert.ok(bad.hard.some((h) => h.includes("at least 2 descriptions")));
    assert.ok(bad.hard.some((h) => h.includes("without keywords")), "keywords are REQUIRED for Search");
    const overCap = validateCopyForChannel("google", {
      googleHeadlines: ["This headline is definitely longer than thirty characters", "b", "c"],
      googleDescriptions: ["d1", "d2"],
      keywords: ["venue"],
    });
    assert.ok(overCap.hard.some((h) => h.includes("30 characters")));
  });

  it("Snapchat headline hard cap 34, brand name 32", () => {
    const result = validateCopyForChannel("snapchat", {
      headline: "x".repeat(35),
      brandName: "y".repeat(33),
    });
    assert.ok(result.hard.some((h) => h.includes("34")));
    assert.ok(result.hard.some((h) => h.includes("32")));
  });

  it("Reddit: >300 block, >100 warn, >80 warn, ALL-CAPS block", () => {
    const block = validateCopyForChannel("reddit", { primary: "x".repeat(301) });
    assert.ok(block.hard.some((h) => h.includes("300")), ">300 must block — it passes create then fails review");
    const warn100 = validateCopyForChannel("reddit", { primary: "x".repeat(150) });
    assert.equal(warn100.hard.length, 0);
    assert.ok(warn100.warn.length > 0);
    const warn80 = validateCopyForChannel("reddit", { primary: "x".repeat(85) });
    assert.ok(warn80.warn.length > 0);
    const caps = validateCopyForChannel("reddit", { primary: "TUESDAY NIGHT BIG ROOM ENERGY" });
    assert.ok(caps.hard.some((h) => h.includes("CAPITALIZATION")), "ALL CAPS blocks (Reddit's literal rejection reason)");
    assert.ok(isAllCaps("TUESDAY NIGHT BIG ROOM ENERGY"));
  });

  it("counters count by weight — CJK/double-width ×2", () => {
    assert.equal(weightedLength("abc"), 3);
    assert.equal(weightedLength("東京の夜"), 8, "4 CJK chars weigh 8");
    assert.equal(weightedLength("a東b"), 4);
  });

  it("truncation preview strip renders per-channel rows with counts", () => {
    const rows = truncationPreview(
      { primary: "Sold-out energy 🎉, Tuesday night. The room only holds 40 and the line moves fast tonight in the city.", headline: "Book the night", googleHeadlines: ["Book Tuesday", "Live music"], googleDescriptions: ["d1", "d2"] },
      ["meta", "tiktok", "google"],
    );
    const surfaces = rows.map((r) => r.surface);
    assert.ok(surfaces.includes("Facebook Feed"));
    assert.ok(surfaces.includes("TikTok"));
    assert.ok(surfaces.includes("Google RSA"));
    const tiktok = rows.find((r) => r.surface === "TikTok");
    assert.ok(tiktok.suffix.includes("emoji stripped"), "TikTok row reports the emoji strip");
    const google = rows.find((r) => r.surface === "Google RSA");
    assert.ok(google.suffix.includes("2 of 15"));
  });
});

// ── A4.b — the Google payload NEVER carries call_to_action_type ───────────────

describe("payload contracts", () => {
  const state = {
    lane: "consumer",
    name: "Lorne — Tuesdays — 2026-07-16",
    goal: { metaObjective: "OUTCOME_TRAFFIC", metaOptimizationGoal: "LINK_CLICKS" },
    destination: { page_type: "event", brand_slug: "lorne", entity_slug: "tuesdays" },
    audience: { countries: ["US"], ageMin: 18, ageMax: 65, gender: "all" },
    budget: { dailyCentsForChannel: 500 },
    creative: { imageUrl: "https://x/y.png", aiGenerated: true },
    copy: {
      primary: "The room only holds 40.",
      headline: "Book the night",
      description: "Tuesdays",
      cta: "BUY_TICKETS",
      googleHeadlines: ["Book Tuesday", "Live music", "Small room"],
      googleDescriptions: ["A night worth planning.", "Doors at 8."],
      keywords: ["lorne", "tuesday live music"],
      negativeKeywords: [],
    },
    specialAdCategory: "NONE",
    requestId: "11111111-2222-3333-4444-555555555555",
  };

  it("google payload has RSA fields + keywords and NO call_to_action_type anywhere", () => {
    const payload = buildCreatePayload("google", state);
    assert.equal(payload.platform, "google");
    assert.deepEqual(payload.creative.headlines, ["Book Tuesday", "Live music", "Small room"]);
    assert.equal(payload.creative.descriptions.length, 2);
    assert.deepEqual(payload.keywords, ["lorne", "tuesday live music"]);
    const json = JSON.stringify(payload);
    assert.ok(!json.includes("call_to_action_type"), "Google is NOT an RSA CTA field — never send it (A4.b)");
    assert.ok(!json.includes("optimization_goal"), "the Google branch owns its strategy — no Meta goal leaks in");
  });

  it("meta payload carries CTA, image_url, ai_generated, validated special categories", () => {
    const payload = buildCreatePayload("meta", state);
    assert.equal(payload.creative.call_to_action_type, "BUY_TICKETS");
    assert.equal(payload.creative.image_url, "https://x/y.png");
    assert.equal(payload.creative.ai_generated, true);
    assert.deepEqual(payload.special_ad_categories, [], "NONE → empty array (validated, not hardcoded)");
    assert.equal(payload.optimization_goal, "LINK_CLICKS", "pixel epoch-0 ⇒ LINK_CLICKS (A4.0(5))");
    const housing = buildCreatePayload("meta", { ...state, specialAdCategory: "HOUSING" });
    assert.deepEqual(housing.special_ad_categories, ["HOUSING"]);
    assert.deepEqual(housing.special_ad_category_country, ["US"]);
  });

  it("no payload ever carries a status field or an activation (create-PAUSED is server-owned)", () => {
    for (const platform of ["meta", "google"]) {
      const json = JSON.stringify(buildCreatePayload(platform, state));
      assert.ok(!/"status"/.test(json), `${platform} payload must not carry status`);
      assert.ok(!/ACTIVE/.test(json), `${platform} payload must not carry ACTIVE`);
    }
  });

  it("money is dollars-in / cents-at-rest (never micro in the builder)", () => {
    assert.equal(dollarsToCents("5.00"), 500);
    assert.equal(dollarsToCents("20"), 2000);
    assert.equal(dollarsToCents(""), 0);
    const payload = buildCreatePayload("meta", state);
    assert.equal(payload.budget.amount_cents, 500);
  });

  it("campaign name auto-suggests {brand} — {title} — {date}", () => {
    assert.equal(
      suggestCampaignName({ brandName: "Lorne", title: "Tuesdays", date: new Date("2026-07-16T12:00:00Z") }),
      "Lorne — Tuesdays — 2026-07-16",
    );
  });
});

// ── A4.d — the policy pre-check panel (warn-only linter) ──────────────────────

describe("A4.d policy pre-check", () => {
  it("pattern 1: the interrogative second person", () => {
    const findings = lintPersonalAttributes("Are you tired of the same bars?");
    assert.ok(findings.some((f) => f.pattern === 1));
  });
  it("pattern 2: you/your near a protected-attribute term", () => {
    const findings = lintPersonalAttributes("perfect for your depression recovery");
    assert.ok(findings.some((f) => f.pattern === 2));
  });
  it("pattern 3: presumed-state phrasing", () => {
    const findings = lintPersonalAttributes("Tired of staying home? We fixed that.");
    assert.ok(findings.some((f) => f.pattern === 3));
  });
  it("pattern 4: name insertion", () => {
    const findings = lintPersonalAttributes("Hey {name}, this Friday is yours.");
    assert.ok(findings.some((f) => f.pattern === 4));
  });
  it("clean copy produces zero findings — and findings are warnings, not blocks", () => {
    assert.equal(lintPersonalAttributes("Sold-out energy, Tuesday night. The room only holds 40.").length, 0);
  });
  it("Reddit DATING lexicon flags 'meet someone' phrasings", () => {
    const finding = lintRedditDating("Meet people near you tonight");
    assert.ok(finding, "DATING lexicon must fire");
    assert.ok(finding.message.includes("plan the night"), "the fix names the compliant phrasing");
    assert.equal(lintRedditDating("Plan the night with the group"), null);
  });
  it("alcohol adjacency warns with the room-and-music guidance", () => {
    const finding = lintAlcohol("Half-price cocktails till 10");
    assert.ok(finding);
    assert.ok(finding.message.includes("the room and the music"));
  });
  it("CREDIT is rejected with the migration message (retired 2025-01-14)", () => {
    const result = validateSpecialAdCategory("CREDIT");
    assert.equal(result.ok, false);
    assert.equal(result.message, CREDIT_MIGRATION_MESSAGE);
    assert.ok(validateSpecialAdCategory("FINANCIAL_PRODUCTS_SERVICES").ok);
    assert.ok(validateSpecialAdCategory("NONE").ok);
  });
  it("the DATING rule is scoped to a channel set containing reddit", () => {
    const withReddit = runPolicyPrecheck({ copyText: "meet someone new", channelSet: ["meta", "reddit"] });
    assert.ok(withReddit.dating);
    const withoutReddit = runPolicyPrecheck({ copyText: "meet someone new", channelSet: ["meta"] });
    assert.equal(withoutReddit.dating, null);
  });
});

// ── A4.0(4)/A4.e — floors + honest badges ─────────────────────────────────────

describe("budget rules", () => {
  const metaConn = { extra: { minimum_budgets: { imp: 100, video_views: 100, high_freq: 500, low_freq: 4000 } } };

  it("Meta floor is per-CATEGORY from the connection row — $5/day for link clicks, $1 for reach", () => {
    assert.equal(metaFloorCents(metaConn, "LINK_CLICKS"), 500, "LINK_CLICKS is high_freq — the $1 folklore is the imp floor");
    assert.equal(metaFloorCents(metaConn, "REACH"), 100);
    assert.equal(metaFloorCents({ extra: {} }, "LINK_CLICKS"), null, "no floors stored → null (server 424s, never a hardcoded table)");
  });

  it("per-channel floors: TikTok $20/day; Reddit has NO invented floor", () => {
    assert.equal(channelFloorCents("tiktok", {}), 2000);
    assert.equal(channelFloorCents("reddit", {}), null, "the OpenAPI encodes none — let the API 400");
    assert.equal(channelFloorCents("google", {}), null);
    assert.equal(channelFloorCents("meta", { connection: metaConn, metaGoal: "LINK_CLICKS" }), 500);
  });

  it("frequency-cap control is gated to REACH/THRUPLAY (absent otherwise — A4.g)", () => {
    assert.equal(frequencyCapAllowed("REACH"), true);
    assert.equal(frequencyCapAllowed("THRUPLAY"), true);
    assert.equal(frequencyCapAllowed("LINK_CLICKS"), false, "frequency_control_specs 400s on LINK_CLICKS ad sets");
  });

  it("learning-limited formula: daily×7÷CPA < 50 warns; $5/day at $0.50 CPA does not", () => {
    assert.ok(learningLimitedWarning(100), "$1/day is a plumbing test — must warn");
    assert.ok(learningLimitedWarning(100).includes("directional"), "the honest copy: treat numbers as directional");
    assert.equal(learningLimitedWarning(500), null, "$5/day ≈ 70 events/week ≥ 50 — no warn");
  });

  it("pacing truths carry 175% (Meta, weekly-averaged) and 2× (Google)", () => {
    assert.ok(PACING_DISCLOSURES.meta.includes("175%"), "175%, not the 2× folklore");
    assert.ok(PACING_DISCLOSURES.meta.includes("7×"));
    assert.ok(PACING_DISCLOSURES.google.includes("2×"));
    assert.ok(PACING_DISCLOSURES.google.includes("30.4"));
    const copy = launchConfirmCopy({ channelCount: 1, totalDailyCents: 2000 });
    assert.ok(copy.includes("$20.00/day"));
    assert.ok(copy.includes("175%"));
  });
});

// ── A4.0(1) — channel plan: picker is an OUTPUT ───────────────────────────────

describe("channel plan", () => {
  const greenRow = (platform) => ({ platform, overall: "green", checks: [] });
  const metaConn = { extra: { minimum_budgets: { imp: 100, video_views: 100, high_freq: 500, low_freq: 4000 } } };
  const base = {
    preflightRows: ["meta", "tiktok", "snapchat", "google", "reddit"].map(greenRow),
    goalIds: ["traffic"],
    countries: ["US"],
    totalDailyCents: 2000,
    connections: { meta: metaConn },
    metaGoal: "LINK_CLICKS",
  };

  // [TEST-MOD ISSUE-927] This test pinned the WP4 endpoint truth (meta+google
  // only). ISSUE-927 added the tiktok/reddit/snapchat create branches, so the
  // pin moves to the NEW deployed truth: all five — and the downstream gates
  // (preflight/goal/market/budget) are now the real narrowing, proven below.
  it("create-wired set is all five channels (ISSUE-927 deployed endpoint truth)", () => {
    assert.deepEqual(
      [...CREATE_WIRED].sort(),
      ["google", "meta", "reddit", "snapchat", "tiktok"],
    );
    const rows = planChannels(base);
    const tiktok = rows.find((r) => r.platform === "tiktok");
    // No channel is excluded for an endpoint gap anymore — any exclusion in
    // the all-green US base plan can only be a downstream gate (e.g. budget).
    for (const row of rows) {
      if (row.excludedReason) {
        assert.ok(
          !row.excludedReason.includes("create branch") &&
            !row.excludedReason.includes("not wired"),
          `${row.platform} must not cite the retired endpoint gap: ${row.excludedReason}`,
        );
      }
    }
    assert.ok(tiktok, "tiktok row present");
    const meta = rows.find((r) => r.platform === "meta");
    const google = rows.find((r) => r.platform === "google");
    assert.equal(meta.eligible, true, "meta stays eligible in the base plan");
    assert.equal(google.eligible, true, "google stays eligible in the base plan");
  });

  it("preflight red/not_connected excludes; amber annotates but stays eligible", () => {
    const rows = planChannels({
      ...base,
      preflightRows: [
        { platform: "meta", overall: "amber", checks: [{ status: "warn", detail: "billing pending" }] },
        { platform: "google", overall: "red", checks: [{ status: "fail", detail: "dev token broken" }] },
      ],
    });
    const meta = rows.find((r) => r.platform === "meta");
    assert.equal(meta.eligible, true, "amber never blocks the BUILD — everything is created paused");
    assert.ok(meta.amber.includes("billing pending"));
    const google = rows.find((r) => r.platform === "google");
    assert.equal(google.eligible, false);
    assert.ok(google.excludedReason.includes("dev token broken"));
  });

  it("market gate: GB excludes TikTok with the live-proof reason", () => {
    assert.deepEqual(MARKET_GAPS.tiktok.unavailable, ["GB"]);
  });

  it("budget floor excludes with the exact leaving-out message", () => {
    const rows = planChannels({ ...base, totalDailyCents: 300 });
    const meta = rows.find((r) => r.platform === "meta");
    assert.equal(meta.eligible, false, "$3/day < the $5 high_freq floor");
    assert.ok(meta.excludedReason.includes("minimum"));
  });

  it("allowlist narrows but the split conserves the total exactly", () => {
    const rows = planChannels(base);
    const allocations = splitBudget({ totalDailyCents: 2000, channelRows: rows, strategy: "auto" });
    const total = allocations.reduce((s, a) => s + a.dailyCents, 0);
    assert.equal(total, 2000, "Σ allocations === total (conservation)");
    const concentrated = splitBudget({ totalDailyCents: 700, channelRows: rows, strategy: "concentrate" });
    assert.equal(concentrated.length, 1);
    assert.equal(concentrated[0].dailyCents, 700);
  });
});

// ── A4.0(5) — hidden goals ────────────────────────────────────────────────────

describe("goal config", () => {
  it("Reservations + Retargeting are HIDDEN entirely (ship with #865)", () => {
    const hidden = GOALS.filter((g) => !g.visible).map((g) => g.id).sort();
    assert.deepEqual(hidden, ["conversions", "retargeting"]);
    const visible = visibleGoals().map((g) => g.id).sort();
    assert.deepEqual(visible, ["awareness", "traffic"], "no dead/greyed buttons — only working goals render");
  });
  it("goals array is config-driven (multi-select intersection works)", () => {
    const { platforms } = platformsForGoals(["traffic"]);
    assert.ok(platforms.includes("meta"));
    assert.ok(platforms.includes("google"));
    const { platforms: both } = platformsForGoals(["traffic", "awareness"]);
    assert.ok(both.includes("meta"), "meta can express both goals");
    assert.ok(!both.includes("google"), "google can't do awareness (DISPLAY not built) — intersection drops it");
  });
});

// ── audience rules ────────────────────────────────────────────────────────────

describe("audience rules", () => {
  it("age inversion + zero countries reject with the exact messages", () => {
    const errors = validateAudience({ countries: [], ageMin: 45, ageMax: 25 });
    assert.ok(errors.includes("Pick at least one country."));
    assert.ok(errors.some((e) => e.includes("minimum age can't be higher")));
  });
  it("Advantage+ audience caps age_min at 25 — reject WITH the explanation", () => {
    const errors = validateAudience({ countries: ["US"], ageMin: 30, ageMax: 65, advantagePlusAudience: true });
    assert.ok(errors.includes(ADVANTAGE_PLUS_AGE_EXPLANATION));
    const off = validateAudience({ countries: ["US"], ageMin: 30, ageMax: 65 });
    assert.equal(off.length, 0);
  });
});

// ── §1.8 — launch summary shape ───────────────────────────────────────────────

describe("launch summary (§1.8)", () => {
  it("per-channel rows + blocked-with-reason + destination/creative/copy lines + warnings", () => {
    const summary = buildLaunchSummary({
      channelRows: [
        { platform: "meta", label: "Meta", eligible: true, amber: null, excludedReason: null },
        { platform: "tiktok", label: "TikTok", eligible: false, excludedReason: "Not available: TikTok can't target the UK" },
      ],
      allocations: [{ platform: "meta", dailyCents: 2000 }],
      goalIds: ["traffic"],
      destination: { title: "Tuesdays at Lorne", dest_url: "https://usemingla.com/e/lorne/tuesdays" },
      creative: { kind: "image", name: "hero", width: 1080, height: 1080 },
      copyCheck: { policyFindings: 0, copyHardBlocks: 0 },
      totalDailyCents: 2000,
    });
    assert.ok(summary.headline.includes("1 channel"));
    assert.ok(summary.headline.includes("$20.00/day"));
    assert.equal(summary.channels[0].dailyLabel, "$20.00/day");
    assert.ok(summary.channels[0].statusLine.includes("Paused"));
    assert.ok(summary.blocked.some((b) => b.reason.includes("can't target the UK")), "excluded channels carry the reason INLINE");
    assert.ok(summary.destinationLine.includes("usemingla.com/e/lorne/tuesdays"));
    assert.ok(summary.copyLine.includes("no personal-attribute risk"));
    assert.ok(summary.warnings.some((w) => w.includes("learning phase")) === false, "$20/day doesn't trip the learning warn");
  });

  it("learning warning appears for a $1/day allocation", () => {
    const summary = buildLaunchSummary({
      channelRows: [{ platform: "meta", label: "Meta", eligible: true, amber: null }],
      allocations: [{ platform: "meta", dailyCents: 100 }],
      goalIds: ["traffic"],
      destination: null,
      creative: null,
      copyCheck: { policyFindings: 0, copyHardBlocks: 0 },
      totalDailyCents: 100,
    });
    assert.ok(summary.warnings.some((w) => w.includes("directional")));
  });
});

// ── §1.9b — review_detail cause→fix map ───────────────────────────────────────

describe("review detail map (§1.9b)", () => {
  it("Reddit DATING → cause→fix card with the plan-the-night rewrite", () => {
    const cards = mapReviewDetail({
      platform: "reddit",
      ad: { review_detail: { rejection_reason: "DATING" } },
      deliveryStatus: "REJECTED",
    });
    assert.ok(cards.some((c) => c.title.includes("dating ad") && c.body.includes("plan the night")));
  });
  it("Reddit CAPITALIZATION + BRIDGE_PAGE map to their fixes", () => {
    const caps = mapReviewDetail({ platform: "reddit", ad: { review_detail: { rejection_reason: "CAPITALIZATION" } } });
    assert.ok(caps.some((c) => c.body.includes("ALL CAPS")));
    const bridge = mapReviewDetail({ platform: "reddit", ad: { review_detail: { rejection_reason: "BRIDGE_PAGE" } } });
    assert.ok(bridge.some((c) => c.title.includes("bridge page")));
  });
  it("Google DestinationMismatch → the tracking-template fix", () => {
    const cards = mapReviewDetail({
      platform: "google",
      ad: { review_detail: { policy_topic_entries: [{ topic: "DESTINATION_MISMATCH", type: "PROHIBITED", evidences: [] }] } },
    });
    assert.ok(cards.some((c) => c.title.includes("destination") && c.body.includes("tracking template")));
  });
  it("Meta personal attributes → rewrite-as-a-statement fix", () => {
    const cards = mapReviewDetail({
      platform: "meta",
      ad: { review_detail: { ad_review_feedback: { global: { PERSONAL_ATTRIBUTES: "Ad implies personal attributes" } } } },
    });
    assert.ok(cards.some((c) => c.title.includes("personal attributes") && c.body.includes("statement about the night")));
  });
  it("PENDING_BILLING_INFO / BALANCE_EXCEED are NOT rejections", () => {
    for (const status of ["PENDING_BILLING_INFO", "BALANCE_EXCEED"]) {
      const cards = mapReviewDetail({ platform: "meta", ad: {}, deliveryStatus: status });
      assert.ok(cards.some((c) => c.title.includes("Not a rejection")), `${status} maps to the billing card`);
    }
  });
});

// ── SC-10 — the builder NEVER launches (source assertions) ────────────────────

describe("SC-10 create-paused (source assertions)", () => {
  const builderFiles = [
    "pages/CampaignBuilderPage.jsx",
    ...fs.readdirSync(path.join(ADMIN_SRC, "components/campaign-builder")).map((f) => `components/campaign-builder/${f}`),
  ];

  it("no builder file imports or calls campaignAction (launch is #/campaigns-only)", () => {
    for (const file of builderFiles) {
      const source = read(path.join(ADMIN_SRC, file));
      assert.ok(!source.includes("campaignAction"), `${file} must never touch campaignAction — SC-10`);
    }
  });

  it("the campaign surface owns Launch with the §1.8 confirm modal", () => {
    const source = read(path.join(ADMIN_SRC, "pages/CampaignsPage.jsx"));
    assert.ok(source.includes("campaignAction"));
    assert.ok(source.includes("launchConfirmCopy"), "launch goes through the pacing-honest confirm modal");
    assert.ok(source.includes("data?.warning") || source.includes("data.warning"), "the 200+warning contract is rendered, never swallowed");
    assert.ok(source.includes("mapReviewDetail"), "review_detail renders through the §1.9b cause→fix map");
  });

  it("routes + nav registered; wizard reachable at #/campaign-builder", () => {
    const app = read(path.join(ADMIN_SRC, "App.jsx"));
    assert.ok(app.includes('"campaign-builder": CampaignBuilderPage'));
    assert.ok(app.includes("campaigns: CampaignsPage"));
    const constants = read(path.join(ADMIN_SRC, "lib/constants.js"));
    assert.ok(constants.includes('id: "campaign-builder"'));
    assert.ok(constants.includes('id: "campaigns"'));
  });

  it("the creative step wires admin-ad-creative-upload with the validate action", () => {
    const step = read(path.join(ADMIN_SRC, "components/campaign-builder/StepCreative.jsx"));
    assert.ok(step.includes('action: "validate"'), "inline validate before record");
    assert.ok(step.includes('action: "record"'));
    const service = read(path.join(ADMIN_SRC, "services/adEngineService.js"));
    assert.ok(service.includes("admin-ad-creative-upload"));
  });

  it("the bucket migration exists with public read + admin-only writes", () => {
    const migration = read(path.join(REPO_ROOT, "supabase/migrations/20270101000864_issue_864_meta_ad_creatives_bucket.sql"));
    assert.ok(migration.includes("'meta-ad-creatives'"));
    assert.ok(migration.includes("public.is_admin_user()"), "writes are admin-gated (I-PROPOSED-864-CREATIVE-BUCKET-ADMIN-WRITE)");
    assert.ok(migration.includes("FOR SELECT"));
    assert.ok(/FOR INSERT[\s\S]*?is_admin_user/.test(migration));
  });

  it("spec'd-but-missing endpoints stay behind feature flags (fail-soft, never invented)", () => {
    const flags = read(path.join(ADMIN_SRC, "lib/adBuilder/flags.js"));
    // ISSUE-989: the targeting-search proxy LANDED (admin-ad-targeting-search
    // deployed, city+interest resolvers PROVEN live) — its flag is now flipped
    // ON, exactly as flags.js documented ("flip ONLY when its endpoint lands").
    // The other two endpoints remain unbuilt, so their flags stay false.
    assert.ok(flags.includes("TARGETING_SEARCH_PROXY_ENABLED = true"));
    assert.ok(flags.includes("API_AD_PREVIEWS_ENABLED = false"));
    assert.ok(flags.includes("FREQUENCY_CAP_CONTROL_ENABLED = false"));
  });
});

// ── WP4 REWORK (QA_ISSUE-864_WP4) — appended, append-only ─────────────────────
// P1-1: the builder-displayed destination host MUST equal the server of
// record (PRODUCTION_BUSINESS_WEB_ORIGIN — the host the deployed create fn
// persists into dest_url/finalUrls; usemingla.com/e/* is a live 404).
// P2-1: the NG/Reddit billing exclusion is ENCODED in the plan, provable
// through a create-wired Reddit (not dead code behind CREATE_WIRED).

describe("REWORK P1-1 — destination display host parity (implementor guard)", () => {
  it("PUBLIC_WEB_ORIGIN literal equals the server's PRODUCTION_BUSINESS_WEB_ORIGIN literal", () => {
    const serverConst = read(path.join(REPO_ROOT, "supabase/functions/_shared/businessWebOrigin.ts"))
      .match(/PRODUCTION_BUSINESS_WEB_ORIGIN\s*=\s*\n?\s*["']([^"']+)["']/);
    const clientConst = read(path.join(ADMIN_SRC, "services/adDestinationsService.js"))
      .match(/PUBLIC_WEB_ORIGIN\s*=\s*["']([^"']+)["']/);
    assert.ok(serverConst, "server constant must exist");
    assert.ok(clientConst, "client constant must exist (a literal — the parity pins regex it)");
    assert.equal(clientConst[1], serverConst[1], "one owner per truth: the wizard must display the host the ad will actually carry (QA P1-1)");
    assert.equal(clientConst[1], "https://business.usemingla.com", "the live-proven 200 host");
  });

  it("no divergent public-host literal survives anywhere in the wizard trees", () => {
    const trees = [
      "services/adDestinationsService.js",
      "services/mediaUpload.js",
      "pages/CampaignBuilderPage.jsx",
      "pages/CampaignsPage.jsx",
      ...fs.readdirSync(path.join(ADMIN_SRC, "components/campaign-builder")).map((f) => `components/campaign-builder/${f}`),
      ...fs.readdirSync(path.join(ADMIN_SRC, "lib/adBuilder")).map((f) => `lib/adBuilder/${f}`),
    ];
    for (const file of trees) {
      const source = read(path.join(ADMIN_SRC, file));
      // Any usemingla.com literal must be the business host (comments citing
      // the SPEC erratum name the bad literal — allow the word 'erratum' on
      // the same line).
      for (const line of source.split("\n")) {
        if (line.includes("usemingla.com") && !line.includes("business.usemingla.com") && !/erratum/i.test(line)) {
          assert.fail(`${file} carries a non-business usemingla.com literal: ${line.trim()}`);
        }
      }
    }
  });

  it("AdPreview's placeholder host derives from PUBLIC_WEB_ORIGIN, not a literal", () => {
    const source = read(path.join(ADMIN_SRC, "components/campaign-builder/AdPreview.jsx"));
    assert.ok(source.includes("PUBLIC_WEB_ORIGIN"), "fallback host must derive from the shared origin constant");
    assert.ok(!source.includes('"USEMINGLA.COM"'), "the old hardcoded fallback literal must be gone");
  });
});

describe("REWORK P2-1 — Nigeria never routes to Reddit (blueprint §1.3)", () => {
  const greenRow = (platform) => ({ platform, overall: "green", checks: [] });
  const metaConn = { extra: { minimum_budgets: { imp: 100, video_views: 100, high_freq: 500, low_freq: 4000 } } };
  const base = {
    preflightRows: ["meta", "tiktok", "snapchat", "google", "reddit"].map(greenRow),
    goalIds: ["traffic"],
    totalDailyCents: 2000,
    connections: { meta: metaConn },
    metaGoal: "LINK_CLICKS",
  };

  it("MARKET_GAPS encodes the NGN billing exclusion for Reddit", () => {
    assert.deepEqual(MARKET_GAPS.reddit.unavailable, ["NG"]);
    assert.ok(/naira|NGN/i.test(MARKET_GAPS.reddit.reason), "the reason names the billing-currency gap");
  });

  it("with Reddit create-wired, an NG plan excludes Reddit with the no-NGN reason", () => {
    const rows = planChannels({
      ...base,
      countries: ["NG"],
      createWired: ["meta", "google", "reddit"],
    });
    const reddit = rows.find((r) => r.platform === "reddit");
    assert.equal(reddit.eligible, false, "the day the Reddit create branch lands, Lagos must NOT silently route to Reddit");
    assert.ok(/naira|NGN/i.test(reddit.excludedReason));
  });

  it("with Reddit create-wired, a US plan keeps Reddit eligible (the gate is the market, nothing else)", () => {
    const rows = planChannels({
      ...base,
      countries: ["US"],
      createWired: ["meta", "google", "reddit"],
    });
    const reddit = rows.find((r) => r.platform === "reddit");
    assert.equal(reddit.eligible, true);
  });

  // [TEST-MOD ISSUE-927] Reddit's create branch is wired now, so the endpoint
  // gap no longer pre-empts the NG rule — the STRONGER truth this test always
  // wanted: the naira billing gate fires in the DEFAULT plan, no injection.
  it("since ISSUE-927 the NG billing gate excludes Reddit in the DEFAULT plan (live rule, not dead code)", () => {
    const rows = planChannels({ ...base, countries: ["NG"] });
    const reddit = rows.find((r) => r.platform === "reddit");
    assert.equal(reddit.eligible, false, "Lagos must NOT route to Reddit — no NGN funding currency");
    assert.ok(/naira|NGN/i.test(reddit.excludedReason), "the reason names the billing-currency gap");
    assert.ok(!reddit.excludedReason.includes("no Reddit create branch"), "the endpoint gap is retired");
  });
});
