/**
 * Issue #3455 implementor happy-path proof: the CI topology gate never mutates
 * the checkout it runs in.
 *
 * Before #3455, when the merge base was missing the gate ran a blobless
 * `--depth=1024` fetch INSIDE the checkout it was judging. That left the checkout
 * with a moved shallow boundary, promisor config, repository format 1, blobless
 * packs and new refs; on a push-shaped CI checkout a later
 * `git clone --no-hardlinks <workspace>` then aborted with "possible repository
 * corruption". The fix builds a disposable bare repository under os.tmpdir()
 * instead. Every case below fingerprints the checkout's git state before and
 * after one gate run and requires it to be byte-identical.
 *
 * Why the fixture is built the way it is:
 * - The origin's main has MORE than 1,024 commits (1,030 linear plus the tip).
 *   With the pre-#3455 gate restored, its in-place `--depth=1024` deepen must
 *   leave the workspace still shallow; with a shorter history the deepen would
 *   reach the root, the workspace would stop being shallow, and the legacy path
 *   clone (I-3) would pass under the broken gate.
 * - The bare origin sets `uploadpack.allowFilter`. Without it a file:// server
 *   silently ignores `--filter=blob:none`, the reverted gate fetches full blobs,
 *   and the blobless-promisor hazard no longer reproduces.
 * - `uploadpack.allowAnySHA1InWant` lets the checkout builders fetch exact SHAs
 *   the way actions/checkout does, and lets lazy blob fetches succeed.
 * - The test never runs git with its cwd at or inside this repository and never
 *   reads this repository's git state. It reads only the gate's bytes, which it
 *   commits into a synthetic origin. Running a history-fetching gate against the
 *   real checkout is exactly the damage this issue exists to prevent.
 * - Every gate run gets its own fresh, empty, absolute TMPDIR, so "the disposable
 *   repository was removed" is an exact `readdirSync(TMPDIR) === []` assertion
 *   rather than a search through a shared temp directory other processes use.
 * - A unique fake credential is planted as the checkout's extraheader and must
 *   never appear in any gate output.
 * - Fixture workflow basenames are deliberately invented: naming a real
 *   workflow file here would make CI provider discovery count this suite.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(HERE, "issue-2148-ci-topology-bounded.mjs");
const GATE_RELATIVE = ".github/scripts/strict-grep/issue-2148-ci-topology-bounded.mjs";

const LINEAR_COMMITS = 1030;
const EPOCH = 1_700_000_000;
const IDENTITY_NAME = "Issue 3455 fixture";
const IDENTITY_EMAIL = "issue-3455-fixture@example.invalid";
const LEGACY_WORKFLOW = ".github/workflows/fixture-legacy-lane.yml";
const FRESH_WORKFLOW = ".github/workflows/fixture-fresh-lane.yml";
const PR_WORKFLOW = ".github/workflows/fixture-pr-lane.yml";
const LEGACY_BODY = [
  "name: legacy fixture lane",
  "on:",
  "  pull_request:",
  "    branches: [main]",
  "jobs:",
  "  legacy:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: echo this legacy fixture lane is deleted at the tip of main",
  "",
].join("\n");
const TOKEN =
  "CI-WORKFLOW-APPROVED #3455: required status context cannot be supplied by an existing stable workflow";
const BOGUS_BASE = "0000000000000000000000000000000000000001";

const GITHUB_VARIABLES = [
  "GITHUB_EVENT_PATH",
  "GITHUB_EVENT_NAME",
  "GITHUB_BASE_REF",
  "GITHUB_HEAD_REF",
  "GITHUB_REF",
  "GITHUB_REF_NAME",
  "GITHUB_SHA",
  "GITHUB_ACTIONS",
  "GITHUB_REPOSITORY",
  "GITHUB_WORKSPACE",
  "CI_TOPOLOGY_BASE_SHA",
  "CI_TOPOLOGY_HEAD_SHA",
];
const REPOSITORY_LOCATION_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_INDEX_FILE",
  "GIT_SHALLOW_FILE",
  "GIT_GRAFT_FILE",
  "GIT_PREFIX",
  "GIT_NAMESPACE",
];

function withoutRepositoryLocation(environment) {
  const scrubbed = { ...environment };
  for (const name of REPOSITORY_LOCATION_VARIABLES) delete scrubbed[name];
  return scrubbed;
}

/** Environment for the test's OWN git calls: hermetic identity and config. */
function fixtureEnvironment(scratch) {
  return {
    ...withoutRepositoryLocation(process.env),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: path.join(scratch, "fixture-gitconfig"),
    GIT_AUTHOR_NAME: IDENTITY_NAME,
    GIT_AUTHOR_EMAIL: IDENTITY_EMAIL,
    GIT_COMMITTER_NAME: IDENTITY_NAME,
    GIT_COMMITTER_EMAIL: IDENTITY_EMAIL,
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_LAZY_FETCH: "1",
  };
}

