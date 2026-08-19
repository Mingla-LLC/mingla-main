// #2300 — tester adversarial suite.
//
// The happy suite proves dead things get reaped. This one attacks the opposite
// and far more expensive failure: reaping something ALIVE. Every case here is
// modelled on a real 2026-08-18 measurement, not an invented hypothetical.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { addWorktree, dirtyUp, evalLib, libPath, makeBins, makeWorld, reapPath, runScript, sweepPath } from "./harness.mjs";

const FUTURE = String(Math.floor(Date.UTC(2030, 0, 1) / 1000));

// --- TRAP 1: ancestry ------------------------------------------------------
// A freshly-spawned worktree has HEAD == main, so `merge-base --is-ancestor`
// says "merged". On 2026-08-18 that misread flagged #2211/#2245/#2267/#2291 as
// reapable while all four were live with simulators booted.
test("A1: a freshly-spawned worktree on an OPEN issue is NOT reapable", async () => {
  const w = await makeWorld("a1");
  const wt = await addWorktree(w, "2211-bigtext-scroll", "2211-bigtext-scroll", "fresh");

  // The trap fires: git really does call this an ancestor of main.
  const anc = spawnSync("git", ["-C", wt, "merge-base", "--is-ancestor", "2211-bigtext-scroll", "origin/main"]);
  assert.equal(anc.status, 0, "fixture must reproduce the ancestry trap");

  const bin = await makeBins(w.root, { issues: { 2211: "OPEN" } });
  const r = evalLib(`orch_worktree_reapable "${wt}"`, { bin, env: { ORCH_NOW_EPOCH: FUTURE } });
  assert.equal(r.stdout.trim(), "issue-OPEN");
  assert.notEqual(r.status, 0);
});

test("A2: a closed issue with NO merged PR is still NOT reapable", async () => {
  const w = await makeWorld("a2");
  const wt = await addWorktree(w, "2150-free-resubmit-duplicate", "2150-free-resubmit-duplicate", "squashed");
  const bin = await makeBins(w.root, { issues: { 2150: "CLOSED" } }); // no PR entry
  const r = evalLib(`orch_worktree_reapable "${wt}"`, { bin, env: { ORCH_NOW_EPOCH: FUTURE } });
  assert.equal(r.stdout.trim(), "pr-NONE");
  assert.notEqual(r.status, 0);
});

// --- TRAP 2: the gate must NOT consult rev-list ----------------------------
test("A3: the liveness library never uses rev-list/is-ancestor as the merge gate", () => {
  const src = readFileSync(libPath, "utf8");
  const code = src
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  assert.equal(/rev-list/.test(code), false, "rev-list is squash-blind (TRAP 2) — it must not gate a delete");
  assert.equal(/is-ancestor/.test(code), false, "ancestry is spawn-blind (TRAP 1) — it must not gate a delete");
});

// --- Uncommitted work ------------------------------------------------------
test("A4: uncommitted changes veto reaping even when closed AND merged", async () => {
  const w = await makeWorld("a4");
  const wt = await addWorktree(w, "2272-web-dead-paths", "2272-web-dead-paths", "squashed");
  await dirtyUp(wt);
  const bin = await makeBins(w.root, {
    issues: { 2272: "CLOSED" },
    prs: { "2272-web-dead-paths": "MERGED" },
  });
  const r = evalLib(`orch_worktree_reapable "${wt}"`, { bin, env: { ORCH_NOW_EPOCH: FUTURE } });
  assert.equal(r.stdout.trim(), "dirty");
});

