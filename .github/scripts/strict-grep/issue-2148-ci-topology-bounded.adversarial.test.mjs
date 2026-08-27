/**
 * Issue #2431 implementor-owned happy-path proof for the Phase-0 topology brake.
 * The filename is fixed by the approved child SPEC; the independent tester may
 * append different-angle bypass cases during TEST.
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  evaluateWorkflowTopology,
  validApproval,
} from "./issue-2148-ci-topology-bounded.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const GATE = path.join(HERE, "issue-2148-ci-topology-bounded.mjs");
const STRICT_WORKFLOW = path.join(REPO_ROOT, ".github/workflows/strict-grep-mingla-business.yml");

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function fixtureRepo({ workflow, commitBody }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "issue-2431-topology-"));
  run("git", ["init", "-q"], root);
  run("git", ["config", "user.email", "ci-topology@example.invalid"], root);
  run("git", ["config", "user.name", "CI topology test"], root);
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n");
  run("git", ["add", "README.md"], root);
  run("git", ["commit", "-q", "-m", "baseline"], root);
  const base = run("git", ["rev-parse", "HEAD"], root);
  const gateTarget = path.join(root, ".github/scripts/strict-grep/issue-2148-ci-topology-bounded.mjs");
  fs.mkdirSync(path.dirname(gateTarget), { recursive: true });
  fs.copyFileSync(GATE, gateTarget);
  const workflowTarget = path.join(root, workflow);
  fs.mkdirSync(path.dirname(workflowTarget), { recursive: true });
  fs.writeFileSync(workflowTarget, "name: fixture\non: pull_request\njobs: {}\n");
  run("git", ["add", ".github"], root);
  run("git", ["commit", "-q", "-m", commitBody], root);
  return { root, base, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function runGate(root, base) {
  return spawnSync(
    process.execPath,
    [".github/scripts/strict-grep/issue-2148-ci-topology-bounded.mjs", "--base", base, "--head", "HEAD"],
    { cwd: root, encoding: "utf8" },
  );
}

test("valid stable capability workflow with the explicit exception contract passes", () => {
  const workflow = ".github/workflows/business-web-build.yml";
  const token =
    "CI-WORKFLOW-APPROVED #2431: required status context cannot be supplied by an existing stable workflow";
  assert.equal(validApproval(token), true);
  assert.deepEqual(
    evaluateWorkflowTopology({
      addedWorkflows: [workflow],
      touchingCommitBodies: { [workflow]: [token] },
    }),
    [],
  );

  const fixture = fixtureRepo({ workflow, commitBody: token });
  try {
    const result = runGate(fixture.root, fixture.base);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /1 added workflow\(s\)/);
  } finally {
    fixture.cleanup();
  }
});

test("a real issue-named workflow addition is rejected even with a valid exception token", () => {
  const fixture = fixtureRepo({
    workflow: ".github/workflows/issue-9999-tests.yml",
    commitBody:
      "CI-WORKFLOW-APPROVED #9999: required status context cannot be supplied by an existing stable workflow",
  });
  try {
    const result = runGate(fixture.root, fixture.base);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /issue\/ORCH\/META workflow wrappers are forbidden/);
  } finally {
    fixture.cleanup();
  }
});

test("strict batch trigger covers workflow-only diffs on PR and push", () => {
  const source = fs.readFileSync(STRICT_WORKFLOW, "utf8");
  const triggerBlock = source.slice(0, source.indexOf("\nconcurrency:"));
  const matches = triggerBlock.match(/- "\.github\/workflows\/\*\*"/g) ?? [];
  assert.equal(matches.length, 2, "workflow glob must appear once in pull_request.paths and once in push.paths");
  assert.match(triggerBlock, /pull_request:[\s\S]*?- "\.github\/workflows\/\*\*"/);
  assert.match(triggerBlock, /push:[\s\S]*?- "\.github\/workflows\/\*\*"/);
  assert.match(source, /name: "Strict grep — static gates \(class A\)"/);
  assert.match(source, /name: "Strict grep — dependency gates \(class B\)"/);
});

/**
 * Issue #2681 — the added-workflow set is computed against the MERGE BASE of the
 * base branch and the head, not against the base branch tip.
 *
 * `fixtureRepo` above builds LINEAR history (base is an ancestor of HEAD), where
 * `git diff A B` and `git diff A...B` are identical — so it cannot express this
 * class of defect at all. These cases need genuinely DIVERGENT history, so they
 * get their own builder rather than a change to the shared one.
 *
 * Every case drives the gate with `base = the base branch TIP`, which is what
 * `pull_request.base.sha` actually supplies in CI. Handing the gate a
 * pre-computed merge base would prove nothing about the bug.
 */

const DIVERGENT_WRAPPERS = Array.from(
  { length: 9 },
  (_unused, index) => `.github/workflows/issue-${1001 + index}-suite.yml`,
);

function writeWorkflow(root, relativePath, body) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
  return target;
}