function gitIn(context, args, cwd, { input, allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    env: context.environment,
    encoding: input === undefined ? "utf8" : undefined,
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = String(result.stdout ?? "").trim();
  if (result.status === 0) return stdout;
  if (allowFailure) return null;
  throw new Error(`fixture git ${args.join(" ")} (cwd ${cwd}) exited ${result.status}: ${String(result.stderr ?? "")}`);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** Text files compare as text (readable diffs); anything else by digest. */
function bytesOf(file) {
  const buffer = fs.readFileSync(file);
  const text = buffer.toString("utf8");
  if (!buffer.includes(0) && Buffer.from(text, "utf8").equals(buffer)) return text;
  return `sha256:${sha256(buffer)}:${buffer.length}`;
}

function readOrAbsent(file) {
  return fs.existsSync(file) ? bytesOf(file) : "<absent>";
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const found = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else found.push(full);
    }
  };
  visit(directory);
  return found.sort();
}

function namedBytes(directory) {
  return walk(directory).map((file) => [path.relative(directory, file), bytesOf(file)]);
}

function namedSizes(directory) {
  return walk(directory).map((file) => [path.relative(directory, file), fs.statSync(file).size]);
}

/** Spec §7.2: every piece of git state a fetch, lazy fetch or maintenance could write. */
function fingerprint(context, checkout) {
  const [gitDir, commonDir] = gitIn(
    context,
    ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"],
    checkout,
  ).split("\n");
  const objects = path.join(commonDir, "objects");
  const topLevel = (directory) =>
    fs.existsSync(directory)
      ? fs.readdirSync(directory).sort().map((name) => {
          const full = path.join(directory, name);
          return fs.statSync(full).isDirectory() ? [name, "<directory>"] : [name, bytesOf(full)];
        })
      : [];
  return {
    config: readOrAbsent(path.join(commonDir, "config")),
    configWorktree: readOrAbsent(path.join(gitDir, "config.worktree")),
    repositoryFormatVersion:
      gitIn(context, ["config", "--get", "core.repositoryformatversion"], checkout, { allowFailure: true }) ?? "<unset>",
    shallow: readOrAbsent(path.join(commonDir, "shallow")),
    head: readOrAbsent(path.join(gitDir, "HEAD")),
    commonHead: readOrAbsent(path.join(commonDir, "HEAD")),
    packedRefs: readOrAbsent(path.join(commonDir, "packed-refs")),
    refs: namedBytes(path.join(commonDir, "refs")),
    packs: fs.existsSync(path.join(objects, "pack"))
      ? fs.readdirSync(path.join(objects, "pack")).sort().map((name) => [name, fs.statSync(path.join(objects, "pack", name)).size])
      : [],
    objectsInfo: topLevel(path.join(objects, "info")),
    looseObjects: fs
      .readdirSync(objects)
      .filter((name) => /^[0-9a-f]{2}$/.test(name))
      .reduce((count, name) => count + fs.readdirSync(path.join(objects, name)).length, 0),
    fetchHead: readOrAbsent(path.join(commonDir, "FETCH_HEAD")),
    commonLogs: namedSizes(path.join(commonDir, "logs")),
    gitDirLogs: namedSizes(path.join(gitDir, "logs")),
    worktrees: namedBytes(path.join(commonDir, "worktrees")),
  };
}