test("A5: reap.sh still refuses a dirty worktree without --force", async () => {
  const w = await makeWorld("a5");
  const wt = await addWorktree(w, "2272-web-dead-paths", "2272-web-dead-paths", "squashed");
  await dirtyUp(wt);
  const bin = await makeBins(w.root, {
    issues: { 2272: "CLOSED" },
    prs: { "2272-web-dead-paths": "MERGED" },
  });
  const r = runScript(reapPath, [wt], { bin, env: { ORCH_ANCHOR: w.anchor } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /uncommitted changes/);
  assert.equal(existsSync(wt), true);
});

// --- Running artifacts belong to another session ---------------------------
test("A6: a Booted simulator is NEVER reapable, even on a closed issue", async () => {
  const w = await makeWorld("a6");
  const bin = await makeBins(w.root, {
    issues: { 2180: "CLOSED" },
    sims: [{ name: "ISSUE2180-iPhoneSE3", state: "Booted" }],
  });
  const r = evalLib(`orch_sim_reapable ISSUE2180-iPhoneSE3`, { bin });
  assert.equal(r.stdout.trim(), "sim-Booted");
  assert.notEqual(r.status, 0);
});

test("A7: a running AVD is NEVER reapable, even on a closed issue", async () => {
  const w = await makeWorld("a7");
  const bin = await makeBins(w.root, { issues: { 1999: "CLOSED" }, avds: ["ISSUE1999-Pixel"] });
  const r = evalLib(`orch_avd_reapable ISSUE1999-Pixel`, { bin });
  assert.equal(r.stdout.trim(), "avd-running");
  assert.notEqual(r.status, 0);
});

// --- Fail-closed on an unusable oracle -------------------------------------
test("A8: when gh cannot answer, nothing is reapable (fail-closed)", async () => {
  const w = await makeWorld("a8");
  const wt = await addWorktree(w, "2272-web-dead-paths", "2272-web-dead-paths", "squashed");
  const bin = await makeBins(w.root, { ghBroken: true });
  const r = evalLib(`orch_worktree_reapable "${wt}"`, { bin, env: { ORCH_NOW_EPOCH: FUTURE } });
  assert.equal(r.stdout.trim(), "issue-UNKNOWN");
  const s = evalLib(`orch_sim_reapable ISSUE2180-iPhoneSE3`, { bin });
  assert.notEqual(s.stdout.trim(), "reapable");
});

// --- TRAP 3: the idle probe must fail CLOSED -------------------------------
// `find -newermt '-7 days'` errors on bfs and returns empty stdout, so the
// common `[ -z "$(find ...)" ]` idiom reads EVERY directory as stale. During
// the #2300 cleanup that wiped the entire npx cache instead of the stale part.
test("A9: a recently-touched worktree is not idle, and the gate says so", async () => {
  const w = await makeWorld("a9");
  const wt = await addWorktree(w, "2272-web-dead-paths", "2272-web-dead-paths", "squashed");
  const bin = await makeBins(w.root, {
    issues: { 2272: "CLOSED" },
    prs: { "2272-web-dead-paths": "MERGED" },
  });
  // Real clock: the fixture was created milliseconds ago.
  const r = evalLib(`orch_worktree_reapable "${wt}"`, { bin });
  assert.equal(r.stdout.trim(), "recently-touched");
});

test("A10: an unreadable mtime counts as NOW, never as stale", () => {
  const r = evalLib(
    `orch_mtime_epoch "/nonexistent/path/that/cannot/be/statted"`,
    { env: { ORCH_NOW_EPOCH: "1893456000" } },
  );
  assert.equal(r.stdout.trim(), "1893456000", "unknown mtime must resolve to now, not 0");
});

test("A11: the idle predicate never consults a relative -newermt timestamp", () => {
  const src = readFileSync(libPath, "utf8");
  const code = src.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");
  assert.equal(/-newermt/.test(code), false, "relative -newermt is unsupported by bfs and fails OPEN (TRAP 3)");
});

// --- Protected refs --------------------------------------------------------
test("A12: main is never reapable", async () => {
  const w = await makeWorld("a12");
  const bin = await makeBins(w.root, { issues: {}, prs: {} });
  const r = evalLib(`orch_worktree_reapable "${w.anchor}"`, { bin, env: { ORCH_NOW_EPOCH: FUTURE } });
  assert.equal(r.stdout.trim(), "protected-branch");
});

// --- sweep.sh blast radius -------------------------------------------------
test("A13: sweep.sh defaults to dry run and deletes nothing", async () => {
  const w = await makeWorld("a13");
  const wt = await addWorktree(w, "2272-web-dead-paths", "2272-web-dead-paths", "squashed");
  const bin = await makeBins(w.root, {
    issues: { 2272: "CLOSED" },
    prs: { "2272-web-dead-paths": "MERGED" },
  });
  const r = runScript(sweepPath, [], {
    bin,
    env: { ORCH_ANCHOR: w.anchor, ORCH_DIR: join(w.root, "orchs"), ORCH_AVD_DIR: join(w.root, "none"), ORCH_NOW_EPOCH: FUTURE },
  });
  assert.equal(r.status, 0);
  assert.equal(existsSync(wt), true, "the default invocation must never delete");
  assert.equal(/would reclaim/.test(r.stdout), true);
});

test("A14: sweep.sh rejects any argument that is not --apply", async () => {
  const w = await makeWorld("a14");
  const bin = await makeBins(w.root, {});
  for (const bad of ["--all", "--force", "--yes", "-f"]) {
    const r = runScript(sweepPath, [bad], { bin, env: { ORCH_ANCHOR: w.anchor, ORCH_DIR: join(w.root, "orchs") } });
    assert.notEqual(r.status, 0, `sweep.sh must reject '${bad}'`);
    assert.match(r.stderr, /unknown argument/);
  }
});

test("A15: sweep.sh --apply spares every live worktree in a mixed population", async () => {
  const w = await makeWorld("a15");
  const dead = await addWorktree(w, "2272-web-dead-paths", "2272-web-dead-paths", "squashed");
  const openIssue = await addWorktree(w, "2211-bigtext-scroll", "2211-bigtext-scroll", "fresh");
  const dirty = await addWorktree(w, "2245-deep-link-claims", "2245-deep-link-claims", "squashed");
  await dirtyUp(dirty);
  const bin = await makeBins(w.root, {
    issues: { 2272: "CLOSED", 2211: "OPEN", 2245: "CLOSED" },
    prs: { "2272-web-dead-paths": "MERGED", "2245-deep-link-claims": "MERGED" },
  });
  const r = runScript(sweepPath, ["--apply"], {
    bin,
    env: { ORCH_ANCHOR: w.anchor, ORCH_DIR: join(w.root, "orchs"), ORCH_AVD_DIR: join(w.root, "none"), ORCH_NOW_EPOCH: FUTURE },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(dead), false, "the provably dead worktree should be gone");
  assert.equal(existsSync(openIssue), true, "an OPEN issue's worktree must survive --apply");
  assert.equal(existsSync(dirty), true, "uncommitted work must survive --apply");
});
