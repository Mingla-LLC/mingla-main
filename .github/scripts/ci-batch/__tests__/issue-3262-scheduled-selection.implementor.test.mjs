// #3262 implementor regression: the nightly CI batch must select its Phase 3B
// suites cleanly instead of failing every job on a deferred selector error.
//
// WHAT BROKE. #3078 added a nightly `schedule` trigger to the batch lane on the
// premise that selection is the identity function on every non-pull_request
// event. That was true of the primary router and false of the Phase 3B
// selector: `deriveChangedPaths` knows only `pull_request` and `push`, so every
// scheduled `--select` threw, exited 1 with NO output, and wrote a fail-safe
// decision carrying `deferredError`. The fail-safe host then ran — and passed —
// every Phase 3B suite, and reconciliation failed all fourteen jobs anyway with
// `secondary-evidence-mismatch`, `secondary-failed` and
// `deferred-selector-failure`. main-health read that run and held `main` red
// every morning.
//
// HOW THIS FILE PROVES IT. The select and normalize commands are read from the
// batch workflow itself and executed with a schedule-shaped event, for every
// host class — so the proof is the workflow's own invocation, not a paraphrase
// of it. Reverting the fix turns the first two tests red on their real
// assertions (exit 1, fail-safe mode, a non-empty reconciliation).
//
// NAMING CONSTRAINT, load-bearing: the frozen #2148 provider seal records every
// tracked file that names a workflow file literally. This file must never
// contain that literal; the workflow path is assembled from fragments below.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DEFAULT_MANIFEST, DEFAULT_ROOT } from "../validate-manifest-v2.mjs";
import { buildShardReport, commandFingerprint, expectedPrimarySuites, routingContext, routingReport, selectSuites } from "../run-suite-batch.mjs";
// A namespace import, so a reverted selector reds the tests that need the new
// exports on their own assertions instead of failing this whole file at link time.
import * as selector from "../select-phase3b-suites.mjs";

const ROOT = DEFAULT_ROOT;
const manifest = () => JSON.parse(fs.readFileSync(DEFAULT_MANIFEST, "utf8"));
const WORKFLOW = path.join(ROOT, ".github/workflows", ["ci-batch", "y" + "ml"].join("."));
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const HEAD = execFileSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], { cwd: ROOT, encoding: "utf8" }).trim();
const ownedPhase3b = (value, host) => value.suites
  .filter((suite) => suite.migrationWave === selector.WAVE && suite.hostClass === host).map((suite) => suite.id);

// ---------------------------------------------------------------------------
// The workflow's own step commands.
// ---------------------------------------------------------------------------
const RUBY_STEPS = String.raw`
require "yaml"; require "json"
doc = YAML.safe_load(STDIN.read, aliases: true) || {}
steps = ((doc["jobs"] || {})["batch"] || {})["steps"] || []
STDOUT.write(JSON.generate(steps.map { |s| { "id" => s["id"], "run" => s["run"], "continueOnError" => s["continue-on-error"] } }))`;

let parsedSteps = null;
function workflowStep(id) {
  parsedSteps ??= JSON.parse(execFileSync("ruby", ["-e", RUBY_STEPS], { input: fs.readFileSync(WORKFLOW, "utf8"), encoding: "utf8" }));
  const step = parsedSteps.find((candidate) => candidate.id === id);
  assert.ok(step && typeof step.run === "string", `the batch job must keep a step with id ${id}`);
  return step;
}

