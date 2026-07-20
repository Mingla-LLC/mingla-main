// ISSUE-979 [campaign-builder-correctness] — TESTER ADVERSARIAL regression.
//
// A DIFFERENT ANGLE than the four implementor happy-path suites. Where the
// implementor validated Bug 1 against a HARDCODED mirror of the Meta matrix and
// exercised the resolver in isolation, this suite:
//
//   Bug 1 — parses the REAL META_OBJECTIVE_GOAL_MATRIX out of the deployed edge
//           function (_shared/adChannel.ts) and validates the pair END-TO-END
//           through buildCreatePayload (resolver → payload → server contract),
//           then attacks the inputs the implementor never fed the resolver:
//           empty / duplicate / unknown / hidden-goal ids, and the crucial
//           HIGHEST-PRIORITY-BUT-UNSUPPORTED fall-through (conversions is ranked
//           first but has zero platform maps — every platform must fall THROUGH
//           it to a goal it can actually express, never emit null-where-a-lower-
//           goal-works and never a 422 pair).
//   Bug 2 — classifies a MIXED batch (Meta created + TikTok validated:false +
//           Snap error-shaped) and proves the aggregate never collapses to a
//           blanket "Created": exactly one created toast fires, and NO campaign-
//           less response is ever labelled created (fuzzed).
//   Bug 3 — a COMBINATORIAL sweep of (aiGenerated × specialAdCategory incl. the
//           empty-string footgun) proving the flag is never silently lost on ANY
//           of the five payloads, Meta still applies its API-shaped keys, and the
//           server's documentComplianceDrop guard is a logical AND (warns whenever
//           EITHER flag is set) — not the implementor's "the call exists" grep.
//   Bug 4 — a PARTITION-COMPLETENESS invariant over a budget × strategy sweep:
//           every eligible channel is EITHER funded OR reported-with-a-reason,
//           never both and never NEITHER (a "neither" channel is the exact silent
//           $0 the bug was). The implementor never asserted the partition closes.
//
// FAILS-ON-REVERT: reverting the objectiveResolver ordering re-reddens the
// fall-through + matrix loops (Bug 1); deleting classifyCreateResult's created
// branch drops the mixed-batch created count (Bug 2); dropping `compliance,` from
// any payload branch reddens the sweep (Bug 3); neutering unfundedEligibleChannels
// breaks the partition (Bug 4). Verified by true line-deletion — hashes in the QA
// report.

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
import { buildCreatePayload } from "../lib/adBuilder/payload.js";
import { classifyCreateResult } from "../lib/adBuilder/createResult.js";
import { planChannels, splitBudget, unfundedEligibleChannels } from "../lib/adBuilder/channelPlan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ADMIN_SRC, "../..");
const read = (p) => fs.readFileSync(p, "utf8");

// ── Parse the ACTUAL server matrix (never a hand-copied mirror). If the real
//    contract in adChannel.ts drifts, this test moves with it. ────────────────
function parseMetaMatrix(src) {
  const start = src.indexOf("META_OBJECTIVE_GOAL_MATRIX");
  const braceStart = src.indexOf("{", start);
  let depth = 0, end = -1;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) { end = i; break; }
  }
  const block = src.slice(braceStart, end + 1);
  const matrix = {};
  const re = /(OUTCOME_[A-Z_]+)\s*:\s*\[([\s\S]*?)\]/g;
  let m;
  while ((m = re.exec(block))) {
    matrix[m[1]] = [...m[2].matchAll(/"([A-Z_]+)"/g)].map((g) => g[1]);
  }
  return matrix;
}

const REAL_META_MATRIX = parseMetaMatrix(
  read(path.join(REPO_ROOT, "supabase/functions/_shared/adChannel.ts")),
);

