#!/usr/bin/env node
// #2148 Stage 3 [ci-runtime]. Runs the per-issue suites registered in
// .github/ci-batch/MANIFEST.json as steps of ONE job instead of one CI job each.
//
// WHY: MEASURED on a real PR, the non-database CI set spends 60 job-minutes doing
// test work and 65 job-minutes setting up to do it. A typical per-issue job spent
// ~40s on checkout + runner boot to run ~14s of `node --test`. Batching deletes
// the setup, not the tests, and frees the concurrency slots those jobs were
// holding (the org cap is 20, and the baseline PR queued 335 job-minutes against
// 141 spent executing).
//
// THE ONLY THING THAT MAKES THIS SAFE is: executed === manifest-expected.
// This runner deliberately mirrors run-batch.mjs (ORCH-1383), which replaced 340
// one-gate jobs on the same contract. The rules below are that contract.
//
//   R1  Iterate MANIFEST.json. NEVER a glob. A glob turns a deleted or renamed
//       suite into a silent skip, and a green run into a lie.
//   R2  NEVER break early. Every suite in the class runs even after one fails,
//       so one red suite cannot hide the state of the rest.
//   R3  A suite that cannot run is a FAILURE, never a skip.
//   R4  Assert executed === expected. A shortfall fails the run ON ITS OWN, even
//       if every suite that did run passed.
//   R5  Use each step's recorded command, cwd and env verbatim.
//   R6  Print one line per suite naming it and its outcome.
//   R7  Write suite-results.json for the workflow to upload.
//   R8  Exit 0 IFF every suite passed AND executed === expected.
//   R9  Exit-code passthrough — a suite's exit 2 is never collapsed to 1.
//
// This repo has produced SIX classes of dark gate, including 21 gates on disk that
// CI never ran, one of them dark the day after its issue closed. #2113 and #2120
// are open about exactly this. Assume it WILL happen again here and that R4 is the
// only thing standing in the way.
//
// This proves EXECUTION, not EFFICACY. A suite that cannot fail still counts as
// executed. Green here does not mean the suites are healthy — see #2113.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const MANIFEST_PATH = path.join(REPO_ROOT, ".github/ci-batch/MANIFEST.json");

export function loadManifest(p = MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** R1: the expected set comes ONLY from the manifest, never from disk. */
export function expectedSuites(manifest, klass) {
  return manifest.suites.filter((s) => !klass || s.class === klass);
}

/** R5: run one typed, recorded invocation verbatim. Exported for regression proof. */
export function runStep(step, { cwd = REPO_ROOT, exec = spawnSync } = {}) {
  const dir = path.resolve(cwd, step.cwd || ".");
  if (!fs.existsSync(dir)) {
    return { ok: false, code: 2, reason: `working directory does not exist: ${step.cwd}` };
  }
  // Compatibility fallback keeps the pre-v2 unit fixtures valid; the v2 registry
  // validator requires every committed step to carry an exact typed invocation.
  const invocation = step.invocation || { command: "bash", argv: ["-c", step.run] };
  if (!invocation.command || !Array.isArray(invocation.argv) || invocation.argv.some((arg) => typeof arg !== "string")) {
    return { ok: false, code: 2, reason: "invalid typed invocation" };
  }
  const r = exec(invocation.command, invocation.argv, {
    cwd: dir,
    stdio: "inherit",
    env: { ...process.env, ...(step.env || {}) },
  });
  // R3: a step that could not be spawned is a failure, not a skip.
  if (r.error) return { ok: false, code: 2, reason: `could not execute: ${r.error.message}` };
  const code = r.status === null ? 2 : r.status; // killed by signal -> hard fail
  return { ok: code === 0, code };
}

export function runSuites(suites, opts = {}) {
  const results = [];
  for (const suite of suites) {
    let code = 0;
    let reason = null;
    // Durations are recorded so shards can be rebalanced from EVIDENCE rather than
    // by counting suites. MEASURED locally, the 14 business suites took 730s in
    // total but are nowhere near equal; splitting them evenly by count would leave
    // one shard setting the critical path on its own.
    const started = Date.now();
    for (const step of suite.steps) {
      const r = runStep(step, opts);
      if (!r.ok) {
        code = r.code; // R9: passthrough, never collapsed
        reason = r.reason || `step failed: ${step.name}`;
        break; // stop THIS suite; R2 still runs the remaining suites
      }
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    results.push({ id: suite.id, ok: code === 0, code, reason, seconds });
    // R6
    console.log(
      `${code === 0 ? "PASS" : "FAIL"}  ${String(seconds).padStart(4)}s  ${suite.id}${reason ? `  (${reason})` : ""}`,
    );
  }
  return results;
}

/**
 * R4 + R8. Separated from I/O so the self-test can prove the assertion bites
 * without spawning anything.
 */
export function verdict(expected, results) {
  const executed = results.length;
  const failed = results.filter((r) => !r.ok);
  const shortfall = expected - executed;
  const worstCode = failed.reduce((w, r) => Math.max(w, r.code), 0);
  return {
    executed,
    expected,
    shortfall,
    failed: failed.map((r) => r.id),
    // R8: green requires BOTH no failures AND no shortfall.
    ok: failed.length === 0 && shortfall === 0,
    // R9: surface the worst real exit code; a shortfall alone is exit 1.
    code: failed.length ? worstCode || 1 : shortfall === 0 ? 0 : 1,
  };
}

function main() {
  const klass = process.argv[2] || null;
  const manifest = loadManifest();
  const suites = expectedSuites(manifest, klass);

  if (klass && suites.length === 0) {
    console.error(`::error::no suites registered for class "${klass}" — refusing to report green on an empty run`);
    process.exit(2);
  }

  console.log(`#2148 batch: ${suites.length} suite(s)${klass ? ` in class ${klass}` : ""}\n`);
  const results = runSuites(suites);
  const v = verdict(suites.length, results);

  fs.writeFileSync(
    path.join(REPO_ROOT, "suite-results.json"),
    JSON.stringify({ class: klass, ...v, results }, null, 2) + "\n",
  ); // R7

  console.log(`\nexecuted ${v.executed} / expected ${v.expected}`);
  if (v.shortfall !== 0) {
    console.error(`::error::suite shortfall: ${v.shortfall} registered suite(s) did not run. A green run with a shortfall is exactly the dark-gate failure this assertion exists to prevent.`);
  }
  for (const id of v.failed) console.error(`::error::suite failed: ${id}`);
  process.exit(v.code);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