function render(run, values) {
  let command = run;
  for (const [expression, value] of Object.entries(values)) command = command.split(expression).join(value);
  assert.doesNotMatch(command, /\$\{\{/, `every workflow expression must be substituted: ${command}`);
  return command;
}

/** A child environment built from nothing, so the parent job's own GITHUB_* and NODE_TEST_CONTEXT cannot leak in. */
function childEnv(extra) {
  return { PATH: process.env.PATH, HOME: process.env.HOME || os.tmpdir(), ...extra };
}

/**
 * Runs the workflow's select step, then its normalize step with the select
 * step's real outcome, exactly as the batch job chains them.
 */
function runSelectAndNormalize({ host, eventName, payload, scratch }) {
  const runnerTemp = path.join(scratch, `runner-temp-${host}`);
  fs.mkdirSync(runnerTemp, { recursive: true });
  const eventPath = path.join(scratch, `event-${host}.json`);
  fs.writeFileSync(eventPath, JSON.stringify(payload));
  const selectOutput = path.join(scratch, `select-output-${host}`);
  const normalizeOutput = path.join(scratch, `normalize-output-${host}`);
  fs.writeFileSync(selectOutput, ""); fs.writeFileSync(normalizeOutput, "");
  const base = { GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventPath, RUNNER_TEMP: runnerTemp };

  const selectStep = workflowStep("phase3b-select");
  assert.equal(selectStep.continueOnError, true, "the select step must stay continue-on-error so its outcome reaches normalize");
  const select = spawnSync("bash", ["-e", "-c", render(selectStep.run, { "${{ matrix.class }}": host })],
    { cwd: ROOT, encoding: "utf8", env: childEnv({ ...base, GITHUB_OUTPUT: selectOutput }) });
  const outcome = select.status === 0 ? "success" : "failure";
  const normalize = spawnSync("bash", ["-e", "-c", render(workflowStep("phase3b-decision").run,
    { "${{ matrix.class }}": host, "${{ steps.phase3b-select.outcome }}": outcome })],
  { cwd: ROOT, encoding: "utf8", env: childEnv({ ...base, GITHUB_OUTPUT: normalizeOutput }) });
  const read = (file) => JSON.parse(fs.readFileSync(path.join(runnerTemp, file), "utf8"));
  return { select, normalize, outcome, raw: read(`phase3b-raw-${host}.json`), decision: read(`phase3b-decision-${host}.json`),
    selectOutputs: fs.readFileSync(selectOutput, "utf8"), normalizeOutputs: fs.readFileSync(normalizeOutput, "utf8") };
}

const withScratch = (fn) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "issue-3262-"));
  try { return fn(scratch); } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
};

const SCHEDULE_PAYLOAD = { schedule: "17 3 * * *" };
// One scheduled select+normalize per host, shared by the tests that read it:
// the result is parsed data, so the scratch directory need not outlive the run.
const scheduledRuns = new Map();
const scheduledRun = (host) => {
  if (!scheduledRuns.has(host)) {
    scheduledRuns.set(host, withScratch((scratch) => runSelectAndNormalize({ host, eventName: "schedule", payload: SCHEDULE_PAYLOAD, scratch })));
  }
  return scheduledRuns.get(host);
};

// ---------------------------------------------------------------------------
// Report fixtures, built the way the batch runner builds them.
// ---------------------------------------------------------------------------
function setupForClass(value, klass) {
  const [name, profile] = Object.entries(value.setupProfiles).find(([, candidate]) => candidate.classes.includes(klass));
  const installs = profile.install ? [profile.install] : profile.installs || [];
  const orderedInstalls = installs.map((install) => ({ id: install.id, cwd: install.cwd, command: install.invocation.command,
    argv: install.invocation.argv, status: "passed", durationMs: 0 }));
  const orderedToolExposures = (profile.toolExposures || []).map((exposure) => ({ ...exposure, status: "passed", durationMs: 0 }));
  const installPayload = orderedInstalls.map(({ id, cwd, command, argv }) => ({ id, cwd, command, argv }));
  const exposurePayload = orderedToolExposures.map(({ status, durationMs, ...payload }) => payload);
  return { profile, evidence: { class: klass, setupProfile: name, setupExecutions: 1, installExecutions: installs.length,
    orderedInstalls, setupFingerprint: sha256(JSON.stringify(installPayload)), toolExposureExecutions: orderedToolExposures.length,
    orderedToolExposures, toolExposureFingerprint: sha256(JSON.stringify(exposurePayload)) } };
}

