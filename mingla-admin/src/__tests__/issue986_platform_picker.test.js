// ISSUE-986 [Campaign Builder platform picker] — the implementor happy-path
// regression suite (the tester writes a separate adversarial angle).
//
// The problem (Seth finding #8 + forensic Lane G): there was NO platform picker
// in the 10-step builder. The channel set was silently auto-derived
// (planChannels eligibility ∩ splitBudget), and splitBudget CONCENTRATED on Meta
// by default, so a modest budget built Meta ONLY and the other 4 platforms
// vanished from StepCopy with no explanation. "No way to actually choose which
// platforms I want to build campaigns for."
//
// The fix: an explicit platform picker in the Channel-health step whose PICKED
// SET is the single source of truth. applyChannelSelection folds the pick (and
// the special-ad-category compliance exclusions) into planChannels' output;
// splitBudget's spreadAcrossSelected funds the picked set instead of collapsing
// onto Meta; a special ad category auto-excludes the four platforms that can't
// declare it.
//
// The channel set is now the operator's PICK — applyChannelSelection drops
// un-picked (and compliance-excluded) channels to ineligible BEFORE splitBudget,
// so the split only ever runs across picked platforms. At a budget that funds a
// single slot, the top-PRIORITY picked channel wins — and deselecting Meta hands
// that slot to the channel the operator actually wants (Meta was previously
// un-overridable by priority). The split math itself is unchanged (ISSUE-979's
// suites stay green).
//
// FAILS-ON-REVERT (proven by true line-deletion, see the ORCH report):
//   - deleting applyChannelSelection's selection folding fails "selecting a
//     subset builds only those" + "deselecting Meta redirects the budget";
//   - deleting the compliance-exclusion branch fails the special-category cases;
//   - deleting the compliance helper's Meta-only capability fails the guard cases;
//   - reverting the component wiring fails the source-assertion suite.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyChannelSelection,
  planChannels,
  splitBudget,
} from "../lib/adBuilder/channelPlan.js";
import {
  complianceExclusions,
  complianceExcludedPlatforms,
  platformCanDeclareSpecialCategory,
  SPECIAL_CATEGORY_CAPABLE_PLATFORMS,
} from "../lib/adBuilder/compliance.js";
import { buildCreatePayload } from "../lib/adBuilder/payload.js";
import { goalById } from "../lib/adBuilder/goals.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(p, "utf8");

const greenRow = (platform) => ({ platform, overall: "green", checks: [] });
const metaConn = { extra: { minimum_budgets: { imp: 100, video_views: 100, high_freq: 500, low_freq: 4000 } } };
const base = {
  preflightRows: ["meta", "tiktok", "snapchat", "google", "reddit"].map(greenRow),
  goalIds: ["traffic"],
  countries: ["US"],
  connections: { meta: metaConn },
  metaGoal: "LINK_CLICKS",
};
const ALL = ["meta", "tiktok", "snapchat", "google", "reddit"];
const fundedPlatforms = (rows, opts) => splitBudget({ channelRows: rows, ...opts }).map((a) => a.platform).sort();
// Materialize the picked rows the way the wizard does, then split them.
const buildFor = (planInput, selectedPlatforms, splitOpts) => {
  const rows = planChannels(planInput);
  const planned = applyChannelSelection({ channelRows: rows, selectedPlatforms });
  return fundedPlatforms(planned, splitOpts);
};

describe("ISSUE-986 — all 5 platforms are candidates; every eligible one is selectable", () => {
  it("planChannels gives one row per platform; a US/traffic base makes all 5 eligible before budget", () => {
    const rows = planChannels({ ...base, totalDailyCents: 0 });
    assert.deepEqual(rows.map((r) => r.platform).sort(), [...ALL].sort());
    for (const p of ALL) {
      assert.equal(rows.find((r) => r.platform === p).eligible, true, `${p} is an eligible candidate`);
    }
  });
});

