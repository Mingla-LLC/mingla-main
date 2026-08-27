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

/**
 * Issue #2681 — tester-owned adversarial half of the merge-base comparison fix.
 *
 * The implementor's three cases (in the .adversarial file) all drive the gate
 * with `--base <sha> --head HEAD` inside a single FULL local repository. They
 * prove the added set is now merge-base relative. They do not touch the claim
 * the whole fix rests on: that `ensureComparisonHistory` guarantees the merge
 * base is computable — or the gate exits 2 — so three dots can never silently
 * compare against something other than the true fork point.
 *
 * These cases attack that precondition instead, through real SHALLOW clones
 * served over a `file://` remote and through the event-driven code path CI
 * actually takes, plus the canonical registry/token path the implementor's
 * fixtures cannot reach at all (they are noncanonical fixtures).
 */

const TESTER_PHANTOM_WRAPPERS = Array.from(
  { length: 9 },
  (_unused, index) => `.github/workflows/issue-${2001 + index}-suite.yml`,
);

function testerWrite(root, relativePath, body) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
}

function testerFixture(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  run("git", ["init", "-q"], root);
  run("git", ["config", "user.email", "ci-topology-tester@example.invalid"], root);
  run("git", ["config", "user.name", "CI topology tester"], root);
  // The gate is executed out of the fixture's own tree, so it must be committed
  // on the first commit and therefore present on every descendant of it.
  testerWrite(root, ".github/scripts/strict-grep/issue-2148-ci-topology-bounded.mjs", fs.readFileSync(GATE, "utf8"));
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n");
  run("git", ["add", "-A"], root);
  run("git", ["commit", "-q", "-m", "baseline"], root);
  return { root, baseBranch: run("git", ["rev-parse", "--abbrev-ref", "HEAD"], root) };
}

function runGateEnv(root, argv, environment = {}) {
  return spawnSync(
    process.execPath,
    [".github/scripts/strict-grep/issue-2148-ci-topology-bounded.mjs", ...argv],
    { cwd: root, encoding: "utf8", env: { ...process.env, ...environment } },
  );
}

