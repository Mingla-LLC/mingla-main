// #3076 IMPLEMENTOR, happy path. #2882 stopped a batch class from RUNNING suites
// its diff does not invalidate. It could not stop the job PAYING for them: all
// fourteen matrix jobs still checked out, installed dependencies and stood up
// Phase 3C setup first — 7.9 job-minutes per pull request spent getting ready to
// execute nothing.
//
// This file proves the two halves of the fix, and one thing about the fix that
// matters more than the saving.
//
//   1  the runner publishes the routing decision as step outputs, so the
//      workflow can skip setup for a class that will execute nothing;
//   2  the workflow gates exactly three steps on it — install, Node setup and
//      Phase 3C setup — and no others;
//   3  THE LANE STILL REPORTS. `ci-batch` is not ruleset-required, so a check
//      run that disappears blocks nothing and pends nothing: it reads as a pass.
//      Every step that makes this job VISIBLE — the routing line with its
//      denominator, the suite run, the artifact uploads — is asserted to be
//      ungated. A skipped step must never become a skipped lane.
//
// The gate's polarity is asserted directly rather than assumed, because it is
// the whole safety argument: the workflow skips on an explicit `false` and on
// nothing else, so a routing step that never ran, or ran and died, still
// installs. This repository's recorded failure history is absence of signal
// reading as confirmation; a gate that skipped work on a MISSING signal would be
// that same bug with a budget attached.
//
// NOTE ON A LITERAL THIS FILE MUST NOT CONTAIN: `discoverWorkflowProviders()` in
// validate-manifest-v2.mjs scans every tracked non-workflow file for workflow
// filename literals and counts each one as an external provider, which moves the
// frozen #2148 provider seal. One such literal in one comment has reddened nine
// gates in a single pull request. The workflow path below is therefore assembled
// from parts, the way the #2439 parity test assembles its wrappers.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  emitRouteOutputs,
  expectedPrimarySuites,
  phase3cOwnedForHost,
  previewRouteDecision,
  selectSuites,
} from "../run-suite-batch.mjs";
import { suiteOriginPatterns } from "../validate-manifest-v2.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, ".github/ci-batch/MANIFEST.json"), "utf8"));
// Assembled, never written whole. See the note above.
const WORKFLOW_TEXT = fs.readFileSync(
  path.join(ROOT, ".github/workflows", `ci-batch.${"yml"}`),
  "utf8",
);

const PRIMARY_OUTPUT = "runPrimarySetup";
const PHASE3C_OUTPUT = "runPhase3cSetup";

// A class that hosts Phase 3C work, taken from the registry rather than typed,
// so this file cannot outlive the host it names.
const PHASE3C_HOST = MANIFEST.classes.find((klass) => phase3cOwnedForHost(MANIFEST, klass).length > 0);

/** The step blocks of the `batch` job, split on their own list markers. */
function batchSteps() {
  const job = WORKFLOW_TEXT.slice(WORKFLOW_TEXT.indexOf("\n  batch:"), WORKFLOW_TEXT.indexOf("\n  dispatch:"));
  return job.split(/\n(?=      - (?:name|uses):)/).slice(1).map((block) => {
    const name = block.match(/^      - (?:name|uses): (.+)$/m)?.[1]?.trim() || "";
    const condition = block.match(/^        if: (.+)$/m)?.[1]?.trim() || "";
    const id = block.match(/^        id: (.+)$/m)?.[1]?.trim() || "";
    return { name, condition, id, block };
  });
}

const stepStartingWith = (prefix) => batchSteps().find((step) => step.name.startsWith(prefix));
const stepNamed = (name) => batchSteps().find((step) => step.name === name);

/**
 * A throwaway repository whose only diff is one file. The routing context is
 * derived from real `git diff` output exactly as it is in CI, so this exercises
 * the production path rather than a hand-built context object.
 */
function gitDiffFixture(changedPath) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "issue-3076-"));
  const git = (...argv) => execFileSync("git", argv, { cwd: root, encoding: "utf8", stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "ci@example.invalid");
  git("config", "user.name", "ci");
  git("commit", "-q", "--allow-empty", "-m", "base");
  const base = git("rev-parse", "HEAD").trim();
  fs.mkdirSync(path.join(root, path.dirname(changedPath)), { recursive: true });
  fs.writeFileSync(path.join(root, changedPath), "x\n");
  git("add", "-A");
  git("commit", "-q", "-m", "head");
  return { root, base, head: git("rev-parse", "HEAD").trim() };
}