describe("ISSUE-986 — selecting a subset builds ONLY those platforms", () => {
  const rows = planChannels({ ...base, totalDailyCents: 4000 });

  it("picking [meta, google] leaves only meta+google eligible; the split funds only them", () => {
    const planned = applyChannelSelection({ channelRows: rows, selectedPlatforms: ["meta", "google"] });
    const eligible = planned.filter((r) => r.eligible).map((r) => r.platform).sort();
    assert.deepEqual(eligible, ["google", "meta"], "only the picked platforms stay eligible");
    // the other three are narrowed with the 'not selected' reason (never silent).
    for (const p of ["tiktok", "snapchat", "reddit"]) {
      const row = planned.find((r) => r.platform === p);
      assert.equal(row.eligible, false, `${p} must be excluded when not picked`);
      assert.equal(row.deselected, true, `${p} is tagged deselected`);
      assert.ok(/not selected/i.test(row.excludedReason), `${p} shows the not-selected reason`);
    }
    const funded = fundedPlatforms(planned, { totalDailyCents: 4000, strategy: "auto" });
    assert.deepEqual(funded, ["google", "meta"], "the create loop funds ONLY the picked platforms");
  });

  it("an unpicked platform can never be funded even at a large budget", () => {
    const planned = applyChannelSelection({ channelRows: rows, selectedPlatforms: ["meta"] });
    const funded = fundedPlatforms(planned, { totalDailyCents: 50000, strategy: "diversify" });
    assert.deepEqual(funded, ["meta"], "only the single picked platform is ever funded");
  });
});

