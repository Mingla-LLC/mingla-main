// Issue #2871 independent tester regression proof.
//
// The implementor suite is a durable current-tree invariant, not a replay of
// #2851's historical pull-request diff. This test executes that real suite in
// two isolated git topologies and proves the retired origin/main comparison
// rejects an unrelated branch even though no workflow changed.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const WORKFLOW_DIR = ".github/workflows";
const IMPLEMENTOR_PATH = ".github/scripts/strict-grep/issue-2851-pr-concurrency-policy.implementor.test.mjs";
const GUARD_PATH = ".github/scripts/strict-grep/issue-2851-pr-concurrency-policy.mjs";
const MANIFEST_PATH = ".github/scripts/strict-grep/MANIFEST.json";
const TESTER_PATH = ".github/scripts/strict-grep/issue-2871-concurrency-proof-event-independence.tester.test.mjs";

function run(command, args, cwd) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function requireSuccess(result, label) {
  assert.equal(
    result.status,
    0,
    `${label} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

function git(root, ...args) {
  const result = run("git", args, root);
  requireSuccess(result, `git ${args.join(" ")}`);
  return result.stdout.trim();
}

function copyFile(root, repositoryPath) {
  const destination = path.join(root, repositoryPath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, repositoryPath), destination);
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mingla-2871-event-safe-"));
  fs.cpSync(path.join(REPO_ROOT, WORKFLOW_DIR), path.join(root, WORKFLOW_DIR), { recursive: true });
  copyFile(root, IMPLEMENTOR_PATH);
  copyFile(root, GUARD_PATH);
  copyFile(root, MANIFEST_PATH);

  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "issue-2871-tester@invalid.example");
  git(root, "config", "user.name", "Issue 2871 Tester");
  git(root, "add", ".github");
  git(root, "commit", "-m", "fixture: current protected tree");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  return root;
}

function runImplementorContextAssertions(root) {
  // The full 10-test implementor suite is already a separate Class A entry.
  // Re-run only the two assertions that previously depended on git history so
  // this independent proof does not duplicate six expensive policy mutations.
  return run(process.execPath, [
    "--test",
    "--test-name-pattern=the real tree independently classifies|the seven non-PR workflows",
    IMPLEMENTOR_PATH,
  ], root);
}

function combinedOutput(result) {
  return `${result.stdout}\n${result.stderr}`;
}

test("the implementor context assertions pass at remote-main identity and after an unrelated branch commit", (t) => {
  const implementorSource = fs.readFileSync(path.join(REPO_ROOT, IMPLEMENTOR_PATH), "utf8");
  assert.doesNotMatch(implementorSource, /["']origin\/main["']/);
  assert.doesNotMatch(implementorSource, /function git\s*\(/);
  assert.doesNotMatch(implementorSource, /baseWorkflowSources\s*\(/);
  assert.doesNotMatch(implementorSource, /git\("diff"/);

  const root = createFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(git(root, "rev-parse", "HEAD"), git(root, "rev-parse", "origin/main"));
  const mainResult = runImplementorContextAssertions(root);
  requireSuccess(mainResult, "implementor context assertions with HEAD equal to origin/main");
  assert.match(combinedOutput(mainResult), /pass 2/);

  git(root, "switch", "-c", "unrelated-change");
  fs.writeFileSync(path.join(root, "UNRELATED.txt"), "This file does not affect workflow policy.\n");
  git(root, "add", "UNRELATED.txt");
  git(root, "commit", "-m", "fixture: unrelated one-file change");
  assert.notEqual(git(root, "rev-parse", "HEAD"), git(root, "rev-parse", "origin/main"));

  const branchResult = runImplementorContextAssertions(root);
  requireSuccess(branchResult, "implementor context assertions after unrelated one-file branch change");
  assert.match(combinedOutput(branchResult), /pass 2/);

  const changedWorkflows = git(root, "diff", "--name-only", "origin/main", "--", WORKFLOW_DIR)
    .split("\n").filter(Boolean);
  assert.deepEqual(changedWorkflows, []);

  const historicalComparison = run(process.execPath, [
    "-e",
    [
      "const { strict: assert } = require('node:assert');",
      "const { execFileSync } = require('node:child_process');",
      `const changed = execFileSync('git', ['diff', '--name-only', 'origin/main', '--', '${WORKFLOW_DIR}'], { encoding: 'utf8' }).trim().split('\\n').filter(Boolean);`,
      "assert.equal(changed.length, 123, 'pre-fix comparison required the historical 123-workflow PR diff');",
    ].join("\n"),
  ], root);
  assert.notEqual(historicalComparison.status, 0, "the pre-fix origin/main comparison unexpectedly accepted an unrelated branch");
  assert.match(
    `${historicalComparison.stdout}\n${historicalComparison.stderr}`,
    /pre-fix comparison required the historical 123-workflow PR diff/,
  );
});

test("the independent event-context proof is registered in Class A", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, MANIFEST_PATH), "utf8"));
  const matches = manifest.gates.filter((entry) => entry.script === TESTER_PATH);
  assert.deepEqual(matches, [{
    script: TESTER_PATH,
    kind: "file",
    enforcement: "batch:A",
    invocation: "node --test",
    modes: ["plain"],
    selfTest: "none",
    jobKeys: ["issue-2871-concurrency-proof-event-independence-tester"],
  }]);
});
