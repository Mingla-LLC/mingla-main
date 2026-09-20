/**
 * Issue #3455 tester-owned adversarial proof: the CI topology gate never touches
 * the git state of the checkout it runs in, even when the environment around it
 * is hostile.
 *
 * The implementor's suite proves the happy shapes (push, pull request, linked
 * worktrees, fast path, fetch failure, identity throw). This file attacks the
 * edges around them instead:
 * - it SPIES on every git process the gate spawns (a PATH shim) and checks the
 *   argv/env/cwd contract directly, so a fetch that runs in the checkout is
 *   named at the spawn, not only inferred from a changed fingerprint;
 * - it follows the credential header into every git process through trace2
 *   (a planted local extraheader AND one from an includeIf file) on exit 0, 1,
 *   2 and on a failed fetch;
 * - it points inherited GIT_DIR / GIT_OBJECT_DIRECTORY / GIT_INDEX_FILE at a
 *   victim repository, hostile TMPDIR values at the checkout, and a hostile
 *   global git config (hooks that write a sentinel, reftable, bare-repository
 *   restrictions, eager gc and maintenance) at the gate;
 * - it drives late throws after the recovery fetch (a malformed BASE registry
 *   that must be lazily fetched, an identity conflict through a symlinked
 *   workspace), partial-clone and alternates-borrowing checkouts, thousands of
 *   refs with symbolic, dangling and non-commit refs, a force-pushed PR head,
 *   concurrent runs, SIGKILL of the whole process group, and a cleanup that
 *   cannot remove its directory.
 *
 * Why it is built this way:
 * - Fingerprints cover EVERY file under the common git directory (path, size,
 *   sha256, symlink target) plus the working tree listing, so any write, a new
 *   promisor pack, FETCH_HEAD, a moved shallow boundary, a stray directory left
 *   inside .git, fails with the changed path named.
 * - The origin is short (about twenty commits). Unlike the implementor's legacy
 *   clone check, nothing here depends on the deepen stopping short of the root:
 *   an in-place fetch changes the fingerprint either way.
 * - The origin sets uploadpack.allowFilter (without it a file:// server ignores
 *   --filter=blob:none and lazy blob fetches never happen) and
 *   uploadpack.allowAnySHA1InWant (exact-SHA checkouts, lazy fetches, and the
 *   force-pushed PR head that is no longer reachable from any ref).
 * - The canonical-authority case reaches the canonical path WITHOUT the network:
 *   its origin URL is a file:// path ending in github.com/Mingla-LLC/mingla-main.git
 *   (a symlink to the fixture origin), which the gate's origin pattern accepts.
 * - The test never runs git with its cwd at or inside this repository and never
 *   reads this repository's git state; it only reads the gate's bytes and commits
 *   them into the synthetic origin. Running a history-fetching gate against the
 *   real checkout is the exact damage #3455 exists to prevent.
 * - Every gate run gets a fresh absolute TMPDIR and an empty global git config,
 *   so "nothing was left behind" is an exact directory listing and a developer's
 *   own git config cannot change a verdict.
 * - Fixture workflow basenames are invented; naming a real workflow file here
 *   would make CI provider discovery count this suite.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(HERE, "issue-2148-ci-topology-bounded.mjs");
const GATE_RELATIVE = ".github/scripts/strict-grep/issue-2148-ci-topology-bounded.mjs";

const LINEAR_COMMITS = 20;
const EPOCH = 1_750_000_000;
const IDENTITY = "Issue 3455 tester <issue-3455-tester@example.invalid>";
const REGISTRY = ".github/ci-capability-workflows.json";
const WORKFLOWS = {
  legacy: ".github/workflows/fixture-retired-lane.yml",
  fresh: ".github/workflows/fixture-replacement-lane.yml",
  unapproved: ".github/workflows/fixture-unapproved-lane.yml",
  registry: ".github/workflows/fixture-registry-lane.yml",
  prCurrent: ".github/workflows/fixture-current-pr-lane.yml",
  prStale: ".github/workflows/fixture-stale-pr-lane.yml",
};
const TOKEN =
  "CI-WORKFLOW-APPROVED #3455: required status context cannot be supplied by an existing stable workflow";
const BOGUS_BASE = "0000000000000000000000000000000000000001";
const COMPARISON_PREFIX = "mingla-2148-comparison-";

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
const LOCATION_VARIABLES = [
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
// Inherited variables that would change what git does or logs, independent of the case.
const AMBIENT_GIT_VARIABLES = [
  "GIT_NO_LAZY_FETCH",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_TRACE2",
  "GIT_TRACE2_EVENT",
  "GIT_TRACE2_PERF",
  "GIT_TRACE2_ENV_VARS",
  "GIT_TRACE2_CONFIG_PARAMS",
  "GIT_TRACE2_PARENT_SID",
  "GIT_DEFAULT_HASH",
  "GIT_DEFAULT_REF_FORMAT",
];

function scrubbedEnvironment() {
  const environment = { ...process.env };
  for (const name of [...LOCATION_VARIABLES, ...AMBIENT_GIT_VARIABLES]) delete environment[name];
  for (const name of Object.keys(environment)) {
    if (/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(name)) delete environment[name];
  }
  return environment;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function real(target) {
  return fs.realpathSync(target);
}

function isInside(candidate, directory) {
  return candidate === directory || candidate.startsWith(directory + path.sep);
}

/* ------------------------------------------------------------------ git ---- */

function git(context, args, cwd, { input, allowFailure = false, environment = {} } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    env: { ...context.environment, ...environment },
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

/* ---------------------------------------------------------- fingerprint ---- */

/** Every entry under `root`: [relative path, kind, size, sha256 | link target]. */
function snapshotTree(root, { skipTopLevel = [] } = {}) {
  const entries = [];
  const visit = (directory) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const full = path.join(directory, name);
      const relative = path.relative(root, full);
      if (directory === root && skipTopLevel.includes(name)) continue;
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) entries.push([relative, "link", fs.readlinkSync(full)]);
      else if (stat.isDirectory()) {
        entries.push([relative, "dir"]);
        visit(full);
      } else entries.push([relative, "file", stat.size, sha256(fs.readFileSync(full))]);
    }
  };
  visit(root);
  return entries;
}

/** The whole common git directory (and a separate gitdir, if any) plus the working tree. */
function fingerprint(context, checkout) {
  const [gitDir, commonDir] = git(
    context,
    ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"],
    checkout,
    { environment: { GIT_NO_LAZY_FETCH: "1" } },
  ).split("\n");
  const snapshot = { common: snapshotTree(commonDir), workTree: snapshotTree(checkout, { skipTopLevel: [".git"] }) };
  if (!isInside(real(gitDir), real(commonDir))) snapshot.gitDir = snapshotTree(gitDir);
  const dotGit = path.join(checkout, ".git");
  if (fs.existsSync(dotGit) && fs.lstatSync(dotGit).isFile()) snapshot.gitFile = fs.readFileSync(dotGit, "utf8");
  return snapshot;
}

function comparisonLeftovers(directory) {
  return snapshotTree(directory)
    .map(([relative]) => relative)
    .filter((relative) => path.basename(relative).startsWith(COMPARISON_PREFIX));
}

/* -------------------------------------------------------------- fixture ---- */

