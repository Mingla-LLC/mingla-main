// #2300 — implementor happy path.
//
// Proves the reap gate CLEARS artifacts that are genuinely dead, and that
// reap.sh no longer rejects a squash-merged branch (the defect that made the
// documented close path always fail and produced the 63 GB worktree pile-up).
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { addWorktree, evalLib, makeBins, makeWorld, reapPath, runScript, sweepPath } from "./harness.mjs";

// Far-future clock so a just-created fixture reads as idle.
const FUTURE = String(Math.floor(Date.UTC(2030, 0, 1) / 1000));

test("H1: closed issue + merged PR + clean tree + idle => reapable", async () => {
  const w = await makeWorld("h1");
  const wt = await addWorktree(w, "2272-web-dead-paths", "2272-web-dead-paths", "squashed");
  const bin = await makeBins(w.root, {
    issues: { 2272: "CLOSED" },
    prs: { "2272-web-dead-paths": "MERGED" },
  });
  const r = evalLib(`orch_worktree_reapable "${wt}"`, { bin, env: { ORCH_NOW_EPOCH: FUTURE } });
  assert.equal(r.stdout.trim(), "reapable");
  assert.equal(r.status, 0);
});

test("H2: a Shutdown simulator for a closed issue is reapable", async () => {
  const w = await makeWorld("h2");
  const bin = await makeBins(w.root, {
    issues: { 2180: "CLOSED" },
    sims: [{ name: "ISSUE2180-iPhoneSE3", state: "Shutdown" }],
  });
  const r = evalLib(`orch_sim_reapable ISSUE2180-iPhoneSE3`, { bin });
  assert.equal(r.stdout.trim(), "reapable");
});

test("H3: a non-running AVD for a closed issue is reapable", async () => {
  const w = await makeWorld("h3");
  const bin = await makeBins(w.root, { issues: { 2180: "CLOSED" }, avds: ["ISSUE1999-Pixel"] });
  const r = evalLib(`orch_avd_reapable ISSUE2180-Pixel`, { bin });
  assert.equal(r.stdout.trim(), "reapable");
});

// THE REGRESSION TEST. Reverting the Safety-2 fix in reap.sh makes this fail:
// the old `rev-list --count origin/main..$BRANCH` gate reports 1 for this
// branch and exits 1 with "is 1 commit(s) ahead of origin/main".
test("H4: reap.sh REAPS a squash-merged branch without --force", async () => {
  const w = await makeWorld("h4");
  const wt = await addWorktree(w, "2272-web-dead-paths", "2272-web-dead-paths", "squashed");
  const bin = await makeBins(w.root, {
    issues: { 2272: "CLOSED" },
    prs: { "2272-web-dead-paths": "MERGED" },
  });

  // Precondition, asserted not assumed: this branch DOES read as ahead of
  // origin/main. If it ever stops reading as ahead, this test has stopped
  // exercising the squash-merge case and must be rewritten, not relaxed.
  const ahead = spawnSync("git", ["-C", wt, "rev-list", "--count", "origin/main..2272-web-dead-paths"], {
    encoding: "utf8",
  });
  assert.equal(ahead.stdout.trim(), "1", "fixture must reproduce the squash-merge shape");

  const r = runScript(reapPath, [wt], { bin, env: { ORCH_ANCHOR: w.anchor } });
  assert.equal(
    r.status,
    0,
    `reap.sh must accept a merged branch. stdout:\n${r.stdout}\nstderr:\n${r.stderr}`,
  );
  assert.match(r.stdout, /WORKTREE REAPED/);
  assert.equal(existsSync(wt), false, "worktree directory must be gone");
});

test("H5: sweep.sh dry run prints a plan and reports the counts", async () => {
  const w = await makeWorld("h5");
  const wt = await addWorktree(w, "2272-web-dead-paths", "2272-web-dead-paths", "squashed");
  const bin = await makeBins(w.root, {
    issues: { 2272: "CLOSED" },
    prs: { "2272-web-dead-paths": "MERGED" },
  });
  const r = runScript(sweepPath, [], {
    bin,
    env: {
      ORCH_ANCHOR: w.anchor,
      ORCH_DIR: join(w.root, "orchs"),
      ORCH_AVD_DIR: join(w.root, "no-avds"),
      ORCH_NOW_EPOCH: FUTURE,
    },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DRY RUN/);
  assert.match(r.stdout, /would reap/);
  assert.match(r.stdout, /would reclaim: 1/);
  assert.equal(existsSync(wt), true, "dry run must not delete anything");
});
