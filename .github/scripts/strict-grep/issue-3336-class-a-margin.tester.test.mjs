// #3336 tester-owned adversarial proof: each validation observes fresh Git-index
// truth, an unrelated outer scope cannot leak across roots, and the out-of-band
// readiness report preserves the constitutional and cancellation classifications.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

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

// [#3336 Amendment 3] Clone over file:// at depth 1, never `--no-hardlinks <path>`.
// A CI checkout is shallow, and an earlier Class A gate (the #2148 topology gate's
// ensureComparisonHistory) deepens it with `--filter=blob:none`, leaving older
// commits without their file contents. A path clone of a shallow source goes through
// upload-pack, which must pack that whole history and aborts with "possible
// repository corruption". A depth-1 file:// clone needs only HEAD's own objects,
// only reads the source, and works whether the source HEAD is a branch or detached.
function cloneFixture(prefix, source = ROOT) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const clone = path.join(parent, "repo");
  try {
    execFileSync("git", ["clone", "-q", "--depth", "1", "--no-tags", pathToFileURL(source).href, clone], {
      stdio: "pipe",
    });
  } catch (error) {
    fs.rmSync(parent, { recursive: true, force: true });
    throw error;
  }
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

// [#3336 Amendment 3] Regression: reproduce the CI checkout that broke the legacy
// clone on main (run 35175924177), then prove the production fixture clone copes.
const LEGACY_CLONE_HAZARD = /pack-objects died|repository corruption/;

function checkoutState(root) {
  return [
    git(root, ["show-ref", "--head"]).toString(),
    fs.readFileSync(path.join(root, ".git", "config"), "utf8"),
    fs.readFileSync(path.join(root, ".git", "shallow"), "utf8"),
  ].join("\n--\n");
}

function headTree(root) {
  return git(root, ["rev-parse", "HEAD^{tree}"]).toString().trim();
}

test("fixture clones stay whole from a shallow checkout deepened without file contents", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "issue3336-incomplete-checkout-"));
  const fixtures = [];
  try {
    const source = path.join(scratch, "source");
    fs.mkdirSync(source);
    git(source, ["init", "-q", "-b", "main"]);
    git(source, ["config", "uploadpack.allowFilter", "true"]);
    for (let revision = 1; revision <= 4; revision += 1) {
      fs.writeFileSync(path.join(source, "tracked.txt"), `revision ${revision}\n`);
      git(source, ["add", "tracked.txt"]);
      git(source, ["commit", "-qm", `revision ${revision}`]);
    }

    // A depth-1 checkout on a branch (push) or detached with no local branch
    // (pull_request), then the topology gate's blobless deepen, shallower than history.
    const workspaces = ["branch", "detached"].map((shape) => {
      const workspace = path.join(scratch, `workspace-${shape}`);
      git(scratch, ["clone", "-q", "--depth", "1", "--no-tags", pathToFileURL(source).href, workspace]);
      if (shape === "detached") {
        git(workspace, ["checkout", "-q", "--detach"]);
        git(workspace, ["branch", "-q", "-D", "main"]);
      }
      git(workspace, [
        "fetch",
        "-q",
        "--no-tags",
        "--filter=blob:none",
        "--depth=2",
        "origin",
        "+refs/heads/main:refs/remotes/origin/main",
      ]);
      assert.equal(
        git(workspace, ["rev-parse", "--is-shallow-repository"]).toString().trim(),
        "true",
        `${shape}: the deepened workspace must still be shallow`,
      );
      return { shape, workspace };
    });
    fs.rmSync(source, { recursive: true, force: true });

    for (const { shape, workspace } of workspaces) {
      assert.throws(
        () =>
          execFileSync("git", ["clone", "-q", "--no-hardlinks", workspace, path.join(scratch, `legacy-${shape}`)], {
            stdio: "pipe",
          }),
        (error) => LEGACY_CLONE_HAZARD.test(String(error.stderr)),
        `${shape}: the legacy path clone must hit the incomplete-checkout hazard, or this fixture proves nothing`,
      );

      const before = checkoutState(workspace);
      let fixture;
      assert.doesNotThrow(() => {
        fixture = cloneFixture(`issue3336-incomplete-${shape}-`, workspace);
      }, `${shape}: the production fixture clone must succeed from an incomplete shallow checkout`);
      fixtures.push(fixture);
      assert.equal(headTree(fixture.root), headTree(workspace), `${shape}: the fixture clone must reproduce HEAD's tree`);
      assert.equal(checkoutState(workspace), before, `${shape}: fixture cloning must not write to its source checkout`);
    }
  } finally {
    for (const fixture of fixtures) fs.rmSync(fixture.parent, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