// A full wizard state so we can build the ACTUAL Meta payload end-to-end.
const stateWithGoal = (goal, { aiGenerated = false, specialAdCategory = "NONE" } = {}) => ({
  lane: "consumer",
  name: "979-adv — Velvet Lounge — Friday Live",
  goal,
  destination: { page_type: "event", brand_slug: "velvet-lounge", entity_slug: "friday-live" },
  audience: { countries: ["US"], ageMin: 21, ageMax: 45, gender: "all" },
  budget: { dailyCentsForChannel: 2000 },
  creative: { imageUrl: "https://cdn.example/c.jpg", aiGenerated, brandName: "Velvet Lounge" },
  copy: {
    primary: "Friday Live", headline: "Friday Live", description: "Come through.", cta: "LEARN_MORE",
    googleHeadlines: ["Friday Live", "Velvet Lounge", "Live Music"], googleDescriptions: ["Live music.", "Book now."],
    keywords: ["velvet lounge"], negativeKeywords: [],
  },
  specialAdCategory,
  requestId: "req-979-adv",
});

// Every non-empty ordered subset of visible goal ids (order is the bug's axis).
const perms = (a) => a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
function orderedSubsets(ids) {
  const out = [];
  for (let mask = 1; mask < 1 << ids.length; mask++) {
    const s = ids.filter((_, i) => mask & (1 << i));
    for (const p of perms(s)) out.push(p);
  }
  return out;
}
const VISIBLE_IDS = visibleGoals().map((g) => g.id);
const UI_COMBOS = orderedSubsets(VISIBLE_IDS);

// ─────────────────────────────────────────────────────────────────────────────
describe("ISSUE-979 Bug 1 ADV — the REAL server matrix validates the END-TO-END Meta pair", () => {
  it("the parser actually recovered the server contract (guard against a silent empty parse)", () => {
    assert.ok(REAL_META_MATRIX.OUTCOME_TRAFFIC?.includes("LINK_CLICKS"), "parsed OUTCOME_TRAFFIC → LINK_CLICKS");
    assert.ok(REAL_META_MATRIX.OUTCOME_AWARENESS?.includes("REACH"), "parsed OUTCOME_AWARENESS → REACH");
    assert.ok(Object.keys(REAL_META_MATRIX).length >= 2, "matrix is non-trivial");
  });

  it("every UI combo & ordering → a Meta payload whose pair is valid against the DEPLOYED matrix", () => {
    for (const combo of UI_COMBOS) {
      const resolved = resolveGoalForPayload(combo);
      const meta = buildCreatePayload("meta", stateWithGoal(resolved)); // the REAL body the edge fn receives
      const goals = REAL_META_MATRIX[meta.objective];
      assert.ok(goals, `combo ${JSON.stringify(combo)} → objective ${meta.objective} absent from the server matrix (422)`);
      assert.ok(
        goals.includes(meta.optimization_goal),
        `combo ${JSON.stringify(combo)} → ${meta.objective}/${meta.optimization_goal} is NOT a valid server pair (422)`,
      );
      // The specific guaranteed-422 pair the bug produced must never reappear.
      assert.ok(!(meta.objective === "OUTCOME_AWARENESS" && meta.optimization_goal === "LINK_CLICKS"),
        `combo ${JSON.stringify(combo)} re-emitted the guaranteed-422 pair`);
    }
  });
});