function buildOrigin(context) {
  const origin = path.join(context.scratch, "origin.git");
  git(context, ["init", "-q", "--bare", origin], context.scratch);
  git(context, ["config", "uploadpack.allowFilter", "true"], origin);
  git(context, ["config", "uploadpack.allowAnySHA1InWant", "true"], origin);

  const chunks = [];
  const line = (text) => chunks.push(Buffer.from(text, "utf8"));
  const data = (value) => {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
    line(`data ${buffer.length}\n`);
    chunks.push(buffer);
    line("\n");
  };
  let clock = EPOCH;
  let mark = 0;
  const commit = ({ ref, message, from, merge, changes }) => {
    mark += 1;
    clock += 60;
    line(`commit ${ref}\nmark :${mark}\ncommitter ${IDENTITY} ${clock} +0000\n`);
    data(message);
    if (from) line(`from :${from}\n`);
    if (merge) line(`merge :${merge}\n`);
    for (const [kind, file, body] of changes) {
      if (kind === "D") line(`D ${file}\n`);
      else {
        line(`M 100644 inline ${file}\n`);
        data(body);
      }
    }
    return mark;
  };

  const legacyBody = [
    "name: retired fixture lane",
    "on:",
    "  pull_request:",
    "    branches: [main]",
    "jobs:",
    "  retired:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo this retired fixture lane is deleted at the tip of main",
    "",
  ].join("\n");
  let previous = commit({
    ref: "refs/heads/main",
    message: "fixture root\n",
    changes: [
      ["M", "README.md", "issue #3455 tester origin\n"],
      ["M", GATE_RELATIVE, context.gateBytes],
      ["M", WORKFLOWS.legacy, legacyBody],
      ["M", "counter.txt", "1\n"],
    ],
  });
  for (let index = 2; index <= LINEAR_COMMITS; index += 1) {
    previous = commit({
      ref: "refs/heads/main",
      message: `linear fixture commit ${index}\n`,
      from: previous,
      changes: [["M", "counter.txt", `${index}\n`]],
    });
  }
  const parentMark = previous;
  const tipMark = commit({
    ref: "refs/heads/main",
    message: `replace the retired lane\n\n${TOKEN}\n`,
    from: parentMark,
    changes: [
      ["D", WORKFLOWS.legacy],
      ["M", WORKFLOWS.fresh, "name: replacement\non: push\njobs: {}\n"],
    ],
  });
  const violationMark = commit({
    ref: "refs/heads/violation",
    message: "add a lane with no approval token\n",
    from: tipMark,
    changes: [["M", WORKFLOWS.unapproved, "name: unapproved\non: push\njobs: {}\n"]],
  });
  const malformedMark = commit({
    ref: "refs/heads/registry",
    message: "land a registry that is not JSON\n",
    from: tipMark,
    changes: [["M", REGISTRY, `{ "version": 1, "workflows": [ this registry is deliberately malformed\n${"#".repeat(256)}\n`]],
  });
  const registryHeadMark = commit({
    ref: "refs/heads/registry",
    message: "repair the registry and add a lane\n",
    from: malformedMark,
    changes: [
      ["M", REGISTRY, `${JSON.stringify({ version: 1, workflows: [] })}\n`],
      ["M", WORKFLOWS.registry, "name: registry\non: push\njobs: {}\n"],
    ],
  });
  const staleMark = commit({
    ref: "refs/fixture/stale-pr-head",
    message: `add the stale pr lane\n\n${TOKEN}\n`,
    from: parentMark,
    changes: [["M", WORKFLOWS.prStale, "name: stale\non: pull_request\njobs: {}\n"]],
  });
  const currentMark = commit({
    ref: "refs/pull/1/head",
    message: `add the current pr lane\n\n${TOKEN}\n`,
    from: parentMark,
    changes: [["M", WORKFLOWS.prCurrent, "name: current\non: pull_request\njobs: {}\n"]],
  });
  const mergeMark = commit({
    ref: "refs/pull/1/merge",
    message: "merge the current pr head into main\n",
    from: tipMark,
    merge: currentMark,
    changes: [],
  });
  line("done\n");

  const marks = path.join(context.scratch, "origin.marks");
  git(context, ["fast-import", "--quiet", "--done", `--export-marks=${marks}`], origin, { input: Buffer.concat(chunks) });
  const sha = new Map(
    fs.readFileSync(marks, "utf8").trim().split("\n").map((entry) => {
      const [name, value] = entry.split(" ");
      return [Number(name.slice(1)), value];
    }),
  );
  // The stale PR head stays in the origin's object store but no ref reaches it,
  // exactly like a head that was force-pushed away after the event fired.
  git(context, ["update-ref", "-d", "refs/fixture/stale-pr-head"], origin);

  const canonicalAlias = path.join(context.scratch, "hosting", "github.com", "Mingla-LLC", "mingla-main.git");
  fs.mkdirSync(path.dirname(canonicalAlias), { recursive: true });
  fs.symlinkSync(origin, canonicalAlias);

  return {
    origin,
    url: `file://${origin}`,
    canonicalUrl: `file://${canonicalAlias}`,
    parent: sha.get(parentMark),
    tip: sha.get(tipMark),
    violation: sha.get(violationMark),
    malformed: sha.get(malformedMark),
    registryHead: sha.get(registryHeadMark),
    stalePrHead: sha.get(staleMark),
    currentPrHead: sha.get(currentMark),
    merge: sha.get(mergeMark),
  };
}

/** Plants the credential marker twice: local extraheader, and one from an includeIf file. */
function plantCredentials(context, checkout) {
  const gitDir = git(context, ["rev-parse", "--path-format=absolute", "--git-dir"], checkout);
  git(context, ["config", "--local", "http.https://github.com/.extraheader", `AUTHORIZATION: basic ${context.marker}-local`], checkout);
  const included = path.join(context.scratch, "included-credential.gitconfig");
  if (!fs.existsSync(included)) {
    fs.writeFileSync(included, `[http "https://github.com/"]\n\textraheader = AUTHORIZATION: bearer ${context.marker}-included\n`);
  }
  git(context, ["config", "--local", `includeIf.gitdir:${real(gitDir)}.path`, included], checkout);
}

/** actions/checkout-shaped workspace: depth-1 fetch of one exact SHA. */
function actionsCheckout(context, name, { sha, destination, branch, url = context.origin.url }) {
  const workspace = path.join(context.scratch, "checkouts", name);
  git(context, ["init", "-q", workspace], context.scratch);
  git(context, ["remote", "add", "origin", url], workspace);
  git(context, ["config", "--local", "gc.auto", "0"], workspace);
  plantCredentials(context, workspace);
  git(
    context,
    ["-c", "protocol.version=2", "fetch", "--no-tags", "--prune", "--no-recurse-submodules", "--depth=1", "origin", `+${sha}:${destination}`],
    workspace,
  );
  if (branch) git(context, ["checkout", "-q", "--force", "-B", branch, destination], workspace);
  else git(context, ["checkout", "-q", "--force", destination], workspace);
  assertCurrentGate(context, workspace);
  return workspace;
}

function pushCheckout(context, name) {
  return actionsCheckout(context, name, { sha: context.origin.tip, destination: "refs/remotes/origin/main", branch: "main" });
}

function assertCurrentGate(context, checkout) {
  assert.equal(
    sha256(fs.readFileSync(path.join(checkout, GATE_RELATIVE))),
    sha256(context.gateBytes),
    `${checkout}: the fixture must execute the current gate bytes`,
  );
}