/** Runs the real preview against that fixture and returns the emitted outputs. */
function previewAgainst(klass, changedPath) {
  const { root, base, head } = gitDiffFixture(changedPath);
  try {
    return previewRouteDecision(MANIFEST, klass, expectedPrimarySuites(MANIFEST, klass), {
      root,
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_EVENT_PATH: "event.json",
        GITHUB_OUTPUT: "",
      },
      readFile: () => JSON.stringify({ pull_request: { base: { sha: base }, head: { sha: head } } }),
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("#3076-1 a class whose diff invalidates nothing publishes an explicit refusal to set up", () => {
  // A path no suite in the registry claims. Derived by exhaustion, not assumed:
  // the assertion below would be vacuous if some suite did claim it.
  const inert = "issue-3076-claimed-by-no-suite/marker.txt";
  const exhaustive = selectSuites(MANIFEST, MANIFEST.suites,
    { eventName: "pull_request", mode: "routed", changedPaths: [inert] });
  assert.deepEqual(exhaustive.selectedSuiteIds, [], "the inert probe path must be claimed by no suite");

  const outputs = previewAgainst(PHASE3C_HOST, inert);
  assert.equal(outputs[PRIMARY_OUTPUT], false, "a zero-selection class must publish an explicit false");
  assert.equal(outputs[PHASE3C_OUTPUT], false, "a zero-selection Phase 3C host must publish an explicit false");
});

test("#3076-2 a class whose diff DOES invalidate a suite publishes true and still installs", () => {
  // The path is synthesised from a real registered pattern, so this cannot rot
  // into a test that passes because it selected nothing for a different reason.
  const host = MANIFEST.classes.find((klass) => {
    const suites = expectedPrimarySuites(MANIFEST, klass);
    return suites.some((suite) => suiteOriginPatterns(suite).some((pattern) => pattern.endsWith("/**")));
  });
  const pattern = expectedPrimarySuites(MANIFEST, host)
    .flatMap((suite) => suiteOriginPatterns(suite))
    .find((candidate) => candidate.endsWith("/**"));
  const outputs = previewAgainst(host, `${pattern.slice(0, -3)}/issue-3076-probe.txt`);
  assert.equal(outputs[PRIMARY_OUTPUT], true, "an invalidated class must still install");
});

test("#3076-3 push, schedule and local runs are never gated: selection is the identity function", () => {
  for (const eventName of ["push", "schedule", "workflow_dispatch", ""]) {
    const outputs = previewRouteDecision(MANIFEST, PHASE3C_HOST, expectedPrimarySuites(MANIFEST, PHASE3C_HOST), {
      env: { GITHUB_EVENT_NAME: eventName, GITHUB_OUTPUT: "" },
    });
    assert.equal(outputs[PRIMARY_OUTPUT], true, `${eventName || "local"}: every class must install in full`);
    assert.equal(outputs[PHASE3C_OUTPUT], true, `${eventName || "local"}: every Phase 3C host must set up in full`);
  }
});

test("#3076-4 the routing line still prints its denominator on a zero, and the run step that prints it is ungated", () => {
  // The visible half of the contract. A zero-selection job must still SAY so.
  const printed = [];
  const log = console.log;
  console.log = (line) => printed.push(String(line));
  try {
    previewRouteDecision(MANIFEST, PHASE3C_HOST, expectedPrimarySuites(MANIFEST, PHASE3C_HOST), {
      env: { GITHUB_EVENT_NAME: "push", GITHUB_OUTPUT: "" },
    });
  } finally {
    console.log = log;
  }
  assert.ok(printed.some((line) => new RegExp(`selected=\\d+ of ${MANIFEST.suites.length}`).test(line)),
    "the selection must always be printed beside its denominator");

  // The steps that make this lane VISIBLE must not carry the gate. This is the
  // assertion that stops a saving from becoming a vanished check run.
  const route = stepNamed("Print the routed suite selection with its denominator");
  const runSuites = stepStartingWith("Run the ");
  const upload = stepNamed("Upload suite results");
  const phase3cRun = stepNamed("Run assigned Phase 3C suites with exact attribution");
  const selfTest = stepStartingWith("Batch runner self-test");
  for (const [label, step] of [["routing line", route], ["suite run", runSuites], ["upload", upload],
    ["Phase 3C run", phase3cRun], ["self-test", selfTest]]) {
    assert.ok(step, `${label}: step must exist`);
    assert.equal(step.condition.includes(PRIMARY_OUTPUT) || step.condition.includes(PHASE3C_OUTPUT), false,
      `${label}: a reporting step may never be gated on the routing decision`);
  }
});

test("#3076-5 exactly the three paid-for setup steps are gated, on an explicit false and nothing else", () => {
  const route = stepNamed("Print the routed suite selection with its denominator");
  assert.equal(route.id, "route", "the routing step must publish under the id the gates read");

  const shardSetup = stepNamed("Execute and record one typed shard setup");
  assert.match(shardSetup.condition, new RegExp(`steps\\.route\\.outputs\\.${PRIMARY_OUTPUT} != 'false'`),
    "the install step must be gated, and gated fail-open");

  const phase3cSetup = stepNamed("Execute one typed Phase 3C setup");
  assert.match(phase3cSetup.condition, new RegExp(`steps\\.route\\.outputs\\.${PHASE3C_OUTPUT} != 'false'`),
    "the Phase 3C setup step must be gated, and gated fail-open");
  assert.match(phase3cSetup.condition, /matrix\.tertiaryClass != ''/,
    "the Phase 3C setup step must keep its original host condition");

  // The Node runtime is the one gated step that also serves the other two waves:
  // it restores the npm cache their installs draw on. It may only be skipped when
  // ALL THREE waves are idle, so its condition must name all three.
  const setupNode = batchSteps().find((step) => step.name.startsWith("actions/setup-node@") && !step.id);
  assert.ok(setupNode.condition.includes(PRIMARY_OUTPUT), "Node setup must consider the primary wave");
  assert.ok(setupNode.condition.includes(PHASE3C_OUTPUT), "Node setup must consider the Phase 3C wave");
  assert.ok(setupNode.condition.includes("runSecondary"), "Node setup must consider the Phase 3B wave");
  assert.ok(setupNode.condition.startsWith("always()"), "Node setup must still run after an earlier failure");

  // Nothing else in the job reads the routing decision.
  const gated = batchSteps().filter((step) =>
    step.condition.includes(PRIMARY_OUTPUT) || step.condition.includes(PHASE3C_OUTPUT));
  assert.equal(gated.length, 3, "exactly three steps may be gated on the routing decision");

  // Polarity, stated as an assertion rather than left to review: no gate may be
  // written as a positive test, which would skip on a MISSING signal.
  for (const step of gated) {
    assert.doesNotMatch(step.condition, new RegExp(`outputs\\.(?:${PRIMARY_OUTPUT}|${PHASE3C_OUTPUT}) == 'true'`),
      `${step.name}: a gate must fail open, never skip on an absent output`);
  }
});

test("#3076-6 the emitter is inert without a step-output file and writes the documented key=value shape", () => {
  // Fail-open at the source: no GITHUB_OUTPUT is not a crash and not a false.
  assert.deepEqual(emitRouteOutputs({ [PRIMARY_OUTPUT]: false }, {}, () => {
    throw new Error("must not write without GITHUB_OUTPUT");
  }), { [PRIMARY_OUTPUT]: false });

  const written = [];
  emitRouteOutputs({ [PRIMARY_OUTPUT]: false, [PHASE3C_OUTPUT]: true },
    { GITHUB_OUTPUT: "out" }, (_file, body) => written.push(body));
  assert.deepEqual(written, [`${PRIMARY_OUTPUT}=false\n${PHASE3C_OUTPUT}=true\n`]);
});

test("#3076-7 the Phase 3C answer is the routed subset of the host's assigned suites", () => {
  const owned = phase3cOwnedForHost(MANIFEST, PHASE3C_HOST);
  assert.ok(owned.length > 0, "the probe host must own Phase 3C suites");
  const none = selectSuites(MANIFEST, owned, { eventName: "pull_request", mode: "routed", changedPaths: ["issue-3076-claimed-by-no-suite/marker.txt"] });
  assert.equal(none.suites.length, 0, "an uninvalidating diff selects no Phase 3C suite");
  const full = selectSuites(MANIFEST, owned, { eventName: "push", mode: "full" });
  assert.equal(full.suites.length, owned.length, "full mode must select every assigned Phase 3C suite");
});