describe("ISSUE-979 Bug 1 ADV — degenerate & hidden inputs the implementor never fed the resolver", () => {
  it("empty / null / undefined / unknown / duplicate selections still yield a VALID Meta pair", () => {
    const inputs = [[], null, undefined, ["nope"], ["traffic", "traffic"], ["awareness", "awareness"], ["", "traffic"]];
    for (const input of inputs) {
      const { objective, optimization_goal } = resolveMetaObjective(input);
      const goals = REAL_META_MATRIX[objective];
      assert.ok(goals && goals.includes(optimization_goal),
        `input ${JSON.stringify(input)} → invalid Meta pair ${objective}/${optimization_goal}`);
    }
  });

  it("HIGHEST-PRIORITY-BUT-UNSUPPORTED goal falls THROUGH to a goal the platform can express", () => {
    // conversions is ranked #1 (GOAL_PRIORITY) but ships with #865 → zero platform
    // maps today. A selection led by it must not strand a platform on null when a
    // lower-priority selected goal IS expressible.
    assert.equal(orderGoalIdsByPriority(["awareness", "conversions", "traffic"])[0], "conversions",
      "conversions must sort first even though it is unsupported today");

    const metaEntry = resolvePlatformObjective(["conversions", "traffic"], "meta");
    assert.deepEqual(metaEntry, { objective: "OUTCOME_TRAFFIC", optimization_goal: "LINK_CLICKS" },
      "meta must fall through unsupported conversions to the valid traffic pair");

    const metaAware = resolvePlatformObjective(["conversions", "awareness"], "meta");
    assert.deepEqual(metaAware, { objective: "OUTCOME_AWARENESS", optimization_goal: "REACH" },
      "meta must fall through conversions to the valid awareness pair");

    // A platform that can express NEITHER selected goal is dropped (null), never a mix.
    assert.equal(resolvePlatformObjective(["conversions", "awareness"], "google"), null,
      "google can do neither conversions nor awareness → dropped, not fabricated");

    // resolveMetaObjective never emits an entry authored for a DIFFERENT platform.
    const { objective, optimization_goal } = resolveMetaObjective(["conversions", "traffic"]);
    assert.equal(objective, "OUTCOME_TRAFFIC");
    assert.equal(optimization_goal, "LINK_CLICKS");
  });

  it("every resolved platform entry is byte-identical to a SELECTED goal's authored map (no field-mixing)", () => {
    for (const combo of UI_COMBOS) {
      const resolved = resolveGoalForPayload(combo);
      for (const [platform, entry] of Object.entries(resolved.platforms)) {
        const authored = combo.map((id) => GOALS.find((g) => g.id === id)?.platforms?.[platform]).filter(Boolean);
        assert.ok(authored.some((a) => JSON.stringify(a) === JSON.stringify(entry)),
          `combo ${JSON.stringify(combo)} ${platform}: ${JSON.stringify(entry)} is a field-mix, not one authored map`);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("ISSUE-979 Bug 2 ADV — a MIXED batch never collapses to a blanket 'Created'", () => {
  const classifyBatch = (batch) => batch.map((b) => ({ platform: b.platform, res: classifyCreateResult(b.data) }));
  const createdCount = (rows) => rows.filter((r) => r.res.showCreatedToast).length;

  it("Meta created + TikTok validated:false + Snap error-shaped → exactly ONE created, others honest", () => {
    const rows = classifyBatch([
      { platform: "meta", data: { campaign: { id: "camp_meta" } } },
      { platform: "tiktok", data: { validated: false, skipped_layers: [{ layer: "campaign" }], detail: "tiktok_no_validate_only" } },
      { platform: "snapchat", data: null }, // the create returned no object (error-shaped success body)
    ]);
    assert.equal(createdCount(rows), 1, "only the genuinely-created Meta channel may show a created toast");
    const byPlatform = Object.fromEntries(rows.map((r) => [r.platform, r.res]));
    assert.equal(byPlatform.meta.outcome, "created");
    assert.equal(byPlatform.tiktok.outcome, "novalidate");
    assert.equal(byPlatform.tiktok.showCreatedToast, false);
    assert.equal(byPlatform.snapchat.outcome, "novalidate");
    assert.equal(byPlatform.snapchat.showCreatedToast, false);
  });

  it("all-validated:false batch → ZERO created toasts", () => {
    const rows = classifyBatch(["tiktok", "snapchat", "reddit"].map((p) => ({
      platform: p, data: { validated: false, skipped_layers: [{ layer: "ad_set" }], detail: `${p}_no_validate_only` },
    })));
    assert.equal(createdCount(rows), 0, "a batch where nothing was created must show no created toast at all");
    for (const r of rows) assert.equal(r.res.outcome, "novalidate");
  });

  it("all-error batch (no campaign object anywhere) → ZERO created toasts", () => {
    const rows = classifyBatch([{ platform: "meta", data: {} }, { platform: "google", data: null }, { platform: "reddit", data: undefined }]);
    assert.equal(createdCount(rows), 0);
  });

  it("FUZZ: no validated:false / campaign-less shape is EVER labelled created", () => {
    const shapes = [
      { validated: false }, { validated: false, skipped_layers: [] }, { validated: false, campaign: null },
      { skipped_layers: [{ layer: "campaign" }] }, { detail: "x" }, {}, { validated: 0 }, { validated: "true" },
      { validated: false, validated_layers: ["campaign"] }, // false wins even if layers present
    ];
    for (const data of shapes) {
      const r = classifyCreateResult(data);
      assert.equal(r.showCreatedToast, false, `${JSON.stringify(data)} must not fire a created toast`);
      assert.notEqual(r.outcome, "created", `${JSON.stringify(data)} must not be 'created'`);
    }
    // and the ONE true-create shape still is created (asymmetry proof).
    assert.equal(classifyCreateResult({ campaign: { id: "c" } }).showCreatedToast, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("ISSUE-979 Bug 3 ADV — a compliance selection is NEVER silently lost, on any of the five", () => {
  const PLATFORMS = ["meta", "tiktok", "snapchat", "google", "reddit"];
  const CATS = ["NONE", "HOUSING", "EMPLOYMENT", "CREDIT", ""]; // "" is the normalization footgun
  const trafficGoal = resolveGoalForPayload(["traffic"]);

  it("combinatorial (aiGenerated × specialAdCategory): the neutral descriptor carries every value to all 5", () => {
    for (const aiGenerated of [true, false]) {
      for (const specialAdCategory of CATS) {
        const norm = specialAdCategory && specialAdCategory !== "" ? specialAdCategory : "NONE";
        for (const platform of PLATFORMS) {
          const p = buildCreatePayload(platform, stateWithGoal(trafficGoal, { aiGenerated, specialAdCategory }));
          assert.ok(p.compliance, `${platform} dropped the compliance descriptor (ai=${aiGenerated}, cat=${specialAdCategory})`);
          assert.equal(p.compliance.aiGenerated, aiGenerated, `${platform} lost aiGenerated`);
          assert.equal(p.compliance.specialAdCategory, norm, `${platform} lost/mis-normalized specialAdCategory ("${specialAdCategory}"→${norm})`);
        }
      }
    }
  });

  it("Meta still APPLIES its API-shaped keys and never over/under-applies the category", () => {
    for (const specialAdCategory of CATS) {
      const norm = specialAdCategory && specialAdCategory !== "" ? specialAdCategory : "NONE";
      const meta = buildCreatePayload("meta", stateWithGoal(trafficGoal, { aiGenerated: true, specialAdCategory }));
      assert.deepEqual(meta.special_ad_categories, norm === "NONE" ? [] : [norm], `meta special_ad_categories for "${specialAdCategory}"`);
      assert.equal(meta.creative.ai_generated, true, "meta must still set creative.ai_generated (self_ai_disclosure)");
      // special_ad_category_country present only when a real category is set.
      assert.equal("special_ad_category_country" in meta, norm !== "NONE");
    }
  });

  it("the other four never smuggle Meta's snake_case keys (issue927 invariant unbroken)", () => {
    const state = stateWithGoal(trafficGoal, { aiGenerated: true, specialAdCategory: "HOUSING" });
    for (const platform of ["tiktok", "snapchat", "reddit", "google"]) {
      const flat = JSON.stringify(buildCreatePayload(platform, state));
      assert.ok(!flat.includes('"special_ad_categories"'), `${platform} leaked special_ad_categories`);
      assert.ok(!flat.includes('"ai_generated"'), `${platform} leaked ai_generated`);
    }
  });

  it("the SERVER documents (never silences) the drop whenever EITHER flag is set — guard is a logical AND", () => {
    const backend = read(path.join(REPO_ROOT, "supabase/functions/admin-ad-create-campaign/index.ts"));
    // The early-return that makes it a no-op must trigger ONLY on NONE && !aiGenerated
    // (i.e. nothing set). An OR here would silence a real selection — the exact leak.
    const guard = /if\s*\(\s*specialCategory\s*===\s*"NONE"\s*&&\s*!aiGenerated\s*\)\s*return\s*;/;
    assert.ok(guard.test(backend), "documentComplianceDrop must no-op ONLY when NOTHING is set (AND, not OR)");
    assert.ok(!/if\s*\(\s*specialCategory\s*===\s*"NONE"\s*\|\|\s*!aiGenerated\s*\)\s*return/.test(backend),
      "an OR guard would silently drop a set flag — forbidden");
    assert.ok(/console\.warn\(/.test(backend.slice(backend.indexOf("function documentComplianceDrop"))),
      "a set-but-unsupported flag must be warned, not swallowed");
    for (const platform of ["google", "snapchat", "tiktok", "reddit"]) {
      assert.ok(backend.includes(`documentComplianceDrop("${platform}"`), `${platform} branch must call the documenter`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("ISSUE-979 Bug 4 ADV — eligible channels PARTITION into funded ∪ reported (never a silent $0)", () => {
  const greenRow = (p) => ({ platform: p, overall: "green", checks: [] });
  const metaConn = { extra: { minimum_budgets: { imp: 100, video_views: 100, high_freq: 500, low_freq: 4000 } } };
  const base = {
    preflightRows: ["meta", "tiktok", "snapchat", "google", "reddit"].map(greenRow),
    goalIds: ["traffic"], countries: ["US"], connections: { meta: metaConn }, metaGoal: "LINK_CLICKS",
  };
  const set = (arr) => [...new Set(arr)].sort();

  it("across every budget × strategy, no eligible channel is left BOTH unfunded AND unreported", () => {
    for (const totalDailyCents of [500, 700, 1500, 2000, 5000, 20000, 50000]) {
      for (const strategy of ["auto", "concentrate", "diversify"]) {
        const rows = planChannels({ ...base, totalDailyCents });
        const allocations = splitBudget({ totalDailyCents, channelRows: rows, strategy });
        const unfunded = unfundedEligibleChannels({ channelRows: rows, allocations, totalDailyCents, strategy });

        const E = set(rows.filter((r) => r.eligible).map((r) => r.platform));
        const F = set(allocations.map((a) => a.platform));
        const U = set(unfunded.map((u) => u.platform));
        const label = `budget=${totalDailyCents} strategy=${strategy}`;

        // splitBudget only ever funds eligible channels, and only >$0.
        for (const a of allocations) assert.ok(a.dailyCents > 0, `${label}: funded ${a.platform} at $0`);
        assert.ok(F.every((p) => E.includes(p)), `${label}: funded a non-eligible channel`);
        // reported channels are eligible, and disjoint from funded.
        assert.ok(U.every((p) => E.includes(p)), `${label}: reported a non-eligible channel`);
        assert.ok(U.every((p) => !F.includes(p)), `${label}: a channel is both funded AND reported`);
        // THE INVARIANT: funded ∪ reported === eligible (no silent $0 orphan).
        assert.deepEqual(set([...F, ...U]), E, `${label}: an eligible channel is silently $0 (neither funded nor reported)`);
      }
    }
  });

  it("each reported channel carries a real, human reason ($0/day + its own name)", () => {
    const rows = planChannels({ ...base, totalDailyCents: 700 });
    const allocations = splitBudget({ totalDailyCents: 700, channelRows: rows, strategy: "auto" });
    const unfunded = unfundedEligibleChannels({ channelRows: rows, allocations, totalDailyCents: 700, strategy: "auto" });
    assert.ok(unfunded.length >= 1, "the $7/day auto case must strand at least one eligible channel");
    for (const u of unfunded) {
      assert.ok(u.reason && u.reason.length > 20, `${u.platform} reason is empty/stub`);
      assert.ok(u.reason.includes("$0/day"), `${u.platform} reason must name the $0/day outcome`);
      assert.ok(u.reason.includes(u.label), `${u.platform} reason must name the channel`);
    }
  });
});