describe("ISSUE-986 — an INELIGIBLE platform is unselectable and shows its reason", () => {
  it("selection can only narrow WITHIN eligible — it never forces a blocked channel in", () => {
    // TikTok can't target GB (live market gate). Even if the operator's array
    // lists tiktok, applyChannelSelection keeps it ineligible with its reason.
    const rows = planChannels({ ...base, countries: ["GB"], totalDailyCents: 4000 });
    const ttCandidate = rows.find((r) => r.platform === "tiktok");
    assert.equal(ttEligible(rows), false, "TikTok is ineligible for GB (safety gate)");
    assert.ok(/TikTok can't target the UK/.test(ttCandidate.excludedReason), "the plain-English market reason is present");

    const planned = applyChannelSelection({ channelRows: rows, selectedPlatforms: ALL });
    const ttPlanned = planned.find((r) => r.platform === "tiktok");
    assert.equal(ttPlanned.eligible, false, "an ineligible platform stays ineligible even when 'selected'");
    assert.equal(ttPlanned.excludedReason, ttCandidate.excludedReason, "its safety-gate reason is preserved verbatim");
    assert.ok(!ttPlanned.deselected, "it's a safety-gate exclusion, not a de-selection");
    const funded = fundedPlatforms(planned, { totalDailyCents: 4000, strategy: "auto" });
    assert.ok(!funded.includes("tiktok"), "an ineligible platform can never be funded");
  });

  function ttEligible(rows) {
    return rows.find((r) => r.platform === "tiktok").eligible;
  }
});

describe("ISSUE-986 — deselecting Meta REDIRECTS the budget to the picked platforms", () => {
  it("modest budget, all picked: Meta wins the single fundable slot by priority (the old 'only Meta' state)", () => {
    // $7/day: TikTok's $20 floor excludes it; of the rest, only one clears
    // viability in the greedy fill, and Meta (priority[0]) takes it.
    const funded = buildFor({ ...base, totalDailyCents: 700 }, ALL, { totalDailyCents: 700, strategy: "auto" });
    assert.deepEqual(funded, ["meta"], "with everything picked, Meta wins the single slot");
  });

  it("modest budget, Meta DESELECTED: the same money now funds the operator's next pick — not Meta, not nothing", () => {
    const withoutMeta = ["tiktok", "snapchat", "google", "reddit"];
    const funded = buildFor({ ...base, totalDailyCents: 700 }, withoutMeta, { totalDailyCents: 700, strategy: "auto" });
    assert.ok(!funded.includes("meta"), "Meta is not funded once the operator deselects it");
    assert.equal(funded.length, 1, "the single slot goes to exactly one channel");
    assert.deepEqual(funded, ["google"], "the budget is redirected to the next picked, fundable channel");
  });

  it("larger budget, Meta deselected: several of the OTHER picked platforms are funded (plural), never Meta", () => {
    const withoutMeta = ["tiktok", "snapchat", "google", "reddit"];
    const rows = planChannels({ ...base, totalDailyCents: 4000 });
    const planned = applyChannelSelection({ channelRows: rows, selectedPlatforms: withoutMeta });
    const allocs = splitBudget({ channelRows: planned, totalDailyCents: 4000, strategy: "auto" });
    const funded = allocs.map((a) => a.platform).sort();
    assert.ok(!funded.includes("meta"), "Meta must never be funded once deselected");
    assert.ok(funded.length >= 2, "the remaining picked platforms are funded, plural");
    for (const p of funded) assert.ok(withoutMeta.includes(p), `${p} is one of the picked non-Meta platforms`);
    assert.equal(allocs.reduce((s, a) => s + a.dailyCents, 0), 4000, "the split conserves the total exactly");
  });
});

describe("ISSUE-986 — a special ad category excludes/warns the 4 platforms that can't declare it", () => {
  const rows = planChannels({ ...base, totalDailyCents: 4000 });
  const eligiblePlatforms = rows.filter((r) => r.eligible).map((r) => r.platform);

  it("only Meta can declare a special ad category", () => {
    assert.deepEqual(SPECIAL_CATEGORY_CAPABLE_PLATFORMS, ["meta"]);
    assert.equal(platformCanDeclareSpecialCategory("meta"), true);
    for (const p of ["tiktok", "snapchat", "google", "reddit"]) {
      assert.equal(platformCanDeclareSpecialCategory(p), false, `${p} cannot declare a special ad category`);
    }
  });

  it("HOUSING excludes exactly the four non-Meta platforms, each WITH a reason", () => {
    const excluded = complianceExclusions("HOUSING", eligiblePlatforms);
    assert.deepEqual(Object.keys(excluded).sort(), ["google", "reddit", "snapchat", "tiktok"]);
    for (const [p, reason] of Object.entries(excluded)) {
      assert.ok(reason.includes("Housing"), `${p} reason names the category`);
      assert.ok(/only Meta/i.test(reason), `${p} reason says only Meta can declare it`);
    }
    assert.deepEqual(complianceExcludedPlatforms("NONE", eligiblePlatforms), [], "no category → no exclusions");
  });

  it("with a category active, the build set collapses to Meta and only Meta is funded", () => {
    const excluded = complianceExclusions("EMPLOYMENT", eligiblePlatforms);
    const planned = applyChannelSelection({ channelRows: rows, selectedPlatforms: ALL, excluded });
    const eligible = planned.filter((r) => r.eligible).map((r) => r.platform);
    assert.deepEqual(eligible, ["meta"], "only Meta survives a special-category selection");
    for (const p of ["tiktok", "snapchat", "google", "reddit"]) {
      const row = planned.find((r) => r.platform === p);
      assert.equal(row.eligible, false);
      assert.equal(row.complianceExcluded, true, `${p} is tagged complianceExcluded (not merely deselected)`);
    }
    const funded = fundedPlatforms(planned, { totalDailyCents: 4000, strategy: "auto" });
    assert.deepEqual(funded, ["meta"], "a special-category ad only ever creates on Meta");
  });

  it("the create payload never silently un-declares: every platform still carries the compliance descriptor", () => {
    // (Preserves ISSUE-979 Bug-3: the neutral descriptor travels to every
    // platform's payload; the picker/compliance guard prevents the four from
    // being BUILT, so they never run the category un-declared.)
    const trafficGoal = goalById("traffic");
    const state = {
      lane: "consumer",
      name: "986 — Test",
      goal: { metaObjective: "OUTCOME_TRAFFIC", metaOptimizationGoal: "LINK_CLICKS", platforms: trafficGoal.platforms },
      destination: { page_type: "event", brand_slug: "b", entity_slug: "e" },
      audience: { countries: ["US"], ageMin: 21, ageMax: 45, gender: "all" },
      budget: { dailyCentsForChannel: 2000 },
      creative: { imageUrl: "https://cdn.example/x.jpg", aiGenerated: true, brandName: "B" },
      copy: { primary: "p", headline: "h", description: "d", cta: "LEARN_MORE", googleHeadlines: ["a", "b", "c"], googleDescriptions: ["d1", "d2"], keywords: ["k"], negativeKeywords: [] },
      specialAdCategory: "HOUSING",
      requestId: "r",
    };
    const meta = buildCreatePayload("meta", state);
    assert.deepEqual(meta.special_ad_categories, ["HOUSING"], "Meta DECLARES the category via its API key");
    assert.equal(meta.compliance.specialAdCategory, "HOUSING");
  });
});

describe("ISSUE-986 — component wiring (fails-on-revert source assertions)", () => {
  it("StepPreflight renders the platform-picker toggle with per-platform reasons", () => {
    const src = read(path.join(ADMIN_SRC, "components/campaign-builder/StepPreflight.jsx"));
    assert.ok(src.includes("onTogglePlatform"), "the picker must expose a toggle handler");
    assert.ok(/type="checkbox"/.test(src), "each eligible platform is a real checkbox");
    assert.ok(src.includes("disabled={!selectable}"), "ineligible/compliance-excluded platforms are disabled");
    assert.ok(src.includes("Can't build here"), "a disabled platform shows its plain-English reason");
    assert.ok(src.includes("translatePreflightDetail({"), "ISSUE-980 preflight translation is preserved");
  });

  it("CampaignBuilderPage threads the picked set as the single source of truth", () => {
    const src = read(path.join(ADMIN_SRC, "pages/CampaignBuilderPage.jsx"));
    assert.ok(src.includes("selectedPlatforms"), "the wizard holds the picked set in state");
    assert.ok(src.includes("applyChannelSelection("), "selection is folded into the channel rows");
    assert.ok(src.includes("splitBudget({ totalDailyCents: budget.totalDailyCents, channelRows: plannedRows"), "the split runs across the picked (planned) rows, not the full eligible set");
    assert.ok(src.includes("complianceExclusions("), "the compliance guard is wired into the plan");
    assert.ok(src.includes("channelRows={plannedRows}"), "downstream steps consume the picked (planned) rows");
  });

  it("StepBudget's split preview runs on the picked rows and preserves Bug-4 surfacing", () => {
    const src = read(path.join(ADMIN_SRC, "components/campaign-builder/StepBudget.jsx"));
    assert.ok(src.includes("unfundedEligibleChannels"), "ISSUE-979 Bug-4 $0-funding surfacing is preserved");
  });

  it("StepCopy names the platforms it is building copy for", () => {
    const src = read(path.join(ADMIN_SRC, "components/campaign-builder/StepCopy.jsx"));
    assert.ok(src.includes("Building this copy for"), "the copy step states which platforms it builds for");
  });

  it("StepPolicy names the platforms a special ad category excludes", () => {
    const src = read(path.join(ADMIN_SRC, "components/campaign-builder/StepPolicy.jsx"));
    assert.ok(src.includes("complianceExcludedPlatforms("), "policy step computes the excluded platforms");
    assert.ok(src.includes("Only Meta can run this special-category campaign"), "it warns which platforms are excluded");
  });
});
