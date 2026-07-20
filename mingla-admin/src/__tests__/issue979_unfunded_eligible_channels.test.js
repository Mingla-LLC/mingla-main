// ISSUE-979 Bug 4 [Campaign Builder correctness] — SILENT $0-FUNDING.
//
// The bug: splitBudget can fund only the priority channel and drop other
// ELIGIBLE channels to $0 (the total can't jointly fund them, or Concentrate
// puts everything on the top channel). The operator saw a green, eligible
// channel, wrote copy for it, and it was never created — with NO on-screen
// reason and Next still enabled.
//
// The fix (channelPlan.unfundedEligibleChannels + StepBudget warning): surface
// every eligible-but-$0 channel WITH an explicit reason so the budget step
// warns instead of silently proceeding.
//
// FAILS-ON-REVERT: neutering unfundedEligibleChannels (e.g. deleting the filter
// predicate) empties the result and fails the scenario tests; the source
// assertion greps StepBudget for the import + render of the warning.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { planChannels, splitBudget, unfundedEligibleChannels } from "../lib/adBuilder/channelPlan.js";

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

describe("ISSUE-979 Bug 4 — eligible-but-$0 channels are surfaced with a reason", () => {
  it("a small total funds only Meta; the other eligible channels are reported, not silent", () => {
    // $7/day: TikTok ($20 floor) is EXCLUDED by planChannels; meta/snap/google/
    // reddit are eligible, but auto can only fund Meta → the rest get $0.
    const rows = planChannels({ ...base, totalDailyCents: 700 });
    const allocations = splitBudget({ totalDailyCents: 700, channelRows: rows, strategy: "auto" });
    assert.equal(allocations.length, 1);
    assert.equal(allocations[0].platform, "meta");

    const unfunded = unfundedEligibleChannels({ channelRows: rows, allocations, totalDailyCents: 700, strategy: "auto" });
    const platforms = unfunded.map((u) => u.platform).sort();
    assert.deepEqual(platforms, ["google", "reddit", "snapchat"], "every eligible-but-$0 channel is reported");
    for (const u of unfunded) {
      assert.ok(u.reason.includes("$0/day"), `${u.platform} reason must state it gets $0/day`);
      assert.ok(u.reason.includes(u.label), `${u.platform} reason names the channel`);
    }
  });

  it("Concentrate reports every non-top eligible channel with the Concentrate reason", () => {
    const rows = planChannels({ ...base, totalDailyCents: 2000 });
    const allocations = splitBudget({ totalDailyCents: 2000, channelRows: rows, strategy: "concentrate" });
    assert.equal(allocations.length, 1, "concentrate funds one channel");
    const unfunded = unfundedEligibleChannels({ channelRows: rows, allocations, totalDailyCents: 2000, strategy: "concentrate" });
    assert.ok(unfunded.length >= 1, "the other eligible channels must be reported, not silently $0");
    for (const u of unfunded) {
      assert.ok(/Concentrate/i.test(u.reason), `${u.platform} reason explains Concentrate`);
      assert.ok(u.reason.includes("$0/day"));
    }
  });

  it("nothing is reported when every eligible channel is funded", () => {
    const rows = planChannels({ ...base, totalDailyCents: 20000 });
    const allocations = splitBudget({ totalDailyCents: 20000, channelRows: rows, strategy: "diversify" });
    const fundedSet = new Set(allocations.map((a) => a.platform));
    const eligible = rows.filter((r) => r.eligible).map((r) => r.platform);
    // Diversify at a large budget funds all eligible channels → no $0 orphans.
    if (eligible.every((p) => fundedSet.has(p))) {
      assert.deepEqual(unfundedEligibleChannels({ channelRows: rows, allocations, totalDailyCents: 20000, strategy: "diversify" }), []);
    }
  });

  it("no budget entered → nothing reported (guard)", () => {
    const rows = planChannels({ ...base, totalDailyCents: 0 });
    assert.deepEqual(unfundedEligibleChannels({ channelRows: rows, allocations: [], totalDailyCents: 0, strategy: "auto" }), []);
  });
});

describe("ISSUE-979 Bug 4 — the budget step renders the warning (fails-on-revert)", () => {
  const step = read(path.join(ADMIN_SRC, "components/campaign-builder/StepBudget.jsx"));

  it("StepBudget imports and renders unfundedEligibleChannels", () => {
    assert.ok(step.includes("unfundedEligibleChannels"), "StepBudget must compute the eligible-but-$0 set");
    assert.ok(step.includes("$0/day"), "the warning must name the $0/day outcome on screen");
    assert.ok(/unfunded\.map/.test(step), "each eligible-but-$0 channel must render its reason");
  });
});
