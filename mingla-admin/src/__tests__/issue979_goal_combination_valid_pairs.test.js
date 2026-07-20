// ISSUE-979 Bug 1 [Campaign Builder correctness] — GOAL-COMBINATION 422.
//
// The bug: CampaignBuilderPage collapsed a multi-goal selection to goalIds[0]
// for TikTok/Reddit/Snap/Google, and for Meta derived `objective` from
// goalIds[0] but `optimization_goal` from the WHOLE array — so [awareness,
// traffic] produced the INVALID Meta pair OUTCOME_AWARENESS / LINK_CLICKS
// (guaranteed 422). Click ORDER alone decided pass/fail.
//
// The fix (objectiveResolver.js): every platform's objective AND
// optimization_goal come from ONE goals.js entry (single source of truth), so
// the pair is always valid, in any click order.
//
// FAILS-ON-REVERT: (1) restoring the goalIds[0]/whole-array mixing in
// CampaignBuilderPage (the source assertion below greps for the resolver call
// and the absence of the buggy pattern); (2) breaking the resolver so a combo
// yields a pair not authored by a single goal (the validity + coherence loops).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GOALS, visibleGoals } from "../lib/adBuilder/goals.js";
import {
  resolveMetaObjective,
  resolvePlatformObjective,
  resolveGoalForPayload,
  orderGoalIdsByPriority,
} from "../lib/adBuilder/objectiveResolver.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(p, "utf8");

// The server's authoritative Meta objective→optimization_goal matrix
// (supabase/functions/_shared/adChannel.ts META_OBJECTIVE_GOAL_MATRIX) — the
// exact contract a valid create must satisfy. Mirrored here for the two
// objectives the live goal step can emit.
const VALID_META_PAIRS = {
  OUTCOME_AWARENESS: ["REACH", "IMPRESSIONS", "AD_RECALL_LIFT", "THRUPLAY", "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS"],
  OUTCOME_TRAFFIC: [
    "LINK_CLICKS", "LANDING_PAGE_VIEWS", "OFFSITE_CONVERSIONS", "IMPRESSIONS",
    "POST_ENGAGEMENT", "REACH", "CONVERSATIONS", "THRUPLAY",
    "VISIT_INSTAGRAM_PROFILE", "PROFILE_VISIT", "QUALITY_CALL", "REMINDERS_SET",
  ],
};

const PLATFORMS = ["meta", "tiktok", "snapchat", "google", "reddit"];

// Every non-empty subset of the visible goal ids, in EVERY order (proves
// order-independence — the exact axis of the original bug).
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) out.push([arr[i], ...p]);
  }
  return out;
}
function nonEmptyOrderedSubsets(ids) {
  const subsets = [];
  for (let mask = 1; mask < 1 << ids.length; mask++) {
    const subset = ids.filter((_, i) => mask & (1 << i));
    for (const perm of permutations(subset)) subsets.push(perm);
  }
  return subsets;
}

const VISIBLE_IDS = visibleGoals().map((g) => g.id);
const ALL_COMBOS = nonEmptyOrderedSubsets(VISIBLE_IDS);

describe("ISSUE-979 Bug 1 — every allowed goal combo yields a VALID Meta pair", () => {
  it("resolveMetaObjective is always a valid objective/optimization_goal pair", () => {
    for (const combo of ALL_COMBOS) {
      const { objective, optimization_goal } = resolveMetaObjective(combo);
      assert.ok(
        VALID_META_PAIRS[objective],
        `combo ${JSON.stringify(combo)} → unknown Meta objective ${objective}`,
      );
      assert.ok(
        VALID_META_PAIRS[objective].includes(optimization_goal),
        `combo ${JSON.stringify(combo)} → INVALID Meta pair ${objective} / ${optimization_goal} (would 422)`,
      );
    }
  });

  it("the exact original bug case is fixed in BOTH click orders", () => {
    // The old code: [awareness, traffic] → OUTCOME_AWARENESS / LINK_CLICKS (422).
    const a = resolveMetaObjective(["awareness", "traffic"]);
    const b = resolveMetaObjective(["traffic", "awareness"]);
    assert.deepEqual(a, { objective: "OUTCOME_TRAFFIC", optimization_goal: "LINK_CLICKS" });
    assert.deepEqual(b, a, "click order must not change the resolved Meta pair");
    // The invalid pair the bug produced must NEVER be emitted.
    for (const combo of ALL_COMBOS) {
      const { objective, optimization_goal } = resolveMetaObjective(combo);
      assert.ok(
        !(objective === "OUTCOME_AWARENESS" && optimization_goal === "LINK_CLICKS"),
        `combo ${JSON.stringify(combo)} re-emitted the guaranteed-422 pair`,
      );
    }
  });

  it("single goals resolve to their own authored pair", () => {
    assert.deepEqual(resolveMetaObjective(["traffic"]), { objective: "OUTCOME_TRAFFIC", optimization_goal: "LINK_CLICKS" });
    assert.deepEqual(resolveMetaObjective(["awareness"]), { objective: "OUTCOME_AWARENESS", optimization_goal: "REACH" });
  });
});