function initFixture(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  run("git", ["init", "-q"], root);
  run("git", ["config", "user.email", "ci-topology@example.invalid"], root);
  run("git", ["config", "user.name", "CI topology test"], root);
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n");
  // The gate must exist on EVERY commit of both lines of history, because
  // `runGate` executes it from whichever tree is checked out.
  const gateTarget = path.join(root, ".github/scripts/strict-grep/issue-2148-ci-topology-bounded.mjs");
  fs.mkdirSync(path.dirname(gateTarget), { recursive: true });
  fs.copyFileSync(GATE, gateTarget);
  run("git", ["add", "."], root);
  run("git", ["commit", "-q", "-m", "baseline"], root);
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/**
 * Mirrors #2591 exactly: nine wrappers live on the base branch, a branch is cut
 * while they are still there, the base branch then DELETES them, and the branch
 * goes on to do unrelated work. The branch has added nothing — merging it would
 * not resurrect a single file — but a tip-to-tip diff blames it for all nine.
 */
function divergentRepo({ branchWorkflow = null } = {}) {
  const { root, cleanup } = initFixture("issue-2681-divergent-");

  for (const wrapper of DIVERGENT_WRAPPERS) {
    writeWorkflow(root, wrapper, "name: historical wrapper\non: pull_request\njobs: {}\n");
  }
  run("git", ["add", ".github/workflows"], root);
  run("git", ["commit", "-q", "-m", "land the historical issue wrappers"], root);

  // The branch is cut HERE — before the deletion.
  run("git", ["branch", "stale"], root);

  for (const wrapper of DIVERGENT_WRAPPERS) {
    run("git", ["rm", "-q", wrapper], root);
  }
  run("git", ["commit", "-q", "-m", "delete the historical issue wrappers"], root);
  const baseTip = run("git", ["rev-parse", "HEAD"], root);

  run("git", ["checkout", "-q", "stale"], root);
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/note.md"), "branch work\n");
  run("git", ["add", "docs/note.md"], root);
  if (branchWorkflow) {
    writeWorkflow(root, branchWorkflow, "name: branch wrapper\non: pull_request\njobs: {}\n");
    run("git", ["add", branchWorkflow], root);
  }
  run("git", ["commit", "-q", "-m", "branch work"], root);

  return { root, baseTip, cleanup };
}

test("#2681: a branch cut before a workflow deletion is not blamed for adding it", () => {
  const fixture = divergentRepo();
  try {
    const result = runGate(fixture.root, fixture.baseTip);
    // Status FIRST and on its own: /0 added workflow\(s\)/ also matches the
    // string "10 added workflow(s)", so the exit code is what makes this honest.
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /\b0 added workflow\(s\)/);
    assert.doesNotMatch(result.stderr, /issue-1001-suite\.yml/);
  } finally {
    fixture.cleanup();
  }
});

test("#2681: a stale branch that genuinely adds a wrapper still fails, on that file alone", () => {
  const branchWorkflow = ".github/workflows/issue-8888-mine.yml";
  const fixture = divergentRepo({ branchWorkflow });
  try {
    const result = runGate(fixture.root, fixture.baseTip);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /\b1 added workflow\(s\)/);
    assert.match(result.stderr, /issue-8888-mine\.yml/);
    assert.match(result.stderr, /issue\/ORCH\/META workflow wrappers are forbidden/);
    // The nine files the branch never touched must not be named.
    assert.doesNotMatch(result.stderr, /issue-1001-suite\.yml/);
  } finally {
    fixture.cleanup();
  }
});

test("#2681: an addition whose path already exists on the base branch is still an addition", () => {
  // The fail-OPEN direction. `--diff-filter=A` can only fire when the path is
  // ABSENT at the comparison point, so against the base branch TIP a branch that
  // genuinely adds a forbidden wrapper at a path the base branch already carries
  // is invisible and PASSES. Against the merge base the path is absent, and the
  // addition is seen. This is the half that fails silently, so it is pinned too.
  const workflow = ".github/workflows/issue-7000-both.yml";
  const { root, cleanup } = initFixture("issue-2681-convergent-");
  try {
    run("git", ["branch", "converging"], root);

    writeWorkflow(root, workflow, "name: base branch copy\non: pull_request\njobs: {}\n");
    run("git", ["add", workflow], root);
    run("git", ["commit", "-q", "-m", "base branch adds the wrapper"], root);
    const baseTip = run("git", ["rev-parse", "HEAD"], root);

    run("git", ["checkout", "-q", "converging"], root);
    writeWorkflow(root, workflow, "name: branch copy\non: pull_request\njobs: {}\n");
    run("git", ["add", workflow], root);
    run("git", ["commit", "-q", "-m", "branch independently adds the same wrapper"], root);

    const result = runGate(root, baseTip);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /\b1 added workflow\(s\)/);
    assert.match(result.stderr, /issue-7000-both\.yml/);
    assert.match(result.stderr, /issue\/ORCH\/META workflow wrappers are forbidden/);
  } finally {
    cleanup();
  }
});
