// ISSUE-986 [Campaign Builder platform picker] — mingla-tester's INDEPENDENT
// adversarial regression suite. Different angle than the implementor's 16
// tests in issue986_platform_picker.test.js (that file: single-strategy
// "auto"/"diversify" redirect checks, one market-gate ineligibility case, one
// Meta+HOUSING payload check, fs-grep component wiring). This file:
//
//   A. Cross-consistency — the SAME picked set proven to drive splitBudget AND
//      the StepCopy platform derivation AND the ACTUAL buildCreatePayload
//      objects AND buildLaunchSummary simultaneously (not just splitBudget's
//      return value in isolation), using the "concentrate" strategy (never
//      exercised by the implementor's redirect tests) to prove the Meta→next
//      redirect holds under the single-winner-takes-all strategy too.
//   B. Eligibility-safety attack via a DIFFERENT gate (budget floor, not
//      market) + a garbage/malformed selectedPlatforms array (duplicates,
//      unknown ids, non-string entries) + an immutability proof that
//      applyChannelSelection never mutates the raw channelRows StepPreflight
//      and StepPolicy both still read directly.
//   C. Compliance round-trip (category ON then OFF restores the excluded
//      platforms — proves the exclusion is a live recomputation, never a
//      sticky mutation of selectedPlatforms) + repeated re-selection attempts
//      against an active exclusion + the "diversify" strategy (most eager to
//      spread money) at budget extremes + a structural proof that payload.js
//      has NO special-ad-category field on the 4 non-Meta branches (so the
//      selection-layer exclusion is the ONLY thing standing between "safe"
//      and an undeclared special-category ad) + the #979 neutral-descriptor
//      regression check across ALL FIVE platforms (implementor checked one).
//   D. Degenerate select-NONE cross-checked against ISSUE-979 Bug-4's
//      unfundedEligibleChannels (a deselected channel must never ALSO be
//      double-reported as "eligible but $0-funded") + a rapid-toggle
//      determinism/no-duplicate proof against the real togglePlatform
//      reducer (source-coupled via fs assertion so a source change that
//      breaks the coupling fails loudly), which the implementor's suite
//      never exercises at all.
//
// FAILS-ON-REVERT (independently verified by the tester via true line-
// deletion, see the PR #987 comment for the exact commands run):
//   - deleting applyChannelSelection's de-selection branch (channelPlan.js)
//     fails Suite A (redirect) and Suite D (select-none/rapid-toggle) — the
//     same branch the implementor's suite depends on.
//   - widening SPECIAL_CATEGORY_CAPABLE_PLATFORMS to all 5 (compliance.js)
//     fails Suite C in full (round-trip, repeated re-selection, budget-
//     extreme funding-never-leaks, and the payload-shape proof no longer
//     matches reality since the exclusion collapses to nothing).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALL_PLATFORMS,
  applyChannelSelection,
  planChannels,
  splitBudget,
  unfundedEligibleChannels,
} from "../lib/adBuilder/channelPlan.js";
import { complianceExclusions } from "../lib/adBuilder/compliance.js";
import { buildCreatePayload } from "../lib/adBuilder/payload.js";
import { buildLaunchSummary } from "../lib/adBuilder/launchSummary.js";
import { goalById } from "../lib/adBuilder/goals.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(p, "utf8");

const greenRow = (platform) => ({ platform, overall: "green", checks: [] });
const metaConn = { extra: { minimum_budgets: { imp: 100, video_views: 100, high_freq: 500, low_freq: 4000 } } };
const base = {
  preflightRows: ALL_PLATFORMS.map(greenRow),
  goalIds: ["traffic"],
  countries: ["US"],
  connections: { meta: metaConn },
  metaGoal: "LINK_CLICKS",
};