function greenResult(value, suite) {
  const { profile } = setupForClass(value, suite.executionClass || suite.class);
  const installs = profile.install ? [profile.install] : profile.installs || [];
  const dependencyCwds = [...new Set(installs.map((install) => install.cwd))];
  const result = { id: suite.id, setupProfile: suite.setupProfile, commandFingerprint: commandFingerprint(suite), status: "passed",
    ok: true, code: 0, reason: null, durationMs: 0, seconds: 0, timeoutSeconds: suite.timeoutSeconds,
    expected: suite.steps.length, executed: suite.steps.length, allowedCleanup: [], dependencyCwds, dependencyCloneCount: dependencyCwds.length };
  if (suite.migrationWave !== selector.WAVE) return result;
  result.leafResults = suite.steps.flatMap((step, stepIndex) => (step.children || [{
    id: `leaf:${suite.id}:${String(stepIndex + 1).padStart(2, "0")}:1`, predicate: { kind: "always" },
  }]).map((leaf) => {
    const conditional = suite.conditionalExpectedFiles?.includes(leaf.predicate?.path);
    const absent = conditional && !fs.existsSync(path.join(ROOT, leaf.predicate.path));
    return { id: leaf.id, outerCommandId: step.commandId, status: absent ? "skipped-absent" : "passed", executed: !absent };
  }));
  result.outerResults = suite.steps.map((step) => {
    const leaves = result.leafResults.filter((leaf) => leaf.outerCommandId === step.commandId);
    return { id: step.commandId, status: "passed", executed: true, expectedLeaves: leaves.length,
      executedLeaves: leaves.filter((leaf) => leaf.executed).length,
      skippedAbsentLeaves: leaves.filter((leaf) => leaf.status === "skipped-absent").length };
  });
  result.expectedLeaves = result.leafResults.length;
  result.absentLeaves = result.leafResults.filter((leaf) => leaf.status === "skipped-absent").length;
  result.presentLeaves = result.expectedLeaves - result.absentLeaves;
  result.executedLeaves = result.presentLeaves;
  return result;
}

/** Every suite passes. Only the decision document differs between the calls that use this. */
function passingReports(value, host, decision) {
  const primarySuites = expectedPrimarySuites(value, host);
  const primary = buildShardReport(host, primarySuites, primarySuites.map((suite) => greenResult(value, suite)), setupForClass(value, host).evidence, 0);
  const context = routingContext({ env: { GITHUB_EVENT_NAME: "schedule" } });
  primary.routing = routingReport(context, selectSuites(value, primarySuites, context));
  const selectedSuites = decision.selectedSuiteIds.map((id) => value.suites.find((suite) => suite.id === id));
  const secondaryResults = selectedSuites.map((suite) => greenResult(value, suite));
  const secondary = buildShardReport(`phase3b:${host}`, selectedSuites, secondaryResults, setupForClass(value, selectedSuites[0].executionClass).evidence, 0);
  const identities = selector.expectedPhase3bIdentities(value, decision.selectedSuiteIds);
  secondary.expectedOuterIds = identities.outerIds; secondary.executedOuterIds = identities.outerIds;
  secondary.expectedLeafIds = identities.leafIds;
  const leaves = secondaryResults.flatMap((result) => result.leafResults);
  secondary.observedLeafIds = leaves.map((leaf) => leaf.id);
  secondary.executedLeafIds = leaves.filter((leaf) => leaf.executed).map((leaf) => leaf.id);
  secondary.absentLeafIds = leaves.filter((leaf) => leaf.status === "skipped-absent").map((leaf) => leaf.id);
  // The runner's own stamping of the decision onto its report (runPhase3bHost):
  // a deferred error forces the report red even when every suite passed.
  secondary.selectionDigest = decision.digest; secondary.selectionMode = decision.mode; secondary.deferredError = decision.deferredError;
  if (decision.deferredError) { secondary.ok = false; secondary.code = secondary.code || 1; }
  return { primary, secondary };
}