function buildOrigin(context, gateBytes) {
  const origin = path.join(context.scratch, "origin.git");
  gitIn(context, ["init", "-q", "--bare", "-b", "main", origin], context.scratch);
  gitIn(context, ["config", "uploadpack.allowFilter", "true"], origin);
  gitIn(context, ["config", "uploadpack.allowAnySHA1InWant", "true"], origin);

  const chunks = [];
  const text = (value) => chunks.push(Buffer.from(value, "utf8"));
  const data = (buffer) => {
    text(`data ${buffer.length}\n`);
    chunks.push(buffer);
    text("\n");
  };
  for (let index = 1; index <= LINEAR_COMMITS; index += 1) {
    text(`commit refs/heads/main\ncommitter ${IDENTITY_NAME} <${IDENTITY_EMAIL}> ${EPOCH + index} +0000\n`);
    data(Buffer.from(`linear fixture commit ${index}\n`, "utf8"));
    if (index === 1) {
      text("M 100644 inline README.md\n");
      data(Buffer.from("issue #3455 synthetic origin\n", "utf8"));
      text(`M 100644 inline ${GATE_RELATIVE}\n`);
      data(gateBytes);
      text(`M 100644 inline ${LEGACY_WORKFLOW}\n`);
      data(Buffer.from(LEGACY_BODY, "utf8"));
    }
    text("M 100644 inline counter.txt\n");
    data(Buffer.from(`${index}\n`, "utf8"));
  }
  text("done\n");
  gitIn(context, ["fast-import", "--quiet", "--done"], origin, { input: Buffer.concat(chunks) });

  // T, P and M go through an ordinary clone, the way real history arrives.
  const seed = path.join(context.scratch, "seed");
  gitIn(context, ["clone", "-q", "--no-tags", `file://${origin}`, seed], context.scratch);
  gitIn(context, ["rm", "-q", LEGACY_WORKFLOW], seed);
  fs.mkdirSync(path.join(seed, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(seed, FRESH_WORKFLOW), "name: fresh\non: push\njobs: {}\n");
  gitIn(context, ["add", FRESH_WORKFLOW], seed);
  gitIn(context, ["commit", "-q", "-m", `replace the lane\n\n${TOKEN}`], seed);
  gitIn(context, ["push", "-q", "origin", "HEAD:refs/heads/main"], seed);
  const tip = gitIn(context, ["rev-parse", "HEAD"], seed);
  const parent = gitIn(context, ["rev-parse", "HEAD~1"], seed);

  gitIn(context, ["checkout", "-q", "--detach", parent], seed);
  fs.writeFileSync(path.join(seed, PR_WORKFLOW), "name: pr\non: pull_request\njobs: {}\n");
  gitIn(context, ["add", PR_WORKFLOW], seed);
  gitIn(context, ["commit", "-q", "-m", `add the pr lane\n\n${TOKEN}`], seed);
  const prHead = gitIn(context, ["rev-parse", "HEAD"], seed);
  gitIn(context, ["push", "-q", "origin", "HEAD:refs/pull/1/head"], seed);

  gitIn(context, ["checkout", "-q", "--detach", tip], seed);
  gitIn(context, ["merge", "-q", "--no-edit", prHead], seed);
  const merge = gitIn(context, ["rev-parse", "HEAD"], seed);
  gitIn(context, ["push", "-q", "origin", "HEAD:refs/pull/1/merge"], seed);
  fs.rmSync(seed, { recursive: true, force: true });

  return { origin, tip, parent, prHead, merge };
}

/** actions/checkout-shaped workspace: depth-1 fetch of one exact SHA. */
function actionsCheckout(context, name, { sha, destination, detached }) {
  const workspace = path.join(context.scratch, name);
  gitIn(context, ["init", "-q", workspace], context.scratch);
  gitIn(context, ["remote", "add", "origin", `file://${context.origin.origin}`], workspace);
  gitIn(context, ["config", "--local", "gc.auto", "0"], workspace);
  gitIn(context, ["config", "--local", "http.https://github.com/.extraheader", `AUTHORIZATION: basic ${context.marker}`], workspace);
  gitIn(
    context,
    ["-c", "protocol.version=2", "fetch", "--no-tags", "--prune", "--no-recurse-submodules", "--depth=1", "origin", `+${sha}:${destination}`],
    workspace,
  );
  if (detached) gitIn(context, ["checkout", "-q", "--force", destination], workspace);
  else gitIn(context, ["checkout", "-q", "--force", "-B", "main", destination], workspace);
  return workspace;
}

function writeEvent(context, name, payload) {
  const file = path.join(context.scratch, `event-${name}.json`);
  fs.writeFileSync(file, JSON.stringify(payload));
  return file;
}

function buildFixture(scratch) {
  const context = { scratch, environment: null, marker: crypto.randomBytes(24).toString("base64") };
  fs.writeFileSync(path.join(scratch, "fixture-gitconfig"), "");
  context.environment = fixtureEnvironment(scratch);
  context.gateBytes = fs.readFileSync(GATE);
  context.origin = buildOrigin(context, context.gateBytes);
  const { origin, tip, merge } = context.origin;
  const missing = `file://${path.join(scratch, "missing.git")}`;

  const pushShape = (name) =>
    actionsCheckout(context, name, { sha: tip, destination: "refs/remotes/origin/main", detached: false });
  context.checkouts = {
    push: pushShape("push"),
    pushFresh: pushShape("push-fresh"),
    fail: pushShape("fail"),
    pr: actionsCheckout(context, "pr", { sha: merge, destination: "refs/remotes/pull/1/merge", detached: true }),
  };
  gitIn(context, ["remote", "set-url", "origin", missing], context.checkouts.fail);

  const anchorShallow = path.join(scratch, "anchor-shallow");
  gitIn(context, ["clone", "-q", "--depth=1", "--no-tags", `file://${origin}`, anchorShallow], scratch);
  context.checkouts.wtS = path.join(scratch, "wt-shallow");
  gitIn(context, ["worktree", "add", "-q", "--detach", context.checkouts.wtS, "HEAD"], anchorShallow);

  const anchorFull = path.join(scratch, "anchor-full");
  gitIn(context, ["clone", "-q", "--no-tags", `file://${origin}`, anchorFull], scratch);
  context.checkouts.wtF = path.join(scratch, "wt-full");
  gitIn(context, ["worktree", "add", "-q", "--detach", context.checkouts.wtF, "HEAD"], anchorFull);

  context.checkouts.fast = path.join(scratch, "fast");
  gitIn(context, ["clone", "-q", "--no-tags", `file://${origin}`, context.checkouts.fast], scratch);
  gitIn(context, ["remote", "set-url", "origin", missing], context.checkouts.fast);

  context.events = {
    push: writeEvent(context, "push", { ref: "refs/heads/main", before: context.origin.parent, after: tip }),
    pr: writeEvent(context, "pr", {
      number: 1,
      pull_request: { number: 1, base: { ref: "main", sha: tip }, head: { sha: context.origin.prHead } },
    }),
  };

  // Non-vacuity: the shallow shapes really need recovery history (so the gate
  // takes the disposable-repository path), and the fast shape really does not.
  for (const name of ["push", "pushFresh", "fail", "wtS"]) {
    assert.equal(
      gitIn(context, ["merge-base", context.origin.parent, tip], context.checkouts[name], { allowFailure: true }),
      null,
      `fixture ${name} unexpectedly already has the push merge base`,
    );
  }
  assert.equal(gitIn(context, ["rev-parse", "--is-shallow-repository"], context.checkouts.wtF), "false");
  assert.ok(gitIn(context, ["merge-base", context.origin.parent, tip], context.checkouts.fast));
  return context;
}

function runGate(context, checkout, { event = "", argv = [], overrides = {} } = {}) {
  const temporary = fs.mkdtempSync(path.join(context.scratch, "run-tmp-"));
  const environment = withoutRepositoryLocation(process.env);
  for (const name of GITHUB_VARIABLES) environment[name] = "";
  Object.assign(environment, overrides, { TMPDIR: temporary });
  if (event) environment.GITHUB_EVENT_PATH = context.events[event];
  const started = Date.now();
  const result = spawnSync(process.execPath, [GATE_RELATIVE, ...argv], { cwd: checkout, encoding: "utf8", env: environment });
  return { ...result, temporary, durationMs: Date.now() - started };
}

function assertIsolated(context, id, checkout, before, result) {
  const combined = `${result.stdout}\n${result.stderr}`;
  assert.deepStrictEqual(fingerprint(context, checkout), before, `${id}: the gate changed the checkout's git state`);
  assert.deepStrictEqual(fs.readdirSync(result.temporary), [], `${id}: the comparison repository was left in TMPDIR`);
  assert.ok(!combined.includes(context.marker), `${id}: the checkout's credential marker reached gate output`);
}

function assertRefusal(result) {
  assert.match(result.stderr, /cannot establish a complete comparison history/);
  assert.match(result.stderr, /refusing a vacuous green/);
  assert.doesNotMatch(result.stderr, /git fetch .* failed/);
  assert.doesNotMatch(result.stdout, /added workflow\(s\)/);
}

function gateCase(context, id, checkoutName, options, expectedExit, verify) {
  const checkout = context.checkouts[checkoutName];
  assert.equal(
    sha256(fs.readFileSync(path.join(checkout, GATE_RELATIVE))),
    sha256(context.gateBytes),
    `${id}: the fixture must execute the current gate bytes`,
  );
  const before = fingerprint(context, checkout);
  const result = runGate(context, checkout, options);
  assert.equal(result.status, expectedExit, `${id}: exit ${result.status}\n${result.stdout}\n${result.stderr}`);
  verify(result);
  assertIsolated(context, id, checkout, before, result);
}

test("issue #3455: the topology gate never mutates the checkout it runs in", async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "issue-3455-impl-"));
  try {
    const context = buildFixture(scratch);
    const { tip, parent, prHead } = context.origin;
    const pushVerdict = (result) => {
      assert.match(result.stdout, new RegExp(`\\b1 added workflow\\(s\\) in ${parent}\\.\\.${tip}\\.`));
      assert.match(result.stdout, /PASS\./);
    };
    const bogus = ["--base", BOGUS_BASE, "--head", "HEAD"];

    await t.test("I-1 push checkout: verdict computed, checkout untouched", () =>
      gateCase(context, "I-1", "push", { event: "push" }, 0, pushVerdict));

    await t.test("I-2 push checkout: bogus base fails closed, checkout untouched", () =>
      gateCase(context, "I-2", "push", { event: "push", argv: bogus }, 2, assertRefusal));

    await t.test("I-3 push checkout: the legacy path clone still succeeds", () => {
      const workspace = context.checkouts.push;
      const before = fingerprint(context, workspace);
      const destination = path.join(scratch, "legacy-clone");
      // The consumer clones the way a later CI step does: lazy fetching is NOT
      // disabled on its side, so only the workspace's own state decides the exit.
      const consumerEnvironment = { ...context.environment };
      delete consumerEnvironment.GIT_NO_LAZY_FETCH;
      const clone = spawnSync("git", ["clone", "-q", "--no-hardlinks", workspace, destination], {
        cwd: scratch,
        env: consumerEnvironment,
        encoding: "utf8",
      });
      assert.equal(clone.status, 0, `I-3: git clone --no-hardlinks exited ${clone.status}: ${clone.stderr}`);
      assert.equal(
        gitIn(context, ["rev-parse", "HEAD^{tree}"], destination),
        gitIn(context, ["rev-parse", "HEAD^{tree}"], workspace),
        "I-3: the clone's HEAD tree differs from the workspace",
      );
      assert.deepStrictEqual(fingerprint(context, workspace), before, "I-3: cloning changed the workspace");
    });

    await t.test("I-4 pull-request merge checkout: verdict computed, checkout untouched", () =>
      gateCase(context, "I-4", "pr", { event: "pr" }, 0, (result) => {
        assert.match(result.stdout, new RegExp(`\\b1 added workflow\\(s\\) in ${tip}\\.\\.${prHead}\\.`));
        assert.match(result.stdout, /PASS\./);
      }));

    await t.test("I-5 pull-request merge checkout: bogus base fails closed, checkout untouched", () =>
      gateCase(context, "I-5", "pr", { event: "pr", argv: bogus }, 2, assertRefusal));

    await t.test("I-6 worktree of a shallow clone: verdict computed, common dir untouched", () =>
      gateCase(context, "I-6", "wtS", { event: "push" }, 0, pushVerdict));

    await t.test("I-7 worktree of a shallow clone: bogus base fails closed, common dir untouched", () =>
      gateCase(context, "I-7", "wtS", { event: "push", argv: bogus }, 2, assertRefusal));

    await t.test("I-8 worktree of a full clone: bogus base fails closed, the anchor stays full", () => {
      gateCase(context, "I-8", "wtF", { event: "pr", argv: bogus }, 2, assertRefusal);
      assert.equal(
        gitIn(context, ["rev-parse", "--is-shallow-repository"], context.checkouts.wtF),
        "false",
        "I-8: the full anchor behind the worktree became shallow",
      );
    });

    await t.test("I-9 merge base already present: fast path, no fetch attempted", () =>
      gateCase(context, "I-9", "fast", { event: "push" }, 0, pushVerdict));

    await t.test("I-10 recovery fetch fails: exit 2 and the comparison repository is removed", () =>
      gateCase(context, "I-10", "fail", { event: "push" }, 2, (result) => {
        assert.match(
          result.stderr,
          /git fetch --no-tags --filter=blob:none --depth=1024 origin \+refs\/heads\/main:refs\/remotes\/origin\/main failed:/,
        );
      }));

    await t.test("I-11 identity throw after recovery: exit 2, checkout untouched", () =>
      gateCase(context, "I-11", "pushFresh", { event: "push", overrides: { GITHUB_ACTIONS: "true" } }, 2, (result) => {
        assert.match(result.stderr, /GITHUB_WORKSPACE is missing in CI; refusing ambiguous repository identity/);
      }));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