// Mirrors the exact fields CampaignBuilderPage.runCreate assembles per
// allocation (a real create body, not a synthetic shortcut).
const buildState = (overrides = {}) => {
  const trafficGoal = goalById("traffic");
  return {
    lane: "consumer",
    name: "986-adversarial",
    goal: { metaObjective: "OUTCOME_TRAFFIC", metaOptimizationGoal: "LINK_CLICKS", platforms: trafficGoal.platforms },
    destination: { page_type: "event", brand_slug: "b", entity_slug: "e" },
    audience: { countries: ["US"], ageMin: 21, ageMax: 45, gender: "all" },
    creative: { imageUrl: "https://cdn.example/x.jpg", aiGenerated: true, brandName: "B" },
    copy: { primary: "p", headline: "h", description: "d", cta: "LEARN_MORE", googleHeadlines: ["a", "b", "c"], googleDescriptions: ["d1", "d2"], keywords: ["k"], negativeKeywords: [] },
    specialAdCategory: "NONE",
    requestId: "r-adversarial",
    ...overrides,
  };
};

describe("ISSUE-986 ADVERSARIAL — A: a picked SUBSET drives split + StepCopy + the real create payload + Review, together", () => {
  it("picking a SINGLE non-Meta platform (snapchat) is the ONLY thing that appears in the split, the StepCopy platform list, a real create payload, and the launch summary", () => {
    const rows = planChannels({ ...base, totalDailyCents: 3000 });
    const planned = applyChannelSelection({ channelRows: rows, selectedPlatforms: ["snapchat"] });

    // splitBudget
    const allocations = splitBudget({ channelRows: planned, totalDailyCents: 3000, strategy: "auto" });
    assert.deepEqual(allocations.map((a) => a.platform), ["snapchat"], "only the single picked platform is funded");
    assert.equal(allocations[0].dailyCents, 3000, "it gets the WHOLE budget, not a fraction");

    // StepCopy's exact derivation (channelRows.filter(r => r.eligible).map(r => r.platform))
    const copyPlatforms = planned.filter((r) => r.eligible).map((r) => r.platform);
    assert.deepEqual(copyPlatforms, ["snapchat"], "StepCopy would build copy for exactly the picked platform");

    // A real create payload — not just the platform id splitBudget returns
    const payloads = allocations.map((a) =>
      buildCreatePayload(a.platform, buildState({ budget: { dailyCentsForChannel: a.dailyCents } })),
    );
    assert.equal(payloads.length, 1, "the create loop (one buildCreatePayload call per allocation) builds exactly one payload");
    assert.equal(payloads[0].platform, "snapchat");
    assert.equal(payloads[0].budget.amount_cents, 3000, "the payload carries the redirected full budget");
    for (const p of ["meta", "tiktok", "google", "reddit"]) {
      assert.ok(!allocations.some((a) => a.platform === p), `${p} never reaches the create loop — no payload is ever built for it`);
    }

    // Review / launch summary
    const summary = buildLaunchSummary({ channelRows: planned, allocations, totalDailyCents: 3000 });
    assert.equal(summary.channels.length, 1);
    assert.equal(summary.channels[0].platform, "snapchat");
    assert.equal(summary.channels[0].dailyLabel, "$30.00/day");
    const blockedPlatforms = summary.blocked.map((b) => b.platform).sort();
    assert.deepEqual(blockedPlatforms, ["google", "meta", "reddit", "tiktok"], "the 4 unpicked platforms show up as blocked in Review, never silently absent");
  });

  it("deselecting Meta redirects its ENTIRE budget under CONCENTRATE (single-winner-takes-all) — the strategy the implementor's redirect tests never used", () => {
    const rows = planChannels({ ...base, totalDailyCents: 5000 });

    const plannedAll = applyChannelSelection({ channelRows: rows, selectedPlatforms: null });
    const allocAll = splitBudget({ channelRows: plannedAll, totalDailyCents: 5000, strategy: "concentrate" });
    assert.deepEqual(allocAll, [{ platform: "meta", dailyCents: 5000 }], "with everything picked, Concentrate puts 100% on Meta (priority[0])");

    const plannedNoMeta = applyChannelSelection({ channelRows: rows, selectedPlatforms: ["tiktok", "snapchat", "google", "reddit"] });
    const allocNoMeta = splitBudget({ channelRows: plannedNoMeta, totalDailyCents: 5000, strategy: "concentrate" });
    assert.deepEqual(allocNoMeta, [{ platform: "tiktok", dailyCents: 5000 }], "deselecting Meta redirects the FULL $50/day to the next-priority picked platform, never Meta, never split, never lost");

    // Cross-check the create payload + StepCopy + Review agree with the redirect.
    const payload = buildCreatePayload("tiktok", buildState({ budget: { dailyCentsForChannel: allocNoMeta[0].dailyCents } }));
    assert.equal(payload.budget.amount_cents, 5000, "TikTok's create payload receives the FULL redirected amount");
    const copyPlatforms = plannedNoMeta.filter((r) => r.eligible).map((r) => r.platform);
    assert.ok(!copyPlatforms.includes("meta"), "StepCopy never names Meta once it's deselected");
    const summary = buildLaunchSummary({ channelRows: plannedNoMeta, allocations: allocNoMeta, totalDailyCents: 5000 });
    const metaBlocked = summary.blocked.find((b) => b.platform === "meta");
    assert.ok(metaBlocked, "Review shows Meta as blocked (deselected), not silently missing");
    assert.match(metaBlocked.reason, /not selected/i);
  });
});

