// ISSUE-980 [Campaign Builder clarity] finding #3 — StepReview used to
// render the SAME goal-label string on every channel row (launchSummary.js
// built one `goalLabels` string and copied it onto every funded channel),
// even though the Goal step's "Advanced" copy promises: "Exact platform
// objectives are derived per goal and shown on Review" (StepGoal.jsx). That
// promise was false (ISSUE-977 Lane B F-5) — Review never showed a resolved
// objective, real or otherwise.
//
// The fix: buildLaunchSummary now takes the SAME resolveGoalForPayload()
// result runCreate() uses to build the actual create payload (ISSUE-979's
// objectiveResolver) and renders each channel's REAL resolved objective via
// formatResolvedObjective — never a value borrowed from another platform,
// never blank.
//
// FAILS-ON-REVERT: reverting launchSummary.js's objectiveLabel computation
// back to the shared `goalLabels` string collapses every platform's
// objectiveLabel to the SAME value — the "differing per platform" assertion
// below fails. Reverting StepReview.jsx's render back to `line.goalLabel`
// fails the source-grep wiring test.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildLaunchSummary } from "../lib/adBuilder/launchSummary.js";
import { resolveGoalForPayload, formatResolvedObjective } from "../lib/adBuilder/objectiveResolver.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(p, "utf8");

describe("ISSUE-980 finding #3 — Review shows the REAL, per-platform resolved objective", () => {
  it("a multi-platform funded plan shows DIFFERENT objective strings per channel, not one blanket label", () => {
    const resolvedGoal = resolveGoalForPayload(["traffic"]); // the REAL resolver, not a hand mirror
    const summary = buildLaunchSummary({
      channelRows: [
        { platform: "meta", label: "Meta", eligible: true, amber: null },
        { platform: "tiktok", label: "TikTok", eligible: true, amber: null },
        { platform: "google", label: "Google", eligible: true, amber: null },
        { platform: "reddit", label: "Reddit", eligible: true, amber: null },
      ],
      allocations: [
        { platform: "meta", dailyCents: 2000 },
        { platform: "tiktok", dailyCents: 2000 },
        { platform: "google", dailyCents: 2000 },
        { platform: "reddit", dailyCents: 2000 },
      ],
      resolvedGoal,
      totalDailyCents: 8000,
    });

    const byPlatform = Object.fromEntries(summary.channels.map((c) => [c.platform, c.objectiveLabel]));
    assert.equal(byPlatform.meta, "OUTCOME_TRAFFIC · LINK_CLICKS");
    assert.equal(byPlatform.tiktok, "TRAFFIC");
    assert.equal(byPlatform.google, "SEARCH · maximize_clicks");
    assert.equal(byPlatform.reddit, "CLICKS");

    // The core of finding #3: NOT every row shows the same string.
    const distinctLabels = new Set(Object.values(byPlatform));
    assert.ok(distinctLabels.size > 1, `expected differing per-platform objectives, got all identical: ${JSON.stringify(byPlatform)}`);
  });

  it("Meta's objective/optimization_goal pair on Review is byte-identical to what runCreate actually sends", () => {
    // resolveGoalForPayload is the SAME function CampaignBuilderPage.jsx's
    // runCreate calls to build the real Meta create payload (goal.metaObjective
    // / goal.metaOptimizationGoal) — Review must show that exact pair, never a
    // separately-derived one.
    for (const goalIds of [["traffic"], ["awareness"], ["awareness", "traffic"], ["traffic", "awareness"]]) {
      const resolvedGoal = resolveGoalForPayload(goalIds);
      const summary = buildLaunchSummary({
        channelRows: [{ platform: "meta", label: "Meta", eligible: true, amber: null }],
        allocations: [{ platform: "meta", dailyCents: 2000 }],
        resolvedGoal,
        totalDailyCents: 2000,
      });
      const expected = `${resolvedGoal.metaObjective} · ${resolvedGoal.metaOptimizationGoal}`;
      assert.equal(summary.channels[0].objectiveLabel, expected, `goalIds=${JSON.stringify(goalIds)}`);
    }
  });

  it("a genuinely unresolved platform shows an HONEST value, never a fabricated or borrowed one", () => {
    // Google has no `awareness` mapping at all (goals.js) — if it were ever
    // funded on an awareness-only plan, it must NOT silently inherit another
    // platform's objective or render blank.
    const resolvedGoal = resolveGoalForPayload(["awareness"]);
    assert.equal(resolvedGoal.platforms.google, undefined, "sanity: google truly has no awareness mapping");
    const label = formatResolvedObjective("google", resolvedGoal.platforms.google ?? null);
    assert.ok(label.length > 0, "must never render blank");
    assert.ok(!/OUTCOME_|REACH|IMPRESSIONS/.test(label), "must not borrow another platform's resolved value");
    assert.match(label, /no objective resolved/i);
  });

  it("with no resolvedGoal supplied at all (defensive default), every row still gets an honest, non-crashing label", () => {
    const summary = buildLaunchSummary({
      channelRows: [{ platform: "meta", label: "Meta", eligible: true, amber: null }],
      allocations: [{ platform: "meta", dailyCents: 2000 }],
      totalDailyCents: 2000,
    });
    assert.equal(summary.channels.length, 1);
    assert.ok(summary.channels[0].objectiveLabel.length > 0);
  });
});

describe("ISSUE-980 finding #3 — wiring is real, not just a lib function nobody calls (fails-on-revert)", () => {
  const launchSummary = read(path.join(ADMIN_SRC, "lib/adBuilder/launchSummary.js"));
  const review = read(path.join(ADMIN_SRC, "components/campaign-builder/StepReview.jsx"));
  const page = read(path.join(ADMIN_SRC, "pages/CampaignBuilderPage.jsx"));

  it("launchSummary.js computes objectiveLabel via formatResolvedObjective, not a shared goalLabels string", () => {
    assert.ok(launchSummary.includes("formatResolvedObjective"), "must import/use the resolver's formatter");
    assert.ok(launchSummary.includes("objectiveLabel:"), "channel rows must carry objectiveLabel");
    assert.ok(!launchSummary.includes("goalLabel:"), "the old blanket goalLabel field must be gone");
  });

  it("StepReview.jsx renders line.objectiveLabel, not the retired line.goalLabel", () => {
    assert.ok(review.includes("{line.objectiveLabel}"), "Review must render the resolved objective");
    assert.ok(!review.includes("{line.goalLabel}"), "the old blanket field must not be read anymore");
  });

  it("CampaignBuilderPage.jsx resolves the goal for display and threads it into buildLaunchSummary", () => {
    // Distinct from runCreate's own (pre-existing, untouched) resolveGoalForPayload
    // call — this is the NEW display-only memo this fix adds.
    assert.ok(
      page.includes("const resolvedGoalForDisplay = useMemo(() => resolveGoalForPayload(goalIds), [goalIds]);"),
      "must compute a dedicated display resolution, separate from runCreate's",
    );
    assert.ok(page.includes("resolvedGoal: resolvedGoalForDisplay"), "must pass the resolution into buildLaunchSummary");
  });
});
