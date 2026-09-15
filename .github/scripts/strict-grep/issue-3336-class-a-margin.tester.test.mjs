// #3336 tester-owned adversarial proof: each validation observes fresh Git-index
// truth, an unrelated outer scope cannot leak across roots, and the out-of-band
// readiness report preserves the constitutional and cancellation classifications.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  trackedFilesProcessInvocations,
  validateRegistry,
  withTrackedFilesScope,
} from "../ci-batch/validate-manifest-v2.mjs";
import {
  adjudicateWithReadiness,
  formatCombinedVerdict,
  READINESS_ROWS,
  VERDICTS,
} from "./issue-2594-class-a-budget.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const REGISTRY = ".github/ci-batch/MANIFEST.json";
const WORKFLOW_DIRECTORY = ".github/workflows";
const PROBE = "scripts/ci/issue3336-provider-authority-probe.mjs";
const GIT_IDENTITY = ["-c", "user.email=ci@example.invalid", "-c", "user.name=CI"];

function git(root, args) {
  return execFileSync("git", [...GIT_IDENTITY, ...args], { cwd: root, stdio: "pipe" });
}

function cloneFixture(prefix) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const clone = path.join(parent, "repo");
  execFileSync("git", ["clone", "-q", "--no-hardlinks", ROOT, clone], { stdio: "pipe" });
  return { parent, root: fs.realpathSync(clone) };
}

function readRegistry(root) {
  return JSON.parse(fs.readFileSync(path.join(root, REGISTRY), "utf8"));
}

function selectLiveRegisteredProvider(root, registry) {
  const candidates = registry.workflowProviders
    .filter((item) => item.transition === "retained-live-provider")
    .filter((item) => typeof item.workflow === "string")
    .filter((item) => fs.existsSync(path.join(root, WORKFLOW_DIRECTORY, item.workflow)))
    .sort((left, right) => left.workflow.localeCompare(right.workflow));
  assert.ok(candidates.length > 0, "the live registry must expose a retained provider for the mutation probe");
  return candidates[Math.floor(candidates.length / 2)];
}

function addProviderReference(root, provider) {
  const absolute = path.join(root, PROBE);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `export const provider = ${JSON.stringify(provider.workflow)};\n`);
  git(root, ["add", PROBE]);
  git(root, ["commit", "-qm", "add provider authority probe"]);
}

function removeProviderReference(root) {
  git(root, ["rm", "-q", PROBE]);
  git(root, ["commit", "-qm", "remove provider authority probe"]);
}

function assertProviderDrift(errors, provider) {
  assert.ok(
    errors.some((error) => error.includes("workflow provider authority drifted")),
    `committed provider reference must move frozen authority; errors were:\n${errors.join("\n")}`,
  );
  assert.ok(
    errors.some((error) => error.includes(`${provider.workflow}: external reference file inventory drifted`)),
    `committed provider reference must disagree with the registered inventory; errors were:\n${errors.join("\n")}`,
  );
}

test("committed A to B to A truth stays fresh inside an outer scope for a different root", () => {
  const fixture = cloneFixture("issue3336-wrong-root-");
  try {
    const sourceRoot = fs.realpathSync(ROOT);
    assert.notEqual(sourceRoot, fixture.root, "the wrong-root attack requires distinct resolved roots A and B");

    const registry = readRegistry(fixture.root);
    const provider = selectLiveRegisteredProvider(fixture.root, registry);
    const processesBefore = trackedFilesProcessInvocations();

    const observations = withTrackedFilesScope(sourceRoot, () => {
      const baseline = validateRegistry(registry, { root: fixture.root });
      addProviderReference(fixture.root, provider);
      const added = validateRegistry(registry, { root: fixture.root });
      removeProviderReference(fixture.root);
      const restored = validateRegistry(registry, { root: fixture.root });
      return { baseline, added, restored };
    });

    assert.deepEqual(observations.baseline, [], "root B must validate from its own initial listing");
    assertProviderDrift(observations.added, provider);
    assert.deepEqual(observations.restored, [], "root B must see the later removal despite root A's outer scope");
    assert.equal(
      trackedFilesProcessInvocations() - processesBefore,
      3,
      "the mismatched root A scope must not be reused by any validation of root B",
    );
  } finally {
    fs.rmSync(fixture.parent, { recursive: true, force: true });
  }
});

