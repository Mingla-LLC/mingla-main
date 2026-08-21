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