function writeEvent(context, name, payload) {
  const file = path.join(context.scratch, "events", `${name}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload));
  return file;
}

function locateRealGit() {
  for (const directory of String(process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, "git");
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // keep looking
    }
  }
  throw new Error("git is not on PATH");
}

/**
 * A `git` first on PATH that records each spawn the GATE makes (argv, cwd, the
 * repository-location environment, and, for a fetch in a disposable repository,
 * that repository's config and alternates at fetch time), then runs real git.
 * Git's own children use git's exec path, not PATH, so only the gate's spawns
 * are recorded.
 */
function installSpy(context) {
  const bin = path.join(context.scratch, "spy-bin");
  fs.mkdirSync(bin, { recursive: true });
  const recorded = [...LOCATION_VARIABLES, "GIT_NO_LAZY_FETCH", "GIT_TERMINAL_PROMPT", "GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS"];
  const program = `
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const argv = process.argv.slice(2);
const entry = { argv, cwd: process.cwd(), env: {} };
for (const name of ${JSON.stringify(recorded)}) if (name in process.env) entry.env[name] = process.env[name];
const gitDir = process.env.GIT_DIR;
const readOptional = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
if (gitDir && argv[0] === "fetch") {
  entry.config = readOptional(path.join(gitDir, "config"));
  entry.alternates = readOptional(path.join(gitDir, "objects", "info", "alternates"));
  entry.shallowCopied = fs.existsSync(path.join(gitDir, "shallow"));
}
if (process.env.ISSUE_3455_SPY_LOG) fs.appendFileSync(process.env.ISSUE_3455_SPY_LOG, JSON.stringify(entry) + "\\n");
const result = spawnSync(${JSON.stringify(locateRealGit())}, argv, { stdio: "inherit" });
if (gitDir && argv[0] === "fetch" && process.env.ISSUE_3455_SPY_LOCK_ROOT === "1") {
  fs.chmodSync(path.dirname(gitDir), 0o555);
}
process.exit(result.status === null ? 1 : result.status);
`;
  fs.writeFileSync(path.join(bin, "spy.cjs"), program);
  fs.writeFileSync(path.join(bin, "git"), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(bin, "spy.cjs"))} "$@"\n`);
  fs.chmodSync(path.join(bin, "git"), 0o755);
  return bin;
}

function buildFixture(scratch) {
  const context = {
    scratch,
    marker: `issue3455tester${crypto.randomBytes(12).toString("hex")}`,
    gateBytes: fs.readFileSync(GATE),
  };
  const globalConfig = path.join(scratch, "empty-global.gitconfig");
  fs.writeFileSync(globalConfig, "");
  const [name, email] = IDENTITY.replace(">", "").split(" <");
  context.emptyGlobal = globalConfig;
  context.environment = {
    ...scrubbedEnvironment(),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    GIT_TERMINAL_PROMPT: "0",
  };
  for (const variable of GITHUB_VARIABLES) delete context.environment[variable];
  fs.mkdirSync(path.join(scratch, "checkouts"), { recursive: true });
  context.origin = buildOrigin(context);
  context.spyBin = installSpy(context);
  const { parent, tip, violation, malformed, registryHead, stalePrHead } = context.origin;
  context.events = {
    push: writeEvent(context, "push", { ref: "refs/heads/main", before: parent, after: tip }),
    violation: writeEvent(context, "violation", { ref: "refs/heads/violation", before: tip, after: violation }),
    registry: writeEvent(context, "registry", { ref: "refs/heads/registry", before: malformed, after: registryHead }),
    stalePr: writeEvent(context, "stale-pr", {
      number: 1,
      pull_request: { number: 1, base: { ref: "main", sha: tip }, head: { sha: stalePrHead } },
    }),
  };
  context.pushVerdict = new RegExp(`\\b1 added workflow\\(s\\) in ${parent}\\.\\.${tip}\\.`);
  return context;
}

/* ------------------------------------------------------------ gate runs ---- */

function freshTemporary(context, label) {
  return fs.mkdtempSync(path.join(context.scratch, `tmp-${label}-`));
}

function gateEnvironment(context, { event, temporary, overrides = {}, spyLog, trace }) {
  const environment = scrubbedEnvironment();
  for (const name of GITHUB_VARIABLES) environment[name] = "";
  Object.assign(environment, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: context.emptyGlobal,
    TMPDIR: temporary,
  });
  if (event) environment.GITHUB_EVENT_PATH = context.events[event];
  if (spyLog) {
    environment.PATH = `${context.spyBin}${path.delimiter}${environment.PATH ?? ""}`;
    environment.ISSUE_3455_SPY_LOG = spyLog;
  }
  if (trace) {
    Object.assign(environment, {
      GIT_TRACE2_EVENT: trace,
      GIT_TRACE2_ENV_VARS: "GIT_DIR,GIT_NO_LAZY_FETCH",
      GIT_TRACE2_CONFIG_PARAMS: "http.*",
    });
  }
  return Object.assign(environment, overrides);
}

function runGate(context, checkout, { event = "", argv = [], overrides = {}, temporary, spy = false, trace = false, label = "run" } = {}) {
  const tmp = temporary ?? freshTemporary(context, label);
  const logs = path.join(context.scratch, "logs");
  fs.mkdirSync(logs, { recursive: true });
  const spyLog = spy ? path.join(logs, `${label}-${crypto.randomBytes(4).toString("hex")}.spy.jsonl`) : "";
  const traceLog = trace ? path.join(logs, `${label}-${crypto.randomBytes(4).toString("hex")}.trace.jsonl`) : "";
  const environment = gateEnvironment(context, { event, temporary: tmp, overrides, spyLog, trace: traceLog });
  const result = spawnSync(process.execPath, [GATE_RELATIVE, ...argv], { cwd: checkout, encoding: "utf8", env: environment });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    temporary: tmp,
    realTemporary: real(tmp),
    spy: spy ? readJsonLines(spyLog) : [],
    trace: trace ? readTrace(traceLog) : [],
  };
}

function runGateAsync(context, checkout, { event = "", temporary, spyLog = "", detached = false }) {
  const environment = gateEnvironment(context, { event, temporary, spyLog });
  const child = spawn(process.execPath, [GATE_RELATIVE], { cwd: checkout, env: environment, detached, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const done = new Promise((resolve) => child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr })));
  return { child, done };
}

function readJsonLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((entry) => JSON.parse(entry));
}

/** trace2 events grouped per git process: argv, and every def_param (env vars and config). */
function readTrace(file) {
  const processes = new Map();
  for (const event of readJsonLines(file)) {
    if (!processes.has(event.sid)) processes.set(event.sid, { sid: event.sid, argv: [], params: [] });
    const entry = processes.get(event.sid);
    if (event.event === "start") entry.argv = event.argv ?? [];
    if (event.event === "def_param") entry.params.push([event.param, String(event.value ?? "")]);
  }
  return [...processes.values()];
}

function traceGitDir(entry) {
  const found = entry.params.find(([name]) => name === "GIT_DIR");
  return found ? found[1] : "";
}

function disposableProcesses(result) {
  return result.trace.filter((entry) => {
    const gitDir = traceGitDir(entry);
    return path.isAbsolute(gitDir) && isInside(path.resolve(gitDir), result.realTemporary);
  });
}

/* ----------------------------------------------------------- assertions ---- */