const CLASS_A = "Strict grep — static gates (class A)";
const START = "2026-09-15T12:00:00Z";
const RUNNING_RUN = { id: 3336, status: "in_progress", conclusion: null };

function actionJob({ conclusion = "success", completedAt, name = CLASS_A }) {
  return {
    id: Number(completedAt.replace(/\D/g, "").slice(-8)),
    name,
    status: "completed",
    conclusion,
    started_at: START,
    completed_at: completedAt,
  };
}

function combined(jobs, run = RUNNING_RUN) {
  const result = adjudicateWithReadiness({
    jobs,
    run,
    jobName: CLASS_A,
    budgetSeconds: 600,
    timeoutKillSeconds: 890,
  });
  const report = formatCombinedVerdict(result, { jobName: CLASS_A, budgetSeconds: 600 });
  return { result, report };
}

test("raw Actions records preserve all boundaries and report three distinct failure reasons", () => {
  const at540 = combined([actionJob({ completedAt: "2026-09-15T12:09:00Z" })]);
  assert.deepEqual(
    [at540.result.core.row, at540.result.readiness.row, at540.result.exit],
    ["D4", READINESS_ROWS.PASS, 0],
  );
  assert.match(at540.report, /\[issue-3336\] R0 READINESS PASS \(final exit 0\)/);

  for (const completedAt of ["2026-09-15T12:09:01Z", "2026-09-15T12:10:00Z"]) {
    const margin = combined([actionJob({ completedAt })]);
    assert.deepEqual(
      [margin.result.core.row, margin.result.core.verdict, margin.result.readiness.row, margin.result.exit],
      ["D4", VERDICTS.PASS, READINESS_ROWS.FAIL, 1],
    );
    assert.match(margin.report, /\[issue-3336\] R1 READINESS-MARGIN FAIL \(final exit 1\)/);
    assert.match(margin.report, /constitutional bound was not crossed/);
    assert.doesNotMatch(margin.report, /\[issue-2594\] D3 FAIL|\[issue-2594\] D6 FAIL/);
  }

  const constitutional = combined([actionJob({ completedAt: "2026-09-15T12:10:01Z" })]);
  assert.deepEqual(
    [constitutional.result.core.row, constitutional.result.readiness.row, constitutional.result.exit],
    ["D3", READINESS_ROWS.NOT_EVALUATED, 1],
  );
  assert.match(constitutional.report, /\[issue-2594\] D3 FAIL/);
  assert.match(constitutional.report, /readiness not evaluated; the constitutional breach controls/);
  assert.doesNotMatch(constitutional.report, /R1 READINESS-MARGIN FAIL|\[issue-2594\] D6 FAIL/);

  const timeout = combined([
    actionJob({ conclusion: "cancelled", completedAt: "2026-09-15T12:15:00Z" }),
  ]);
  assert.deepEqual(
    [timeout.result.core.row, timeout.result.readiness.row, timeout.result.exit],
    ["D6", READINESS_ROWS.NOT_EVALUATED, 1],
  );
  assert.match(timeout.report, /\[issue-2594\] D6 FAIL/);
  assert.match(timeout.report, /hard-timeout cancellation controls/);
  assert.match(timeout.report, /890s kill floor and at its 900s cap/);
  assert.doesNotMatch(timeout.report, /R1 READINESS-MARGIN FAIL|\[issue-2594\] D3 FAIL/);

  const unavailable = combined([]);
  assert.deepEqual(
    [unavailable.result.core.row, unavailable.result.readiness.row, unavailable.result.exit],
    ["D0", READINESS_ROWS.NOT_EVALUATED, 2],
  );

  const failedClassA = combined([
    actionJob({ conclusion: "failure", completedAt: "2026-09-15T12:05:00Z" }),
  ]);
  assert.deepEqual(
    [failedClassA.result.core.row, failedClassA.result.readiness.row, failedClassA.result.exit],
    ["D2", READINESS_ROWS.NOT_EVALUATED, 0],
  );

  const eviction = combined(
    [actionJob({ conclusion: "cancelled", completedAt: "2026-09-15T12:05:00Z" })],
    { id: 3336, status: "completed", conclusion: "cancelled" },
  );
  assert.deepEqual(
    [eviction.result.core.row, eviction.result.readiness.row, eviction.result.exit],
    ["D5", READINESS_ROWS.NOT_EVALUATED, 0],
  );
});