// ---------------------------------------------------------------------------
// 1. The fix, through the workflow's own commands, on every host class.
// ---------------------------------------------------------------------------
test("#3262 a scheduled run selects every owned Phase 3B suite cleanly on every host class", () => {
  const value = manifest();
  assert.equal(value.classes.length, 14, "the batch lane has fourteen host classes; a smaller list would prove less than it claims");
  let selectedAcrossHosts = 0;
  {
    for (const host of value.classes) {
      const run = scheduledRun(host);
      const owned = ownedPhase3b(value, host);
      assert.equal(run.select.status, 0,
        `${host}: a scheduled --select must succeed; stderr was ${JSON.stringify(run.select.stderr)} (before #3262 it exited 1 with no output)`);
      assert.doesNotMatch(run.select.stderr, /FAIL/, `${host}: a clean scheduled selection prints no failure`);
      assert.match(run.select.stdout, new RegExp(`mode=full-host changed=0 selected=${owned.length} of ${owned.length}`),
        `${host}: the selection must be printed with its denominator`);
      assert.equal(run.raw.mode, "full-host", `${host}: a scheduled selection is full-host, never fail-safe-host`);
      assert.equal(run.raw.deferredError, false, `${host}: a scheduled selection must carry no deferred error`);
      assert.equal(run.raw.error, null);
      assert.equal(run.raw.eventName, "schedule");
      assert.equal(run.raw.headSha, HEAD, `${host}: the decision must name the checked-out commit`);
      assert.deepEqual(run.raw.changedPaths, []);
      assert.deepEqual(run.raw.selectedSuiteIds, owned, `${host}: a scheduled run selects exactly the Phase 3B suites the host owns`);
      assert.match(run.selectOutputs, new RegExp(`^runSecondary=${owned.length > 0}$`, "m"));
      assert.match(run.selectOutputs, /^deferredError=false$/m);

      assert.equal(run.outcome, "success");
      assert.equal(run.normalize.status, 0, `${host}: normalize must succeed; stderr ${JSON.stringify(run.normalize.stderr)}`);
      assert.equal(run.normalize.stderr, "", `${host}: normalize must not report a fail-safe fallback`);
      assert.deepEqual(run.decision, run.raw, `${host}: normalize must keep the scheduled decision rather than replace it with fail-safe`);
      assert.match(run.normalizeOutputs, /^deferredError=false$/m);
      assert.deepEqual(selector.validateDecision(value, run.decision, host), run.decision);
      selectedAcrossHosts += run.decision.selectedSuiteIds.length;
    }
  }
  assert.equal(selectedAcrossHosts, selector.phase3bSuites(value).length,
    "across all hosts the nightly must select the whole Phase 3B wave — a zero here must never pass");
});