test("#2681 tester: a stale branch that adds a wrapper is blamed for exactly one violation, not ten", () => {
  // The implementor's case asserts that ONE of the nine phantoms is absent from
  // stderr. That is a sample, not the claim. The claim is that the violation
  // LIST has exactly one entry, so assert the printed count and then every one
  // of the nine names. On the two-dot gate this run reads "10 added workflow(s)"
  // and "FAILED — 10 violation(s)".
  const branchWorkflow = ".github/workflows/issue-9091-mine.yml";
  const { root, baseBranch } = testerFixture("issue-2681-tester-divergent-");
  try {
    for (const wrapper of TESTER_PHANTOM_WRAPPERS) {
      testerWrite(root, wrapper, "name: historical wrapper\non: pull_request\njobs: {}\n");
    }
    commit(root, "land the nine historical wrappers", [".github/workflows"]);
    run("git", ["branch", "stale"], root);

    for (const wrapper of TESTER_PHANTOM_WRAPPERS) run("git", ["rm", "-q", wrapper], root);
    run("git", ["commit", "-q", "-m", "base branch deletes the nine historical wrappers"], root);
    const baseTip = run("git", ["rev-parse", "HEAD"], root);
    assert.notEqual(baseBranch, "");

    run("git", ["checkout", "-q", "stale"], root);
    testerWrite(root, "docs/note.md", "branch work\n");
    testerWrite(root, branchWorkflow, "name: branch wrapper\non: pull_request\njobs: {}\n");
    commit(root, "branch work plus one genuinely new wrapper", ["docs/note.md", branchWorkflow]);

    const result = runGate(root, baseTip);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /\b1 added workflow\(s\)/);
    assert.match(result.stderr, /FAILED — 1 violation\(s\)/);
    assert.match(result.stderr, /issue-9091-mine\.yml/);
    for (const wrapper of TESTER_PHANTOM_WRAPPERS) {
      const basename = path.posix.basename(wrapper).replace(/\./g, "\\.");
      assert.doesNotMatch(result.stderr, new RegExp(basename), `${wrapper} was blamed on the branch`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("#2681 tester: an unreachable merge base still fails closed at exit 2 after the recovery fetch", () => {
  // Three dots are only safe because ensureComparisonHistory has already proven
  // the merge base exists. Drive the whole event-driven recovery path — the
  // deepening fetch really runs against a real remote here — with two histories
  // that share no ancestor at all, and prove the gate refuses rather than
  // reporting some added set against an endpoint it cannot relate to HEAD.
  const { root } = testerFixture("issue-2681-tester-unrelated-");
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "issue-2681-tester-unrelated-work-"));
  try {
    const baseTip = run("git", ["rev-parse", "HEAD"], root);
    run("git", ["checkout", "-q", "--orphan", "pr"], root);
    run("git", ["rm", "-rq", "--cached", "."], root);
    testerWrite(root, ".github/scripts/strict-grep/issue-2148-ci-topology-bounded.mjs", fs.readFileSync(GATE, "utf8"));
    testerWrite(root, ".github/workflows/issue-9092-orphan.yml", "name: orphan\non: pull_request\njobs: {}\n");
    testerWrite(root, "README.md", "orphan\n");
    run("git", ["add", "-A"], root);
    run("git", ["commit", "-q", "-m", "an unrelated history that adds a wrapper"], root);
    const headSha = run("git", ["rev-parse", "HEAD"], root);

    const originPath = path.join(workdir, "origin.git");
    run("git", ["clone", "-q", "--bare", root, originPath], workdir);
    run("git", ["update-ref", "refs/pull/1/head", headSha], originPath);

    const clone = path.join(workdir, "work");
    run("git", ["init", "-q", clone], workdir);
    run("git", ["remote", "add", "origin", `file://${originPath}`], clone);
    run("git", ["fetch", "-q", "--no-tags", "--depth=1", "origin", "+refs/pull/1/head:refs/remotes/origin/pull/1/head"], clone);
    run("git", ["checkout", "-q", headSha], clone);

    const eventPath = path.join(workdir, "event.json");
    fs.writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: 1, base: { ref: "main", sha: baseTip }, head: { sha: headSha } } }),
    );

    const result = runGateEnv(clone, [], { GITHUB_EVENT_PATH: eventPath });
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /cannot establish a complete comparison history/);
    assert.match(result.stderr, /refusing a vacuous green/);
    // It must not have reported an added set at all.
    assert.doesNotMatch(result.stdout, /added workflow\(s\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test("#2681 tester: a truncated shallow window yields the exact merge base or nothing, never an older one", () => {
  // The load-bearing safety claim, driven rather than argued: for a LINEAR base
  // branch, deepening past the fork gives the true fork point and a correct
  // empty added set, while stopping short of it gives no merge base at all and
  // the gate exits 2. What must never happen is the third outcome — some older
  // ancestor accepted silently, against which a genuinely added wrapper looks
  // like it was always there.
  const { root } = testerFixture("issue-2681-tester-shallow-");
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "issue-2681-tester-shallow-work-"));
  try {
    testerWrite(root, ".github/workflows/issue-9093-old.yml", "name: historical\non: pull_request\njobs: {}\n");
    commit(root, "land a historical wrapper", [".github/workflows"]);
    for (let index = 0; index < 6; index += 1) {
      testerWrite(root, `pre-${index}.txt`, `${index}\n`);
      commit(root, `pre-fork filler ${index}`, [`pre-${index}.txt`]);
    }
    const fork = run("git", ["rev-parse", "HEAD"], root);
    run("git", ["branch", "stale"], root);
    run("git", ["rm", "-q", ".github/workflows/issue-9093-old.yml"], root);
    run("git", ["commit", "-q", "-m", "base branch deletes the historical wrapper"], root);
    for (let index = 0; index < 6; index += 1) {
      testerWrite(root, `post-${index}.txt`, `${index}\n`);
      commit(root, `post-fork filler ${index}`, [`post-${index}.txt`]);
    }
    const baseTip = run("git", ["rev-parse", "HEAD"], root);
    run("git", ["checkout", "-q", "stale"], root);
    testerWrite(root, "docs/note.md", "branch work\n");
    commit(root, "branch work, no workflow touched", ["docs/note.md"]);
    const headSha = run("git", ["rev-parse", "HEAD"], root);

    const originPath = path.join(workdir, "origin.git");
    run("git", ["clone", "-q", "--bare", root, originPath], workdir);
    run("git", ["update-ref", "refs/pull/1/head", headSha], originPath);

    const atDepth = (depth) => {
      const clone = path.join(workdir, `work-${depth}`);
      run("git", ["init", "-q", clone], workdir);
      run("git", ["remote", "add", "origin", `file://${originPath}`], clone);
      run("git", ["fetch", "-q", "--no-tags", `--depth=${depth}`, "origin",
        "+refs/heads/*:refs/remotes/origin/*", "+refs/pull/1/head:refs/remotes/origin/pull/1/head"], clone);
      run("git", ["checkout", "-q", headSha], clone);
      const probe = spawnSync("git", ["merge-base", baseTip, headSha], { cwd: clone, encoding: "utf8" });
      return { clone, mergeBase: probe.status === 0 ? probe.stdout.trim() : "" };
    };

    const truncated = atDepth(3);
    assert.equal(truncated.mergeBase, "", "a window that stops short of the fork must yield NO merge base");
    const refused = runGate(truncated.clone, baseTip);
    assert.equal(refused.status, 2, `${refused.stdout}\n${refused.stderr}`);
    assert.match(refused.stderr, /cannot establish a complete comparison history/);

    const deepened = atDepth(20);
    assert.equal(deepened.mergeBase, fork, "a window that reaches the fork must yield the EXACT fork point");
    const accepted = runGate(deepened.clone, baseTip);
    assert.equal(accepted.status, 0, `${accepted.stdout}\n${accepted.stderr}`);
    assert.match(accepted.stdout, /\b0 added workflow\(s\)/);
    assert.doesNotMatch(accepted.stderr, /issue-9093-old\.yml/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test("#2681 tester: staleness does not swallow the canonical base-registry token check", () => {
  // Issue #2686's case, run through the CANONICAL authority path that every
  // other fixture in these two files skips, with the branch ALSO stale by nine
  // deletions. The token is attributed over `git log base..head` and the
  // contract is read at the base TIP; neither moved with the added set, so a
  // missing token must still fail on exactly the one real file, and the
  // byte-exact token must still pass. The fixture uses its own capability name
  // rather than #2686's real filename: the wave-shadow seal discovers every file
  // that mentions a declared workflow by name, and naming the real one here makes
  // this test file register as a new provider of it and reds four other gates.
  const registry = JSON.stringify({
    version: 1,
    workflows: [{
      path: ".github/workflows/fixture-contract-suites.yml",
      issue: 2591,
      category: "service-container",
      rationale: "nine fixture service-container suites share one runner image and cannot be expressed by an existing profile",
    }],
  });
  const token =
    "CI-WORKFLOW-APPROVED #2591 [service-container]: nine fixture service-container suites share one runner image and cannot be expressed by an existing profile";
  // canonicalRepositoryMode short-circuits to "noncanonical-fixture" whenever
  // GITHUB_WORKSPACE names a directory other than the repo root, which is
  // exactly what a fixture under CI looks like. Clear the CI identity variables
  // so the canonical branch is genuinely reachable from a test.
  const canonicalEnvironment = { GITHUB_ACTIONS: "", GITHUB_WORKSPACE: "", GITHUB_REPOSITORY: "" };

  for (const [label, message, expected] of [
    ["missing token", "add the fixture contract suites workflow", 1],
    ["byte-exact token", `add the fixture contract suites workflow\n\n${token}`, 0],
  ]) {
    const { root } = testerFixture("issue-2681-tester-canonical-");
    try {
      run("git", ["remote", "add", "origin", "https://github.com/Mingla-LLC/mingla-main.git"], root);
      testerWrite(root, ".github/ci-capability-workflows.json", `${registry}\n`);
      for (const wrapper of TESTER_PHANTOM_WRAPPERS) {
        testerWrite(root, wrapper, "name: historical wrapper\non: pull_request\njobs: {}\n");
      }
      commit(root, "base: the exception contract lands with the historical wrappers", [".github"]);
      run("git", ["branch", "stale"], root);
      for (const wrapper of TESTER_PHANTOM_WRAPPERS) run("git", ["rm", "-q", wrapper], root);
      run("git", ["commit", "-q", "-m", "base branch deletes the nine historical wrappers"], root);
      const baseTip = run("git", ["rev-parse", "HEAD"], root);

      run("git", ["checkout", "-q", "stale"], root);
      testerWrite(root, ".github/workflows/fixture-contract-suites.yml", "name: pg\non: pull_request\njobs: {}\n");
      commit(root, message, [".github/workflows/fixture-contract-suites.yml"]);

      const result = runGateEnv(root, ["--base", baseTip, "--head", "HEAD"], canonicalEnvironment);
      assert.equal(result.status, expected, `${label}: ${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /authority: canonical/, `${label} did not reach the canonical path`);
      assert.match(result.stdout, /\b1 added workflow\(s\)/, `${label} counted the deletions as additions`);
      if (expected === 1) {
        assert.match(result.stderr, /FAILED — 1 violation\(s\)/);
        assert.match(
          result.stderr,
          /fixture-contract-suites\.yml: no touching commit has an issue, category, and rationale exactly matching the BASE registry entry\./,
        );
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