describe("ISSUE-986 ADVERSARIAL — B: eligibility safety cannot be forced via tampered/garbage state", () => {
  it("a platform excluded by the BUDGET FLOOR gate (not the market gate the implementor tested) stays ineligible even when forced into selectedPlatforms", () => {
    // $15/day: TikTok's $20 floor excludes it; Meta ($5 floor), Snapchat ($5),
    // Google/Reddit (no hard floor) stay eligible. A different exclusion path
    // than the implementor's GB/market-gate case.
    const rows = planChannels({ ...base, totalDailyCents: 1500 });
    const ttCandidate = rows.find((r) => r.platform === "tiktok");
    assert.equal(ttCandidate.eligible, false, "TikTok is ineligible on the BUDGET FLOOR gate, not market");
    assert.match(ttCandidate.excludedReason, /leaving TikTok out/);

    const planned = applyChannelSelection({ channelRows: rows, selectedPlatforms: [...ALL_PLATFORMS] });
    const ttPlanned = planned.find((r) => r.platform === "tiktok");
    assert.equal(ttPlanned.eligible, false, "forcing tiktok into selectedPlatforms does not override the floor gate");
    assert.equal(ttPlanned.excludedReason, ttCandidate.excludedReason, "the budget-floor reason survives verbatim, not overwritten");
    assert.ok(!ttPlanned.deselected, "this is a safety-gate exclusion, not a de-selection");

    const allocations = splitBudget({ channelRows: planned, totalDailyCents: 1500, strategy: "diversify" });
    assert.ok(!allocations.some((a) => a.platform === "tiktok"), "an ineligible platform is never funded, even under Diversify");
  });

  it("a garbage selectedPlatforms array (duplicates, an unknown platform id, non-string entries) never expands the eligible set and never crashes", () => {
    const rows = planChannels({ ...base, totalDailyCents: 1500 }); // tiktok ineligible on budget floor here too
    const garbage = ["meta", "meta", "meta", "MEGATRON", "tiktok", "tiktok", 123, null, undefined, ""];

    let planned;
    assert.doesNotThrow(() => {
      planned = applyChannelSelection({ channelRows: rows, selectedPlatforms: garbage });
    }, "a malformed selection array must never throw");

    assert.equal(planned.length, 5, "no phantom platform (e.g. 'MEGATRON') is ever materialized — the function maps over the real channelRows, never the selection array");
    const eligible = planned.filter((r) => r.eligible).map((r) => r.platform);
    assert.deepEqual(eligible, ["meta"], "only 'meta' — the one REAL, truly-eligible, garbage-array-included platform — survives; MEGATRON/123/null/'' have zero effect");
    const ttPlanned = planned.find((r) => r.platform === "tiktok");
    assert.equal(ttPlanned.eligible, false);
    assert.match(ttPlanned.excludedReason, /leaving TikTok out/, "tiktok keeps its real budget-floor reason even though it's twice in the garbage array");
  });

  it("applyChannelSelection never mutates its channelRows input — StepPreflight and StepPolicy both read this SAME raw array untouched", () => {
    const rows = planChannels({ ...base, totalDailyCents: 3000 });
    const snapshot = JSON.stringify(rows);

    applyChannelSelection({ channelRows: rows, selectedPlatforms: ["meta"] });
    assert.equal(JSON.stringify(rows), snapshot, "channelRows unchanged after a narrow selection");

    applyChannelSelection({ channelRows: rows, selectedPlatforms: [] });
    assert.equal(JSON.stringify(rows), snapshot, "channelRows unchanged after a select-none call — no shared-reference corruption reaching StepPreflight/StepPolicy");

    // Purity: same input, same output, every time.
    const out1 = applyChannelSelection({ channelRows: rows, selectedPlatforms: ["meta", "google"] });
    const out2 = applyChannelSelection({ channelRows: rows, selectedPlatforms: ["meta", "google"] });
    assert.deepEqual(out1, out2, "applyChannelSelection is pure — identical inputs always produce identical outputs");
  });
});