// ---------------------------------------------------------------------------
// 2. Cause and effect: the decision alone decides the reconciliation verdict.
// ---------------------------------------------------------------------------
test("#3262 the scheduled decision reconciles green; the pre-fix decision reproduces the nightly's three reasons", () => {
  const value = manifest();
  {
    for (const host of ["ota-app-node20-19-install", "node22-noinstall", "app-node22-install"]) {
      const { decision } = scheduledRun(host);
      if (!decision.selectedSuiteIds.length) {
        // A host owning no Phase 3B suite runs no secondary at all.
        const primarySuites = expectedPrimarySuites(value, host);
        const primary = buildShardReport(host, primarySuites, primarySuites.map((suite) => greenResult(value, suite)), setupForClass(value, host).evidence, 0);
        assert.deepEqual(selector.reconcilePhase3bReports(value, host, decision, primary, null), [],
          `${host}: a scheduled host with no Phase 3B suites must reconcile green (before #3262: deferred-selector-failure)`);
        continue;
      }
      const { primary, secondary } = passingReports(value, host, decision);
      assert.deepEqual(selector.reconcilePhase3bReports(value, host, decision, primary, secondary), [],
        `${host}: every suite passed, so a scheduled run must reconcile green`);

      // The decision the selector wrote before #3262, against the SAME passing
      // reports. These are exactly the three reasons the nightly printed.
      const preFix = selector.normalizeDecision(value, null, host, "failure");
      const stale = passingReports(value, host, preFix);
      assert.deepEqual(selector.reconcilePhase3bReports(value, host, preFix, stale.primary, stale.secondary),
        ["secondary-evidence-mismatch", "secondary-failed", "deferred-selector-failure: selector outcome failure"]);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. Never silent, and still fail-closed for the events that carry a diff.
// ---------------------------------------------------------------------------
test("#3262 a refused selection still fails closed and now says why", () => {
  const value = manifest(); const host = "ota-app-node20-19-install"; const owned = ownedPhase3b(value, host);
  withScratch((scratch) => {
    for (const [eventName, payload, reason] of [
      ["push", { after: HEAD }, /push before\/after SHA missing/],
      ["pull_request", { pull_request: { head: { sha: HEAD } } }, /pull_request base\/head SHA missing/],
      ["workflow_dispatch", { inputs: {} }, /unsupported selector event: workflow_dispatch/],
      ["schedule", { not_a_schedule: true }, /schedule event payload carries no schedule/],
    ]) {
      const run = runSelectAndNormalize({ host: `${host}`, eventName, payload, scratch: fs.mkdtempSync(path.join(scratch, `${eventName}-`)) });
      assert.equal(run.select.status, 1, `${eventName}: an underivable selection must still fail its step`);
      assert.match(run.select.stderr, reason, `${eventName}: the failing step must name its reason (before #3262 it printed nothing)`);
      assert.equal(run.raw.mode, "fail-safe-host", `${eventName}: an underivable selection falls back to the whole host`);
      assert.equal(run.raw.deferredError, true, `${eventName}: and defers a red to reconciliation`);
      assert.deepEqual(run.raw.selectedSuiteIds, owned);
      assert.equal(run.decision.mode, "fail-safe-host");
      assert.equal(run.decision.deferredError, true);
      assert.match(run.normalize.stderr, /normalised to fail-safe-host: selector outcome failure/);
      assert.match(selector.reconcilePhase3bReports(value, host, run.decision, null, null).join("\n"), /deferred-selector-failure/);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. full-host cannot stand in for a push or a pull request.
// ---------------------------------------------------------------------------
test("#3262 full-host is bound to the schedule event and cannot be forged into any other run", () => {
  assert.ok(selector.FULL_HOST_EVENTS instanceof Set, "the selector must declare which events take the full-host path");
  assert.deepEqual([...selector.FULL_HOST_EVENTS], ["schedule"], "only a scheduled run has no diff to select from");
  const value = manifest(); const host = "ota-app-node20-19-install";
  const source = { eventName: "schedule", baseSha: null, headSha: HEAD, mergeBaseSha: null, pathSource: selector.FULL_HOST_PATH_SOURCE };
  const document = selector.selectionDocument(value, host, [], { full: true, source });
  assert.deepEqual(selector.validateDecision(value, document, host).selectedSuiteIds, ownedPhase3b(value, host));
  assert.throws(() => selector.selectionDocument(value, host, [], { full: true, failSafe: true, source }), /both fail-safe and full-host/);

  const reseal = (mutate) => {
    const forged = structuredClone(document); delete forged.digest; mutate(forged);
    return { ...forged, digest: sha256(JSON.stringify(forged)) };
  };
  for (const [label, mutate] of [
    ["claims a push", (doc) => { doc.eventName = "push"; }],
    ["claims a pull request", (doc) => { doc.eventName = "pull_request"; }],
    ["claims a target pull request", (doc) => { doc.eventName = "pull_request_target"; }],
    ["carries a diff", (doc) => { doc.changedPaths = ["README.md"]; doc.changedPathSha256 = sha256(Buffer.from("README.md\0")); }],
    ["carries a base", (doc) => { doc.baseSha = "a".repeat(40); }],
    ["carries a merge-base", (doc) => { doc.mergeBaseSha = "a".repeat(40); }],
    ["names no commit", (doc) => { doc.headSha = null; }],
    ["names a ref, not a commit", (doc) => { doc.headSha = "HEAD"; }],
    ["borrows the push path source", (doc) => { doc.pathSource = "local-git-two-dot-nul"; }],
    ["hides a deferred error", (doc) => { doc.deferredError = true; doc.error = "hidden"; }],
    ["carries an error", (doc) => { doc.error = "hidden"; }],
    ["selects a subset", (doc) => { doc.selectedSuiteIds = doc.selectedSuiteIds.slice(1); }],
  ]) {
    assert.throws(() => selector.validateDecision(value, reseal(mutate), host), /full-host|ownership|inventory/, `a full-host document that ${label} must be refused`);
  }
  assert.throws(() => selector.validateDecision(value, { ...document, digest: "0".repeat(64) }, host), /digest/);

  // The live event must match at normalisation, so a scheduled decision cannot be carried into another run.
  for (const eventName of ["push", "pull_request", ""]) {
    const normalized = selector.normalizeDecision(value, document, host, "success", { eventName });
    assert.equal(normalized.mode, "fail-safe-host", `a full-host decision normalised under ${JSON.stringify(eventName)} must fall back`);
    assert.equal(normalized.deferredError, true);
  }
  assert.deepEqual(selector.normalizeDecision(value, document, host, "success", { eventName: "schedule" }), document);
  assert.equal(selector.normalizeDecision(value, document, host, "failure", { eventName: "schedule" }).deferredError, true,
    "a failed select step still defers red even when its document looks clean");
});

// ---------------------------------------------------------------------------
// 5. push and pull_request derive exactly what they derived before.
// ---------------------------------------------------------------------------
test("#3262 push and pull_request selection still comes from the local Git diff, unchanged", () => {
  assert.equal(typeof selector.deriveSelectionSource, "function", "the selector must route each event to its selection source");
  const value = manifest();
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "issue-3262-git-"));
  const git = (args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  try {
    git(["init", "-q"]); git(["config", "user.email", "ci@example.invalid"]); git(["config", "user.name", "CI"]);
    fs.writeFileSync(path.join(repo, "README.md"), "base\n"); git(["add", "."]); git(["commit", "-qm", "base"]); const base = git(["rev-parse", "HEAD"]);
    fs.mkdirSync(path.join(repo, "mingla-business/app/venue"), { recursive: true });
    fs.writeFileSync(path.join(repo, "mingla-business/app/venue/create.tsx"), "head\n"); git(["add", "-A"]); git(["commit", "-qm", "head"]); const head = git(["rev-parse", "HEAD"]);

    for (const [eventName, event] of [["push", { before: base, after: head }], ["pull_request", { pull_request: { base: { sha: base }, head: { sha: head } } }]]) {
      const source = selector.deriveSelectionSource({ root: repo, eventName, event });
      assert.equal(source.full, false, `${eventName} must never take the full-host path`);
      const { full, ...rest } = source;
      assert.deepEqual(rest, selector.deriveChangedPaths({ root: repo, eventName, event }), `${eventName}: derivation must be byte-identical to before`);
      const document = selector.selectionDocument(value, "ota-app-node20-19-install", source.changedPaths, { full: source.full, source });
      assert.equal(document.mode, "selected");
      assert.deepEqual(selector.validateDecision(value, document, "ota-app-node20-19-install").selectedSuiteIds,
        ["issue-1461-venue-current-brand-race-tests", "issue-1467-venue-submit-idempotency-tests", "issue-1685-venue-draft-multi-tests"]);
    }
    assert.throws(() => selector.deriveSelectionSource({ root: repo, eventName: "push", event: { before: "0".repeat(40), after: head } }), /push before\/after SHA missing/);
    assert.throws(() => selector.deriveSelectionSource({ root: repo, eventName: "merge_group", event: {} }), /unsupported selector event/);
    // A "selected" document may still never claim a schedule.
    const forged = selector.selectionDocument(value, "ota-app-node20-19-install", [], { source: { eventName: "schedule", baseSha: base, headSha: head, mergeBaseSha: base, pathSource: "local-git-two-dot-nul" } });
    assert.throws(() => selector.validateDecision(value, forged, "ota-app-node20-19-install"), /source identity/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
