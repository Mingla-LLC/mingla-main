/**
 * Issue #2431 tester-owned adversarial proof.
 *
 * This attacks the real Git history boundary across multiple commits: an
 * approval token in an unrelated commit/file must not authorize a workflow,
 * while a later token-bearing commit that actually touches that workflow may.
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(HERE, "issue-2148-ci-topology-bounded.mjs");

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commit(root, message, paths) {
  run("git", ["add", ...paths], root);
  run("git", ["commit", "-q", "-m", message], root);
}

function runGate(root, base) {
  return spawnSync(
    process.execPath,
    [".github/scripts/strict-grep/issue-2148-ci-topology-bounded.mjs", "--base", base, "--head", "HEAD"],
    { cwd: root, encoding: "utf8" },
  );
}

test("approval is attributed to the workflow across a multi-commit PR range", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "issue-2431-tester-attribution-"));
  const workflow = ".github/workflows/business-web-build.yml";
  const token =
    "CI-WORKFLOW-APPROVED #2431: required status context cannot be supplied by an existing stable workflow";

  try {
    run("git", ["init", "-q"], root);
    run("git", ["config", "user.email", "ci-topology-tester@example.invalid"], root);
    run("git", ["config", "user.name", "CI topology tester"], root);

    fs.writeFileSync(path.join(root, "README.md"), "baseline\n");
    commit(root, "baseline", ["README.md"]);
    const base = run("git", ["rev-parse", "HEAD"], root);

    const gateTarget = path.join(root, ".github/scripts/strict-grep/issue-2148-ci-topology-bounded.mjs");
    fs.mkdirSync(path.dirname(gateTarget), { recursive: true });
    fs.copyFileSync(GATE, gateTarget);
    fs.appendFileSync(path.join(root, "README.md"), "unrelated approval\n");
    commit(root, token, ["README.md", ".github/scripts/strict-grep/issue-2148-ci-topology-bounded.mjs"]);

    const workflowTarget = path.join(root, workflow);
    fs.mkdirSync(path.dirname(workflowTarget), { recursive: true });
    fs.writeFileSync(workflowTarget, "name: fixture\non: pull_request\njobs: {}\n");
    commit(root, "add ordinary capability workflow", [workflow]);

    const unrelated = runGate(root, base);
    assert.equal(unrelated.status, 1, `${unrelated.stdout}\n${unrelated.stderr}`);
    assert.match(unrelated.stderr, /no valid approval token in a PR-range commit touching this file/);

    fs.appendFileSync(workflowTarget, "# reviewed boundary\n");
    commit(root, token, [workflow]);

    const attributed = runGate(root, base);
    assert.equal(attributed.status, 0, `${attributed.stdout}\n${attributed.stderr}`);
    assert.match(attributed.stdout, /1 added workflow\(s\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("missing comparison history fails inconclusive instead of passing vacuously", () => {
  const result = spawnSync(
    process.execPath,
    [GATE, "--base", "0000000000000000000000000000000000000001", "--head", "HEAD"],
    { cwd: path.resolve(HERE, "../../.."), encoding: "utf8" },
  );
  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /cannot establish a complete comparison history/);
});