describe("ISSUE-979 Bug 1 — per-platform resolution is coherent (both fields from ONE goal)", () => {
  it("every platform entry equals the map of a SELECTED goal (never field-mixed)", () => {
    for (const combo of ALL_COMBOS) {
      const resolved = resolveGoalForPayload(combo);
      // The Meta pair the payload carries must equal the resolver's coherent pair.
      assert.deepEqual(
        { objective: resolved.metaObjective, optimization_goal: resolved.metaOptimizationGoal },
        resolveMetaObjective(combo),
        `combo ${JSON.stringify(combo)}: payload Meta pair must equal the coherent resolver pair`,
      );
      for (const platform of PLATFORMS) {
        const entry = platform === "meta"
          ? { objective: resolved.metaObjective, optimization_goal: resolved.metaOptimizationGoal }
          : resolved.platforms[platform] ?? resolvePlatformObjective(combo, platform);
        if (!entry) continue; // platform can't express any selected goal — dropped upstream
        // The resolved entry must be one of the SELECTED goals' authored maps.
        const authored = combo
          .map((id) => GOALS.find((g) => g.id === id)?.platforms?.[platform])
          .filter(Boolean);
        const matches = authored.some((a) => {
          if (platform === "meta") {
            return a.objective === entry.objective && a.optimization_goal === entry.optimization_goal;
          }
          return JSON.stringify(a) === JSON.stringify(entry);
        });
        assert.ok(
          matches,
          `combo ${JSON.stringify(combo)} platform ${platform}: resolved ${JSON.stringify(entry)} is not a single authored goal map`,
        );
      }
    }
  });

  it("precedence: traffic (deeper funnel) wins over awareness for the live goals", () => {
    assert.deepEqual(
      orderGoalIdsByPriority(["awareness", "traffic"]),
      ["traffic", "awareness"],
      "traffic must sort ahead of awareness regardless of click order",
    );
    // Confirmed on a real platform: TikTok picks TRAFFIC (not REACH) for the combo.
    const tiktok = resolvePlatformObjective(["awareness", "traffic"], "tiktok");
    assert.equal(tiktok.objective, "TRAFFIC");
  });

  it("disjoint case: a platform that can't do the top goal falls back to a goal it CAN do", () => {
    // google can do traffic but NOT awareness → an awareness-only selection
    // has no google entry (dropped), and a traffic selection resolves google.
    assert.equal(resolvePlatformObjective(["awareness"], "google"), null);
    assert.ok(resolvePlatformObjective(["traffic"], "google"));
  });
});

describe("ISSUE-979 Bug 1 — call site wired to the coherent resolver (fails-on-revert)", () => {
  const page = read(path.join(ADMIN_SRC, "pages/CampaignBuilderPage.jsx"));

  it("CampaignBuilderPage resolves the goal coherently and drops the buggy mixing", () => {
    assert.ok(page.includes("resolveGoalForPayload"), "runCreate must build the goal via the coherent resolver");
    assert.ok(page.includes("resolveMetaObjective"), "the Meta budget-floor goal must come from the resolver too");
    assert.ok(!page.includes("goalById(goalIds[0])"), "the goalIds[0] collapse must be gone (the 422 bug)");
    // The old mixing derived metaOptimizationGoal from a separate whole-array
    // `metaGoal` string literal while metaObjective came from goalIds[0].
    assert.ok(
      !/goalIds\.includes\("awareness"\)[\s\S]{0,60}"REACH"/.test(page),
      "the whole-array REACH/LINK_CLICKS mixing must be gone",
    );
  });
});