describe("ISSUE-986 ADVERSARIAL — C: compliance exclusion round-trips, resists repeated re-selection, and is structurally the ONLY guard", () => {
  const rows = planChannels({ ...base, totalDailyCents: 4000 });
  const eligiblePlatforms = rows.filter((r) => r.eligible).map((r) => r.platform);

  it("clearing the special ad category RESTORES the 4 excluded platforms using the SAME selectedPlatforms array — the exclusion is a live recomputation, not a sticky mutation", () => {
    const selectedPlatforms = [...ALL_PLATFORMS]; // operator has explicitly "selected all"

    const excludedOn = complianceExclusions("HOUSING", eligiblePlatforms);
    const plannedOn = applyChannelSelection({ channelRows: rows, selectedPlatforms, excluded: excludedOn });
    assert.deepEqual(plannedOn.filter((r) => r.eligible).map((r) => r.platform), ["meta"], "HOUSING active: only Meta survives");

    const excludedOff = complianceExclusions("NONE", eligiblePlatforms); // {} — category cleared
    const plannedOff = applyChannelSelection({ channelRows: rows, selectedPlatforms, excluded: excludedOff }); // same array reference, unchanged
    assert.deepEqual(
      plannedOff.filter((r) => r.eligible).map((r) => r.platform).sort(),
      [...ALL_PLATFORMS].sort(),
      "clearing the category restores ALL 5 — nothing about clearing it required touching selectedPlatforms",
    );
    for (const row of plannedOff) {
      assert.ok(!row.complianceExcluded, `${row.platform} carries no leftover complianceExcluded tag after the category is cleared`);
      assert.ok(!row.deselected, `${row.platform} carries no leftover deselected tag either`);
    }
  });

  it("repeated re-selection attempts against an ACTIVE exclusion never demote the reason to a mere 'not selected' tag", () => {
    const excluded = complianceExclusions("EMPLOYMENT", eligiblePlatforms);
    const attempts = [
      [...ALL_PLATFORMS], // tiktok explicitly included
      ALL_PLATFORMS.filter((p) => p !== "tiktok"), // tiktok explicitly excluded
      [...ALL_PLATFORMS], // tiktok explicitly included again
    ];
    let firstReason = null;
    for (const selectedPlatforms of attempts) {
      const planned = applyChannelSelection({ channelRows: rows, selectedPlatforms, excluded });
      const tt = planned.find((r) => r.platform === "tiktok");
      assert.equal(tt.eligible, false);
      assert.equal(tt.complianceExcluded, true, "always tagged complianceExcluded, regardless of whether it's 'selected' this round");
      assert.ok(!tt.deselected, "never demoted to a plain de-selection — the compliance reason always wins");
      firstReason ??= tt.excludedReason;
      assert.equal(tt.excludedReason, firstReason, "the reason text never flaps between attempts");
    }
  });

  it("at BOTH a tiny and a very large budget, under Diversify (the most eager-to-spread strategy), a special-category build never funds a non-Meta platform", () => {
    for (const totalDailyCents of [700, 100000]) {
      const budgetRows = planChannels({ ...base, totalDailyCents });
      const elig = budgetRows.filter((r) => r.eligible).map((r) => r.platform);
      const excluded = complianceExclusions("ISSUES_ELECTIONS_POLITICS", elig);
      const planned = applyChannelSelection({ channelRows: budgetRows, selectedPlatforms: [...ALL_PLATFORMS], excluded });
      const allocations = splitBudget({ channelRows: planned, totalDailyCents, strategy: "diversify" });
      assert.ok(allocations.every((a) => a.platform === "meta"), `at $${totalDailyCents / 100}/day (Diversify), only Meta is ever funded once a special category is active`);
    }
  });

  it("payload.js has NO special-ad-category-declaring field on the 4 non-Meta branches — the selection-layer exclusion is the ONLY guard against an undeclared special-category ad", () => {
    const state = buildState({ specialAdCategory: "HOUSING", budget: { dailyCentsForChannel: 2000 } });
    for (const platform of ["tiktok", "snapchat", "google", "reddit"]) {
      const payload = buildCreatePayload(platform, state);
      assert.ok(!("special_ad_categories" in payload), `${platform}'s create payload has structurally NO field to declare HOUSING`);
      assert.equal(payload.compliance.specialAdCategory, "HOUSING", `${platform} still carries the NEUTRAL #979 descriptor (informational only, not an enforced declaration)`);
    }
    const metaPayload = buildCreatePayload("meta", state);
    assert.deepEqual(metaPayload.special_ad_categories, ["HOUSING"], "only Meta's payload actually DECLARES the category via its real API field");
  });

  it("#979's neutral compliance descriptor travels to EVERY platform's payload with NO category active (regression across all 5, not just the implementor's single Meta+HOUSING case)", () => {
    const state = buildState({ specialAdCategory: "NONE", budget: { dailyCentsForChannel: 1000 } });
    for (const platform of ALL_PLATFORMS) {
      const payload = buildCreatePayload(platform, state);
      assert.equal(payload.compliance.specialAdCategory, "NONE", `${platform} payload carries the neutral NONE descriptor`);
      assert.equal(typeof payload.compliance.aiGenerated, "boolean", `${platform} payload's aiGenerated flag is boolean-typed`);
    }
  });
});