/** Checked FIRST after every run, so a revert fails on the damage itself rather than on a later contract check. */
function assertNoMutation(context, id, checkout, before) {
  assert.deepStrictEqual(fingerprint(context, checkout), before, `${id}: the gate changed the checkout's git state`);
}

function assertCheckoutUntouched(context, id, checkout, before, result) {
  assertNoMutation(context, id, checkout, before);
  assert.deepStrictEqual(fs.readdirSync(result.temporary), [], `${id}: a comparison repository was left in TMPDIR`);
  assert.ok(!`${result.stdout}\n${result.stderr}`.includes(context.marker), `${id}: the credential marker reached gate output`);
}

function assertRefusal(id, result) {
  assert.equal(result.status, 2, `${id}: exit ${result.status}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /cannot establish a complete comparison history/, id);
  assert.match(result.stderr, /refusing a vacuous green/, id);
  assert.doesNotMatch(result.stderr, /git fetch .* failed/, id);
  assert.doesNotMatch(result.stdout, /added workflow\(s\)/, id);
}

/**
 * R-4 at the spawn level: the recovery fetch never runs with the checkout as its
 * repository, checkout-side reads always forbid lazy fetching, disposable-side
 * calls carry only GIT_DIR, and no argv is prefixed with --git-dir, -C or -c.
 * Returns the disposable GIT_DIRs seen.
 */
function assertSpawnContract(context, id, checkout, result) {
  const realCheckout = real(checkout);
  assert.ok(result.spy.length > 0, `${id}: the spy recorded no git spawn at all`);
  const disposable = new Set();
  let fetches = 0;
  for (const entry of result.spy) {
    const label = `${id}: git ${entry.argv.join(" ")}`;
    assert.match(entry.argv[0] ?? "", /^[a-z][a-z-]*$/, `${label}: argv must start with the subcommand (no --git-dir, -C or -c)`);
    const gitDir = entry.env.GIT_DIR;
    const isInit = entry.argv[0] === "init" && entry.argv.includes("--bare");
    if (gitDir || isInit) {
      const location = gitDir ?? entry.argv[entry.argv.length - 1];
      assert.ok(path.isAbsolute(location), `${label}: disposable location must be absolute`);
      assert.ok(isInside(location, result.realTemporary), `${label}: disposable repository ${location} is not under the real TMPDIR ${result.realTemporary}`);
      for (const name of LOCATION_VARIABLES.filter((variable) => variable !== "GIT_DIR")) {
        assert.ok(!(name in entry.env), `${label}: inherited ${name} reached a disposable-repository call`);
      }
      assert.equal(entry.env.GIT_TERMINAL_PROMPT, "0", `${label}: credential prompts must fail fast`);
      if (gitDir) {
        disposable.add(gitDir);
        assert.equal(path.resolve(entry.cwd), path.resolve(gitDir), `${label}: disposable calls run from the disposable repository`);
      }
      if (isInit) assert.ok(entry.argv.includes("--template="), `${label}: init must not copy templates or hooks`);
    } else {
      assert.equal(entry.env.GIT_NO_LAZY_FETCH, "1", `${label}: a checkout-side call may lazily fetch into the checkout`);
      assert.equal(real(entry.cwd), realCheckout, `${label}: checkout-side calls run from the checkout`);
    }
    if (entry.argv[0] === "fetch") {
      fetches += 1;
      assert.ok(gitDir && isInside(gitDir, result.realTemporary), `${label}: the recovery fetch ran against the checkout`);
      assert.deepStrictEqual(entry.argv.slice(0, 5), ["fetch", "--no-tags", "--filter=blob:none", "--depth=1024", "origin"], label);
      assert.ok(entry.config !== null, `${label}: disposable config missing at fetch time`);
      assert.doesNotMatch(entry.config, /\[http/i, `${label}: an http.* section was copied into the disposable repository`);
      assert.ok(!entry.config.includes(context.marker), `${label}: the credential marker was copied into the disposable repository`);
      assert.doesNotMatch(entry.config, /\[include/i, `${label}: include directives were copied into the disposable repository`);
      assert.match(entry.config, /\[gc\][^[]*\bauto = 0/, `${label}: gc.auto must be 0`);
      assert.match(entry.config, /\[maintenance\][^[]*\bauto = false/, `${label}: maintenance.auto must be false`);
      const hooksPath = /hooksPath = (.+)/.exec(entry.config)?.[1];
      assert.ok(hooksPath && !fs.existsSync(hooksPath), `${label}: hooks must point at a path that does not exist`);
      assert.ok(entry.alternates, `${label}: the disposable repository must borrow objects through alternates`);
    }
  }
  assert.ok(fetches > 0, `${id}: no recovery fetch was observed, so this case proves nothing`);
  assert.equal(disposable.size, 1, `${id}: expected exactly one disposable repository per run, saw ${[...disposable].join(", ")}`);
  return disposable;
}

/** R-9 through trace2: no disposable-repository git process ever sees the credential. */
function assertCredentialConfined(context, id, result) {
  const disposable = disposableProcesses(result);
  assert.ok(
    disposable.some((entry) => entry.argv.includes("fetch") && entry.argv.includes("--depth=1024")),
    `${id}: trace2 shows no recovery fetch inside a disposable repository`,
  );
  // Control: the oracle can see the marker at all (checkout-side processes read the checkout config).
  const seen = result.trace.flatMap((entry) => entry.params.map(([, value]) => value));
  assert.ok(seen.some((value) => value.includes(`${context.marker}-local`)), `${id}: trace2 control never saw the local credential`);
  assert.ok(seen.some((value) => value.includes(`${context.marker}-included`)), `${id}: trace2 control never saw the includeIf credential`);
  for (const entry of disposable) {
    for (const [name, value] of entry.params) {
      assert.ok(!value.includes(context.marker), `${id}: git ${entry.argv.join(" ")} in the disposable repository saw ${name}`);
      assert.ok(!name.startsWith("http."), `${id}: git ${entry.argv.join(" ")} in the disposable repository has ${name} configured`);
    }
  }
}

/* ---------------------------------------------------------------- tests ---- */

test("issue #3455 tester: the topology gate cannot be made to touch its checkout", async (t) => {
  const scratch = real(fs.mkdtempSync(path.join(os.tmpdir(), "issue-3455-tester-")));
  try {
    const context = buildFixture(scratch);
    const { origin } = context;

    await t.test("T-1 spawn contract: the recovery fetch only ever runs in a disposable repository", () => {
      const checkout = pushCheckout(context, "spawn-contract");
      const before = fingerprint(context, checkout);
      const result = runGate(context, checkout, { event: "push", spy: true, trace: true, label: "t1" });
      assertNoMutation(context, "T-1", checkout, before);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, context.pushVerdict);
      assert.match(result.stdout, /authority: noncanonical-fixture\./);
      assertSpawnContract(context, "T-1", checkout, result);
      const fetch = result.spy.find((entry) => entry.argv[0] === "fetch");
      assert.equal(real(fetch.alternates.trim()), real(path.join(checkout, ".git", "objects")), "T-1: alternates must name the checkout object store");
      assert.equal(fetch.shallowCopied, true, "T-1: the checkout's shallow file must be copied before the fetch");
      assertCredentialConfined(context, "T-1", result);
      assertCheckoutUntouched(context, "T-1", checkout, before, result);
    });

    await t.test("T-2 credentials stay confined on exit 1, exit 2 and a failed recovery fetch", () => {
      const violation = actionsCheckout(context, "credential-violation", {
        sha: origin.violation,
        destination: "refs/remotes/origin/violation",
        branch: "violation",
      });
      const refusal = pushCheckout(context, "credential-refusal");
      const failure = pushCheckout(context, "credential-fetch-failure");
      git(context, ["remote", "set-url", "origin", `file://${path.join(scratch, "no-such-origin.git")}`], failure);

      const scenarios = [
        {
          id: "T-2a exit 1",
          checkout: violation,
          options: { event: "violation" },
          exit: 1,
          verify: (result) => {
            assert.match(result.stdout, new RegExp(`\\b1 added workflow\\(s\\) in ${origin.tip}\\.\\.${origin.violation}\\.`));
            assert.match(result.stderr, /fixture-unapproved-lane\.yml: new capability workflow has no valid approval token/);
          },
        },
        {
          id: "T-2b exit 2 refusal",
          checkout: refusal,
          options: { event: "push", argv: ["--base", BOGUS_BASE, "--head", "HEAD"] },
          exit: 2,
          verify: (result) => assertRefusal("T-2b", result),
        },
        {
          id: "T-2c failed fetch",
          checkout: failure,
          options: { event: "push" },
          exit: 2,
          verify: (result) =>
            assert.match(
              result.stderr,
              /git fetch --no-tags --filter=blob:none --depth=1024 origin \+refs\/heads\/main:refs\/remotes\/origin\/main failed:/,
            ),
        },
      ];
      for (const scenario of scenarios) {
        const before = fingerprint(context, scenario.checkout);
        const result = runGate(context, scenario.checkout, { ...scenario.options, spy: true, trace: true, label: "t2" });
        assertNoMutation(context, scenario.id, scenario.checkout, before);
        assert.equal(result.status, scenario.exit, `${scenario.id}: exit ${result.status}\n${result.stdout}\n${result.stderr}`);
        scenario.verify(result);
        assertSpawnContract(context, scenario.id, scenario.checkout, result);
        assertCredentialConfined(context, scenario.id, result);
        assertCheckoutUntouched(context, scenario.id, scenario.checkout, before, result);
      }
    });

    await t.test("T-3 inherited GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE aimed at a victim repository", () => {
      const checkout = pushCheckout(context, "hostile-gitdir");
      const victim = pushCheckout(context, "victim-of-gitdir");
      const victimIndex = path.join(victim, ".git", "index");
      const beforeCheckout = fingerprint(context, checkout);
      const beforeVictim = fingerprint(context, victim);
      const result = runGate(context, checkout, {
        event: "push",
        spy: true,
        label: "t3",
        overrides: { GIT_DIR: path.join(victim, ".git"), GIT_WORK_TREE: victim, GIT_INDEX_FILE: victimIndex },
      });
      assert.deepStrictEqual(fingerprint(context, victim), beforeVictim, "T-3: the victim repository was written");
      assertNoMutation(context, "T-3", checkout, beforeCheckout);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, context.pushVerdict);
      // Checkout-side reads honour the inherited GIT_DIR (today's behaviour); the spy checks the rest.
      for (const entry of result.spy.filter((candidate) => candidate.env.GIT_DIR === path.join(victim, ".git"))) {
        assert.equal(entry.env.GIT_NO_LAZY_FETCH, "1", `T-3: git ${entry.argv.join(" ")} read the victim with lazy fetching enabled`);
        assert.notEqual(entry.argv[0], "fetch", "T-3: the recovery fetch ran against the inherited victim GIT_DIR");
      }
      const disposable = result.spy.filter((entry) => entry.env.GIT_DIR && isInside(entry.env.GIT_DIR, result.realTemporary));
      assert.ok(disposable.some((entry) => entry.argv[0] === "fetch"), "T-3: no recovery fetch ran in a disposable repository");
      for (const entry of disposable) {
        for (const name of ["GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
          assert.ok(!(name in entry.env), `T-3: inherited ${name} reached disposable git ${entry.argv.join(" ")}`);
        }
      }
      assertCheckoutUntouched(context, "T-3", checkout, beforeCheckout, result);
    });

    await t.test("T-4 inherited GIT_OBJECT_DIRECTORY and GIT_ALTERNATE_OBJECT_DIRECTORIES aimed at a victim store", () => {
      const checkout = pushCheckout(context, "hostile-objects");
      const victim = pushCheckout(context, "victim-of-objects");
      const beforeCheckout = fingerprint(context, checkout);
      const beforeVictim = fingerprint(context, victim);
      const result = runGate(context, checkout, {
        event: "push",
        spy: true,
        label: "t4",
        overrides: {
          GIT_OBJECT_DIRECTORY: path.join(victim, ".git", "objects"),
          GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(checkout, ".git", "objects"),
        },
      });
      assert.deepStrictEqual(fingerprint(context, victim), beforeVictim, "T-4: the victim object store was written");
      assertNoMutation(context, "T-4", checkout, beforeCheckout);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, context.pushVerdict);
      assertSpawnContract(context, "T-4", checkout, result);
      assertCheckoutUntouched(context, "T-4", checkout, beforeCheckout, result);
    });

    await t.test("T-5 TMPDIR inside the checkout is refused before anything is created; outside is accepted", () => {
      const checkout = pushCheckout(context, "temp-guard");
      const worktreeName = "temp-guard-worktree";
      const worktree = path.join(scratch, "checkouts", worktreeName);
      git(context, ["worktree", "add", "-q", "--detach", worktree, "HEAD"], checkout);
      const intoCheckout = path.join(scratch, "link-into-checkout");
      fs.symlinkSync(path.join(checkout, ".github"), intoCheckout);
      const aliasOfCheckout = path.join(scratch, "alias-of-checkout");
      fs.symlinkSync(checkout, aliasOfCheckout);

      const refusals = [
        { id: "T-5a relative dot", from: checkout, tmpdir: ".", expected: real(checkout) },
        { id: "T-5b relative inside .git", from: checkout, tmpdir: ".git/objects", expected: real(path.join(checkout, ".git", "objects")) },
        { id: "T-5c symlink into the working tree", from: checkout, tmpdir: intoCheckout, expected: real(path.join(checkout, ".github")) },
        { id: "T-5d alias of the checkout with a trailing slash", from: checkout, tmpdir: `${aliasOfCheckout}/`, expected: real(checkout) },
        {
          id: "T-5e linked worktree admin directory",
          from: worktree,
          tmpdir: path.join(checkout, ".git", "worktrees", worktreeName),
          expected: real(path.join(checkout, ".git", "worktrees", worktreeName)),
        },
      ];
      for (const refusal of refusals) {
        const before = fingerprint(context, refusal.from);
        const beforeCommon = fingerprint(context, checkout);
        const holder = freshTemporary(context, "t5-holder");
        const result = runGate(context, refusal.from, {
          event: "push",
          spy: true,
          temporary: holder,
          label: "t5",
          overrides: { TMPDIR: refusal.tmpdir },
        });
        assert.deepStrictEqual(fingerprint(context, checkout), beforeCommon, `${refusal.id}: common directory changed`);
        assertNoMutation(context, refusal.id, refusal.from, before);
        assert.equal(result.status, 2, `${refusal.id}: exit ${result.status}\n${result.stdout}\n${result.stderr}`);
        assert.ok(
          result.stderr.includes(`INCONCLUSIVE: refusing to create the comparison repository inside the checkout (${refusal.expected})`),
          `${refusal.id}: ${result.stderr}`,
        );
        const writes = result.spy.filter(
          (entry) => ["init", "fetch", "update-ref", "symbolic-ref"].includes(entry.argv[0]) || (entry.argv[0] === "config" && entry.argv[1] !== "--get"),
        );
        assert.deepStrictEqual(writes.map((entry) => entry.argv.join(" ")), [], `${refusal.id}: git wrote something before the refusal`);
        assert.deepStrictEqual(comparisonLeftovers(checkout), [], `${refusal.id}: a comparison directory exists inside the checkout`);
      }

      const sibling = path.join(scratch, "checkouts", "temp-guard-sibling");
      fs.mkdirSync(sibling);
      const before = fingerprint(context, checkout);
      const accepted = runGate(context, checkout, {
        event: "push",
        spy: true,
        temporary: sibling,
        label: "t5f",
        overrides: { TMPDIR: "../temp-guard-sibling" },
      });
      assertNoMutation(context, "T-5f", checkout, before);
      assert.equal(accepted.status, 0, `T-5f relative outside: ${accepted.stdout}\n${accepted.stderr}`);
      assert.match(accepted.stdout, context.pushVerdict);
      assertSpawnContract(context, "T-5f", checkout, accepted);
      assertCheckoutUntouched(context, "T-5f", checkout, before, accepted);
    });

    await t.test("T-6 symlinked checkout path: identity decided on real paths, late identity throw still disposes", () => {
      const checkout = pushCheckout(context, "symlink-real");
      const alias = path.join(scratch, "checkouts", "symlink alias with spaces");
      fs.symlinkSync(checkout, alias);
      const realTemporary = freshTemporary(context, "t6-real");
      const temporaryAlias = path.join(scratch, "tmp alias for t6");
      fs.symlinkSync(realTemporary, temporaryAlias);
      const before = fingerprint(context, checkout);

      const workspace = runGate(context, alias, {
        event: "push",
        temporary: temporaryAlias,
        trace: true,
        label: "t6a",
        overrides: { GITHUB_ACTIONS: "true", GITHUB_WORKSPACE: alias, GITHUB_REPOSITORY: "fixture-owner/fixture-repository" },
      });
      assertNoMutation(context, "T-6a", checkout, before);
      assert.equal(workspace.status, 0, `T-6a: ${workspace.stdout}\n${workspace.stderr}`);
      assert.match(workspace.stdout, context.pushVerdict);
      assert.match(workspace.stdout, /authority: noncanonical-fixture\./);
      assert.ok(disposableProcesses(workspace).some((entry) => entry.argv.includes("fetch")), "T-6a: no disposable fetch observed");
      assertCheckoutUntouched(context, "T-6a", checkout, before, workspace);
      assert.deepStrictEqual(fingerprint(context, alias), before, "T-6a: the checkout seen through its alias changed");

      const conflict = runGate(context, alias, {
        event: "push",
        trace: true,
        label: "t6b",
        overrides: { GITHUB_ACTIONS: "true", GITHUB_WORKSPACE: ".", GITHUB_REPOSITORY: "Mingla-LLC/mingla-main" },
      });
      assertNoMutation(context, "T-6b", checkout, before);
      assert.equal(conflict.status, 2, `T-6b: ${conflict.stdout}\n${conflict.stderr}`);
      assert.ok(
        conflict.stderr.includes(
          `INCONCLUSIVE: ambiguous repository identity: GITHUB_REPOSITORY=Mingla-LLC/mingla-main, origin=${origin.url}`,
        ),
        `T-6b: ${conflict.stderr}`,
      );
      assert.ok(
        disposableProcesses(conflict).some((entry) => entry.argv.includes("fetch")),
        "T-6b: the identity throw must come AFTER a disposable repository existed, or it proves no cleanup",
      );
      assertCheckoutUntouched(context, "T-6b", checkout, before, conflict);
    });

    await t.test("T-7 malformed BASE registry: lazy blob fetch lands in the disposable repository, the throw still disposes", () => {
      const checkout = actionsCheckout(context, "canonical-malformed-registry", {
        sha: origin.registryHead,
        destination: "refs/remotes/origin/registry",
        branch: "registry",
        url: origin.canonicalUrl,
      });
      const baseBlob = git(context, ["rev-parse", `${origin.malformed}:${REGISTRY}`], origin.origin);
      assert.equal(
        git(context, ["cat-file", "-e", baseBlob], checkout, { allowFailure: true, environment: { GIT_NO_LAZY_FETCH: "1" } }),
        null,
        "T-7: the base registry blob must be absent from the checkout, or no lazy fetch is exercised",
      );
      const before = fingerprint(context, checkout);
      const result = runGate(context, checkout, { event: "registry", trace: true, label: "t7" });
      assertNoMutation(context, "T-7", checkout, before);
      assert.equal(result.status, 2, `T-7: ${result.stdout}\n${result.stderr}`);
      assert.ok(
        result.stderr.includes(`INCONCLUSIVE: ${origin.malformed}:${REGISTRY}: invalid JSON:`),
        `T-7: the malformed base registry was not what failed: ${result.stderr}`,
      );
      assert.doesNotMatch(result.stdout, /added workflow\(s\)/);
      const lazy = result.trace.filter((entry) => entry.argv.includes("fetch") && entry.argv.includes("--stdin"));
      assert.ok(lazy.length > 0, "T-7: no lazy blob fetch happened, so the blob path was not exercised");
      for (const entry of lazy) {
        const gitDir = traceGitDir(entry);
        assert.ok(
          path.isAbsolute(gitDir) && isInside(gitDir, result.realTemporary),
          `T-7: a lazy fetch ran outside the disposable repository (GIT_DIR=${gitDir || "<unset>"})`,
        );
      }
      assertCheckoutUntouched(context, "T-7", checkout, before, result);
    });

    await t.test("T-8 partial-clone checkouts: slow path lazy-fetches only into the disposable repository; fast path never writes", () => {
      const slow = path.join(scratch, "checkouts", "partial-shallow");
      git(context, ["clone", "-q", "--filter=blob:none", "--depth=1", "--no-tags", "--branch", "main", origin.url, slow], scratch);
      plantCredentials(context, slow);
      assertCurrentGate(context, slow);
      const beforeSlow = fingerprint(context, slow);
      const slowResult = runGate(context, slow, { event: "push", trace: true, label: "t8a" });
      assertNoMutation(context, "T-8a", slow, beforeSlow);
      assert.equal(slowResult.status, 0, `T-8a: ${slowResult.stdout}\n${slowResult.stderr}`);
      assert.match(slowResult.stdout, context.pushVerdict);
      const lazy = slowResult.trace.filter((entry) => entry.argv.includes("fetch") && entry.argv.includes("--stdin"));
      assert.ok(lazy.length > 0, "T-8a: rename detection fetched no blob, so the partial-clone blob path was not exercised");
      for (const entry of lazy) {
        assert.ok(isInside(traceGitDir(entry), slowResult.realTemporary), `T-8a: lazy fetch outside the disposable repository`);
      }
      assertCheckoutUntouched(context, "T-8a", slow, beforeSlow, slowResult);

      const fast = path.join(scratch, "checkouts", "partial-full-history");
      git(context, ["clone", "-q", "--filter=blob:none", "--no-tags", "--branch", "main", origin.url, fast], scratch);
      plantCredentials(context, fast);
      assertCurrentGate(context, fast);
      assert.ok(git(context, ["merge-base", origin.parent, origin.tip], fast), "T-8b: the fast path needs the merge base present");
      const beforeFast = fingerprint(context, fast);
      const fastResult = runGate(context, fast, { event: "push", trace: true, label: "t8b" });
      assertNoMutation(context, "T-8b", fast, beforeFast);
      assert.equal(fastResult.status, 2, `T-8b: a missing blob on the fast path must fail closed: ${fastResult.stdout}\n${fastResult.stderr}`);
      assert.match(fastResult.stderr, /INCONCLUSIVE: git diff --diff-filter=A --name-only \S+ -- \.github\/workflows\/ failed:/);
      assert.deepStrictEqual(disposableProcesses(fastResult), [], "T-8b: the fast path must not build a disposable repository");
      assert.deepStrictEqual(
        fastResult.trace.filter((entry) => entry.argv.includes("fetch")).map((entry) => entry.argv.join(" ")),
        [],
        "T-8b: the fast path fetched",
      );
      assertCheckoutUntouched(context, "T-8b", fast, beforeFast, fastResult);
    });

    await t.test("T-9 concurrent gate runs on one checkout share TMPDIR without colliding", async () => {
      const checkout = pushCheckout(context, "concurrent");
      const shared = freshTemporary(context, "t9-shared");
      const before = fingerprint(context, checkout);
      const logs = [0, 1, 2].map((index) => path.join(scratch, "logs", `t9-${index}.spy.jsonl`));
      const results = await Promise.all(
        logs.map((spyLog) => runGateAsync(context, checkout, { event: "push", temporary: shared, spyLog }).done),
      );
      assertNoMutation(context, "T-9", checkout, before);
      const disposable = new Set();
      results.forEach((result, index) => {
        assert.equal(result.status, 0, `T-9 run ${index}: ${result.stdout}\n${result.stderr}`);
        assert.match(result.stdout, context.pushVerdict);
        const entries = readJsonLines(logs[index]);
        const runDirectories = assertSpawnContract(context, `T-9 run ${index}`, checkout, {
          ...result,
          spy: entries,
          realTemporary: real(shared),
        });
        for (const directory of runDirectories) disposable.add(directory);
      });
      assert.equal(disposable.size, 3, `T-9: concurrent runs must use distinct disposable repositories: ${[...disposable].join(", ")}`);
      assertCheckoutUntouched(context, "T-9", checkout, before, { temporary: shared, stdout: "", stderr: results.map((r) => r.stderr).join("\n") });
    });

    await t.test("T-10 SIGKILL of the whole process group never reaches the checkout", async (subtest) => {
      const checkout = pushCheckout(context, "killed");
      const shared = freshTemporary(context, "t10-shared");
      const before = fingerprint(context, checkout);
      for (const delay of [40, 120, 220, 350, 600, 900]) {
        const { child, done } = runGateAsync(context, checkout, { event: "push", temporary: shared, detached: true });
        const timer = setTimeout(() => {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            // the run already finished
          }
        }, delay);
        await done;
        clearTimeout(timer);
        const deadline = Date.now() + 10_000;
        for (;;) {
          try {
            process.kill(-child.pid, 0);
          } catch {
            break;
          }
          assert.ok(Date.now() < deadline, `T-10: process group of the run killed at ${delay} ms did not exit`);
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.deepStrictEqual(fingerprint(context, checkout), before, `T-10: killed at ${delay} ms, the checkout changed`);
      }
      const residue = fs.readdirSync(shared).sort();
      for (const name of residue) {
        assert.ok(name.startsWith(COMPARISON_PREFIX), `T-10: unexpected residue ${name} in TMPDIR`);
        const config = path.join(shared, name, "repo.git", "config");
        if (fs.existsSync(config)) {
          const text = fs.readFileSync(config, "utf8");
          assert.ok(!text.includes(context.marker), `T-10: the credential marker is in killed residue ${name}`);
          assert.doesNotMatch(text, /\[http/i, `T-10: an http section is in killed residue ${name}`);
        }
      }
      const recovered = runGate(context, checkout, { event: "push", temporary: shared, label: "t10" });
      assert.equal(recovered.status, 0, `T-10: a run after the kills failed: ${recovered.stdout}\n${recovered.stderr}`);
      assert.match(recovered.stdout, context.pushVerdict);
      assert.deepStrictEqual(fs.readdirSync(shared).sort(), residue, "T-10: a later run must neither leave nor sweep comparison directories");
      assert.deepStrictEqual(fingerprint(context, checkout), before, "T-10: the recovery run changed the checkout");
      for (const name of residue) fs.rmSync(path.join(shared, name), { recursive: true, force: true, maxRetries: 3 });
      subtest.diagnostic(`T-10: ${residue.length} killed run(s) left a directory under TMPDIR (never in the checkout)`);
    });

    await t.test("T-11 hostile global git config: no hook ever runs against the checkout; reftable and explicit-bare policies still compute", (subtest) => {
      const checkout = pushCheckout(context, "hostile-global-config");
      const sentinel = path.join(scratch, "hook-sentinel");
      const hooks = path.join(scratch, "hostile-hooks");
      const template = path.join(scratch, "hostile-template");
      fs.mkdirSync(hooks);
      fs.mkdirSync(path.join(template, "hooks"), { recursive: true });
      const hook = [
        "#!/bin/sh",
        `printf '%s\\t%s\\t%s\\t%s\\n' "$(basename "$0")" "$1" "$(pwd -P)" "\${GIT_DIR:-}" >> ${JSON.stringify(sentinel)}`,
        "cat >/dev/null 2>&1 || true",
        "exit 0",
        "",
      ].join("\n");
      for (const name of ["reference-transaction", "pre-auto-gc", "post-checkout", "post-index-change", "fsmonitor-watchman"]) {
        fs.writeFileSync(path.join(hooks, name), hook, { mode: 0o755 });
        fs.writeFileSync(path.join(template, "hooks", name), hook, { mode: 0o755 });
      }
      const hostile = path.join(scratch, "hostile-global.gitconfig");
      fs.writeFileSync(
        hostile,
        [
          "[safe]",
          "\tbareRepository = explicit",
          "[core]",
          `\thooksPath = ${hooks}`,
          "[init]",
          "\tdefaultRefFormat = reftable",
          `\ttemplateDir = ${template}`,
          "[gc]",
          "\tauto = 1",
          "\tautoDetach = false",
          "[maintenance]",
          "\tauto = true",
          "[fetch]",
          "\twriteCommitGraph = true",
          "",
        ].join("\n"),
      );
      const before = fingerprint(context, checkout);
      const result = runGate(context, checkout, { event: "push", trace: true, label: "t11", overrides: { GIT_CONFIG_GLOBAL: hostile } });
      assertNoMutation(context, "T-11", checkout, before);
      assert.equal(result.status, 0, `T-11: ${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, context.pushVerdict);
      // `git init` itself runs a globally configured reference-transaction hook for the new
      // repository's HEAD, before a local core.hooksPath can exist (#3455 TEST finding). That
      // is confined to the disposable repository; a hook running against the checkout, which
      // is what an in-place fetch does, is the failure.
      const firings = fs.existsSync(sentinel) ? fs.readFileSync(sentinel, "utf8").split("\n").filter(Boolean) : [];
      for (const firing of firings) {
        const [hookName, phase, cwd, gitDir] = firing.split("\t");
        const repository = path.resolve(cwd, gitDir || ".");
        assert.ok(
          isInside(repository, result.realTemporary),
          `T-11: hook ${hookName} (${phase}) ran against ${repository}, outside the disposable repository`,
        );
      }
      assert.ok(disposableProcesses(result).some((entry) => entry.argv.includes("fetch")), "T-11: no disposable fetch observed");
      subtest.diagnostic(`T-11: ${firings.length} global hook firing(s), all inside the disposable repository`);
      assertCheckoutUntouched(context, "T-11", checkout, before, result);
    });

    await t.test("T-12 a checkout that borrows its objects through alternates: the borrowed store is untouched too", () => {
      const store = path.join(scratch, "checkouts", "borrowed-store");
      git(context, ["clone", "-q", "--depth=1", "--no-tags", "--branch", "main", origin.url, store], scratch);
      const checkout = path.join(scratch, "checkouts", "borrowing");
      git(context, ["init", "-q", checkout], scratch);
      fs.writeFileSync(path.join(checkout, ".git", "objects", "info", "alternates"), `${path.join(store, ".git", "objects")}\n`);
      git(context, ["remote", "add", "origin", origin.url], checkout);
      git(context, ["config", "--local", "gc.auto", "0"], checkout);
      plantCredentials(context, checkout);
      git(context, ["fetch", "-q", "--no-tags", "--depth=1", "origin", `+${origin.tip}:refs/remotes/origin/main`], checkout);
      git(context, ["checkout", "-q", "--force", "-B", "main", "refs/remotes/origin/main"], checkout);
      assertCurrentGate(context, checkout);
      const beforeStore = fingerprint(context, store);
      const before = fingerprint(context, checkout);
      const result = runGate(context, checkout, { event: "push", trace: true, label: "t12" });
      assert.deepStrictEqual(fingerprint(context, store), beforeStore, "T-12: the borrowed object store changed");
      assertNoMutation(context, "T-12", checkout, before);
      assert.equal(result.status, 0, `T-12: ${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, context.pushVerdict);
      assertCredentialConfined(context, "T-12", result);
      assertCheckoutUntouched(context, "T-12", checkout, before, result);
    });

    await t.test("T-13 thousands of refs plus symbolic, dangling, tag and tree refs seed without changing the verdict", (subtest) => {
      const checkout = pushCheckout(context, "many-refs");
      const tree = git(context, ["rev-parse", "HEAD^{tree}"], checkout);
      const lines = [];
      for (let index = 0; index < 3000; index += 1) lines.push(`create refs/fixture/bulk/r${String(index).padStart(4, "0")} ${origin.tip}\n`);
      lines.push(`create refs/fixture/tree ${tree}\n`);
      git(context, ["update-ref", "--stdin"], checkout, { input: Buffer.from(lines.join(""), "utf8") });
      git(context, ["tag", "-a", "-m", "annotated fixture tag", "fixture-annotated", "HEAD"], checkout);
      git(context, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], checkout);
      git(context, ["symbolic-ref", "refs/remotes/origin/DANGLING", "refs/remotes/origin/nowhere"], checkout);
      git(context, ["pack-refs", "--all"], checkout);
      const before = fingerprint(context, checkout);
      const started = Date.now();
      const result = runGate(context, checkout, { event: "push", spy: true, label: "t13" });
      const elapsed = Date.now() - started;
      assertNoMutation(context, "T-13", checkout, before);
      assert.equal(result.status, 0, `T-13: ${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, context.pushVerdict);
      assertSpawnContract(context, "T-13", checkout, result);
      assertCheckoutUntouched(context, "T-13", checkout, before, result);
      subtest.diagnostic(`T-13: gate run with 3,000+ refs (spy included) took ${elapsed} ms`);
    });

    await t.test("T-14 force-pushed PR head: the unreachable event head is lazily fetched into the disposable repository", () => {
      const checkout = actionsCheckout(context, "stale-pr-head", { sha: origin.merge, destination: "refs/remotes/pull/1/merge" });
      assert.equal(
        git(context, ["cat-file", "-e", `${origin.stalePrHead}^{commit}`], checkout, { allowFailure: true, environment: { GIT_NO_LAZY_FETCH: "1" } }),
        null,
        "T-14: the stale head must be absent from the checkout",
      );
      const before = fingerprint(context, checkout);
      const result = runGate(context, checkout, { event: "stalePr", trace: true, label: "t14" });
      assertNoMutation(context, "T-14", checkout, before);
      assert.equal(result.status, 0, `T-14: ${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, new RegExp(`\\b1 added workflow\\(s\\) in ${origin.tip}\\.\\.${origin.stalePrHead}\\.`));
      assert.match(result.stdout, /PASS\./);
      const lazy = result.trace.filter((entry) => entry.argv.includes("fetch") && entry.argv.includes("--stdin"));
      assert.ok(lazy.length > 0, "T-14: the stale head was not lazily fetched, so the race was not exercised");
      for (const entry of lazy) assert.ok(isInside(traceGitDir(entry), result.realTemporary), "T-14: lazy fetch outside the disposable repository");
      assertCheckoutUntouched(context, "T-14", checkout, before, result);
    });

    await t.test("T-15 a comparison repository that cannot be removed warns once and never changes the verdict", (subtest) => {
      if (typeof process.getuid === "function" && process.getuid() === 0) {
        subtest.skip("root ignores directory permissions, so removal cannot be made to fail");
        return;
      }
      const checkout = pushCheckout(context, "cleanup-failure");
      const before = fingerprint(context, checkout);
      const result = runGate(context, checkout, {
        event: "push",
        spy: true,
        label: "t15",
        overrides: { ISSUE_3455_SPY_LOCK_ROOT: "1" },
      });
      try {
        assertNoMutation(context, "T-15", checkout, before);
        assert.equal(result.status, 0, `T-15: ${result.stdout}\n${result.stderr}`);
        assert.match(result.stdout, context.pushVerdict);
        assert.match(result.stdout, /I-PROPOSED-2148-CI-TOPOLOGY-BOUNDED: PASS\./);
        const warnings = result.stderr.split("\n").filter((entry) => entry.startsWith("Issue #3455: could not remove the comparison repository "));
        assert.equal(warnings.length, 1, `T-15: expected exactly one cleanup warning:\n${result.stderr}`);
        const [, leftover] = /^Issue #3455: could not remove the comparison repository (.+): [A-Z]+$/.exec(warnings[0]) ?? [];
        assert.ok(leftover && isInside(leftover, result.realTemporary), `T-15: warning must name the directory under TMPDIR: ${warnings[0]}`);
        assert.deepStrictEqual(fs.readdirSync(result.temporary), [path.basename(leftover)], "T-15: only the locked directory may remain");
        assert.deepStrictEqual(fingerprint(context, checkout), before, "T-15: the checkout changed");
      } finally {
        for (const name of fs.readdirSync(result.temporary)) {
          fs.chmodSync(path.join(result.temporary, name), 0o755);
          fs.rmSync(path.join(result.temporary, name), { recursive: true, force: true });
        }
      }
    });
  } finally {
    const restore = (directory) => {
      if (!fs.existsSync(directory)) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          try {
            fs.chmodSync(full, 0o755);
          } catch {
            // best effort
          }
          restore(full);
        }
      }
    };
    restore(path.join(scratch));
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
  }
});