describe("ISSUE-986 ADVERSARIAL — D: degenerate select-NONE never crashes, never proceeds, never double-warns; rapid toggling is deterministic", () => {
  it("selecting NONE is honest (all deselected), splitBudget/unfundedEligibleChannels don't crash, and a deselected channel is NEVER also reported as a Bug-4 '$0-funded eligible' channel", () => {
    const rows = planChannels({ ...base, totalDailyCents: 3000 });
    const planned = applyChannelSelection({ channelRows: rows, selectedPlatforms: [] });

    assert.ok(planned.every((r) => r.eligible === false), "every candidate is ineligible once nothing is picked");
    assert.ok(planned.every((r) => r.deselected === true), "every candidate is honestly tagged deselected, never a fabricated safety-gate reason");

    let allocations;
    assert.doesNotThrow(() => {
      allocations = splitBudget({ channelRows: planned, totalDailyCents: 3000, strategy: "auto" });
    });
    assert.deepEqual(allocations, [], "no crash, no fallback funding — zero platforms picked means zero funded");

    let unfunded;
    assert.doesNotThrow(() => {
      unfunded = unfundedEligibleChannels({ channelRows: planned, allocations, totalDailyCents: 3000 });
    });
    assert.deepEqual(unfunded, [], "a deselected channel must NEVER also show up as an ISSUE-979 Bug-4 '$0-funded eligible' warning — that would be a contradictory double-warning (eligible=false already explains the $0)");

    const copyPlatforms = planned.filter((r) => r.eligible).map((r) => r.platform);
    assert.deepEqual(copyPlatforms, [], "StepCopy has nothing to build for");

    // The exact expression CampaignBuilderPage.stepValid("preflight") gates
    // Next on — proven true here, and coupled to the real source below so a
    // change to the gate expression is caught.
    const effectivePlatforms = planned.filter((r) => r.eligible).map((r) => r.platform);
    assert.equal(effectivePlatforms.length, 0, "the Next-disabling condition holds: 0 effective platforms");
  });

  it("Next cannot proceed past Channel-health with 0 effective platforms — source-coupled to the real gate", () => {
    const src = read(path.join(ADMIN_SRC, "pages/CampaignBuilderPage.jsx"));
    assert.match(src, /effectivePlatforms\.length > 0/, "the preflight stepValid gate literally requires > 0 effective platforms — the exact invariant Suite D proves at the data layer");
  });

  it("rapid toggle sequence (off/on/off/off/on across two platforms) is deterministic, duplicate-free, and matches the REAL togglePlatform reducer verbatim", () => {
    // Source-coupling: assert the real reducer body is unchanged, then run
    // MY OWN behavioral copy of that exact algorithm against it — if the two
    // ever diverge, this test (or the source assertion) fails.
    const src = read(path.join(ADMIN_SRC, "pages/CampaignBuilderPage.jsx"));
    assert.match(src, /const current = prev === null \? eligiblePlatforms : prev;/, "toggle reducer: materializes the all-eligible default on first touch");
    assert.match(src, /current\.includes\(platform\)\s*\n?\s*\?\s*current\.filter\(\(p\) => p !== platform\)\s*\n?\s*:\s*\[\.\.\.current, platform\]/, "toggle reducer: add/remove-by-filter, verbatim");

    const simulateToggle = (prev, platform, eligible) => {
      const current = prev === null ? eligible : prev;
      return current.includes(platform) ? current.filter((p) => p !== platform) : [...current, platform];
    };

    const eligiblePlatforms = [...ALL_PLATFORMS];
    const runSequence = () => {
      let state = null;
      for (const platform of ["meta", "meta", "meta", "google", "google"]) {
        state = simulateToggle(state, platform, eligiblePlatforms);
      }
      return state;
    };

    const finalA = runSequence();
    const finalB = runSequence(); // same sequence run again, independently
    assert.deepEqual([...finalA].sort(), [...finalB].sort(), "rapid toggling is deterministic — the same sequence always converges to the same state");
    assert.equal(new Set(finalA).size, finalA.length, "no duplicate platform ids after rapid toggling");
    assert.deepEqual([...finalA].sort(), ["google", "reddit", "snapchat", "tiktok"], "net effect: meta toggled off (3x = odd = off), google toggled off-then-on (2x = even = unchanged/on)");
    assert.ok(!finalA.includes("meta"), "meta is deselected after the rapid sequence");

    // Feed the post-toggle state through the real pipeline — no crash, matches.
    const rows = planChannels({ ...base, totalDailyCents: 3000 });
    const planned = applyChannelSelection({ channelRows: rows, selectedPlatforms: finalA });
    assert.deepEqual(
      planned.filter((r) => r.eligible).map((r) => r.platform).sort(),
      ["google", "reddit", "snapchat", "tiktok"],
      "the rapid-toggle end state threads cleanly into the real selection pipeline",
    );
  });
});
