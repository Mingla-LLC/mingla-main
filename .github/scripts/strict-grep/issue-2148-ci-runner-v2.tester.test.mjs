import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";

import {
  buildShardReport,
  createIsolatedWorkspace,
  renderSummary,
  runInvocation,
  runSuiteV2,
  verdict,
} from "../ci-batch/run-suite-batch.mjs";
import {
  DEFAULT_MANIFEST,
  DEFAULT_ROOT,
  forbiddenEmbeddedSetup,
  SUITES_ADDED_SINCE_SEAL,
  validatePhase2Contract,
} from "../ci-batch/validate-manifest-v2.mjs";

const readManifest = () => JSON.parse(fs.readFileSync(DEFAULT_MANIFEST, "utf8"));
const temporaryDirectory = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
const batchWorkflow = () => path.join(DEFAULT_ROOT, ".github/workflows", ["ci", "batch.yml"].join("-"));
// [TEST-MOD-APPROVED #3078] WIDENED from three events to four: `schedule` joins
// the set. #2882 defined three CI tiers but delivered two — a pull request runs
// the suites its diff invalidates, a push to `main` runs all 85, and the full
// corpus runs nightly. The nightly had no trigger, so #2882's AC-1 was formally
// amended to two tiers and the third was split out to #3078, which adds it.
//
// This is a WIDENING, not a weakening. It stays a set EQUALITY: a fifth event
// still turns this red, so adding one remains a deliberate act with a review
// attached. That property is the entire reason the set is pinned here rather
// than folded into a digest, and moving to a subset check would have deleted
// the only thing this assertion does. #2882's spec named none of the three
// sites that hold this pin, which is how the nightly became its own issue.
const EXPECTED_BATCH_EVENTS = ["pull_request", "push", "schedule", "workflow_dispatch"];
const RUBY_EVENT_NAMES = String.raw`
require "yaml"; require "json"
doc = YAML.safe_load(STDIN.read, aliases: true) || {}
raw = doc.key?("on") ? doc["on"] : doc[true]
events = case raw
         when Hash then raw.keys.map(&:to_s)
         when Array then raw.map(&:to_s)
         when String then [raw]
         else []
         end
STDOUT.write(JSON.generate(events.sort))`;
const batchEventNames = (source) => JSON.parse(execFileSync("ruby", ["-e", RUBY_EVENT_NAMES], { input: source, encoding: "utf8" }));
const assertBatchTriggerBoundary = (source) => assert.deepEqual(
  batchEventNames(source), EXPECTED_BATCH_EVENTS, "ci-batch top-level event set must remain pull_request/push/schedule/workflow_dispatch",
);
const assertTargetTriggerMutantFails = (source) => {
  const mutant = source.replace(/^  pull_request:\s*$/m, "  pull_request_target:");
  assert.notEqual(mutant, source, "target-trigger mutant must change the parsed event key");
  assert.throws(() => assertBatchTriggerBoundary(mutant), /ci-batch top-level event set/);
};

function gitFixture(name) {
  const root = temporaryDirectory(name);
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "tester@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Mingla Tester"], { cwd: root });
  fs.writeFileSync(path.join(root, "proof.test.mjs"), "export const proof = true;\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  return root;
}

function suite(overrides = {}) {
  return {
    id: "tester-suite",
    displayName: "Tester suite",
    setupProfile: "none",
    timeoutSeconds: 1,
    isolation: "clean-worktree",
    generatedPaths: [],
    expectedFiles: ["proof.test.mjs"],
    steps: [
      { name: "first", cwd: ".", invocation: { kind: "argv", command: "node", argv: ["--test", "proof.test.mjs"] } },
      { name: "second", cwd: ".", invocation: { kind: "argv", command: "node", argv: ["--test", "proof.test.mjs"] } },
    ],
    ...overrides,
  };
}

function fixtureWorkspace(root) {
  return {
    root,
    cleanup() {},
  };
}

test("shell-equivalent embedded setup and hidden shard installs fail closed", () => {
  const bypasses = [
    " npm ci",
    "\tnpm ci",
    "command npm ci",
    "env FOO=1 npm ci",
    "npm \\\n ci",
    "(npm ci)",
    "if npm ci; then true; fi",
    "sudo npm ci",
    "corepack pnpm install",
    "NPM_CONFIG_FUND=false npm ci",
  ];
  for (const command of bypasses) {
    assert.equal(forbiddenEmbeddedSetup({ cmd: "bash", args: ["-lc", command] }), true, command);
    const manifest = readManifest();
    manifest.suites[0].steps[0] = { cmd: "bash", args: ["-lc", command], cwd: ".", expectedFiles: [] };
    assert.ok(validatePhase2Contract({ root: DEFAULT_ROOT, manifest }).length > 0, command);
  }

  const workflow = fs.readFileSync(batchWorkflow(), "utf8");
  const hiddenInstall = workflow.replace(
    "      - name: Execute and record one typed shard setup",
    "      - name: Hidden second install\n        run: command npm ci\n\n      - name: Execute and record one typed shard setup",
  );
  assert.notEqual(hiddenInstall, workflow, "the hidden-install mutation must alter the typed setup boundary");
  assert.ok(validatePhase2Contract({ root: DEFAULT_ROOT, manifest: readManifest(), workflowText: hiddenInstall }).length > 0);
});

test("the suite deadline is cumulative across every command", async () => {
  const root = gitFixture("issue-2436-cumulative");
  let now = 1_000;
  const budgets = [];
  try {
    const report = await runSuiteV2(suite(), {
      root,
      profile: { install: null },
      workspaceFactory: () => fixtureWorkspace(root),
      now: () => now,
      execute: async (_step, options) => {
        budgets.push(options.timeoutMs);
        now += 600;
        return { ok: true, code: 0, timedOut: false, reason: "" };
      },
    });
    assert.deepEqual(budgets, [1_000, 400]);
    assert.equal(report.status, "passed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a daemonised TERM-ignoring descendant cannot escape timeout cleanup", async () => {
  const root = temporaryDirectory("issue-2436-descendant");
  const marker = path.join(root, "escaped");
  const pidFile = path.join(root, "pid");
  const child = path.join(root, "child.mjs");
  const parent = path.join(root, "parent.mjs");
  fs.writeFileSync(child, `import fs from "node:fs"; process.on("SIGTERM",()=>{}); fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(()=>fs.writeFileSync(${JSON.stringify(marker)}, "escaped"), 500); setInterval(()=>{}, 1000);\n`);
  fs.writeFileSync(parent, `import { spawn } from "node:child_process"; const child=spawn(process.execPath,[${JSON.stringify(child)}],{detached:true,stdio:"ignore"}); child.unref(); setInterval(()=>{},1000);\n`);
  let escaped = false;
  let escapedPid;
  try {
    const result = await runInvocation({ command: process.execPath, argv: [parent] }, { cwd: root, timeoutMs: 150, graceMs: 50 });
    await new Promise((resolve) => setTimeout(resolve, 650));
    escaped = fs.existsSync(marker);
    escapedPid = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, "utf8")) : undefined;
    assert.equal(result.timedOut, true);
    assert.equal(result.code, 124);
    assert.equal(escaped, false);
  } finally {
    if (escapedPid) {
      try { process.kill(escapedPid, "SIGKILL"); } catch {}
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an isolated suite cannot mutate the shared dependency installation through a symlink", async () => {
  const root = gitFixture("issue-2436-dependency-isolation");
  const app = path.join(root, "app");
  const dependency = path.join(app, "node_modules", "fixture-package", "index.js");
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, ".gitignore"), "node_modules/\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "ignore dependency fixture"], { cwd: root });
  fs.mkdirSync(path.dirname(dependency), { recursive: true });
  fs.writeFileSync(dependency, "clean\n");
  let workspace;
  try {
    workspace = createIsolatedWorkspace({
      root,
      profile: { install: { cwd: "app" } },
    });
    const isolatedDependency = path.join(workspace.root, "app", "node_modules", "fixture-package", "index.js");
    const linked = fs.lstatSync(path.join(workspace.root, "app", "node_modules")).isSymbolicLink();
    fs.writeFileSync(isolatedDependency, "contaminated\n");
    const contaminated = fs.readFileSync(dependency, "utf8") === "contaminated\n";
    assert.equal(linked, false);
    assert.equal(contaminated, false);
  } finally {
    workspace?.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("shortfall, over-execution, duplicate identity, missing status, and exit codes remain red", () => {
  const passed = (id) => ({ id, ok: true, code: 0, status: "passed", executed: 1, expected: 1, seconds: 0 });
  assert.equal(verdict(2, [passed("a")]).ok, false);
  assert.equal(verdict(1, [passed("a"), passed("b")]).ok, false);
  assert.equal(verdict(2, [passed("same"), passed("same")]).ok, false);
  assert.equal(verdict(1, [{ id: "a", code: 0, status: undefined, executed: 1, expected: 1, seconds: 0 }]).ok, false);

  const expected = [suite({ id: "a" }), suite({ id: "b" })];
  const report = buildShardReport("A", expected, [passed("a")], { setupProfile: "node20-noinstall", setupExecutions: 1, installExecutions: 0 }, 1);
  assert.equal(report.code, 1);
  assert.match(renderSummary(report), /Executed \*\*1\/2\*\*/);
});

test("JSON and summary redact values present in runner environment", () => {
  const name = "ISSUE_2436_TEST_SECRET";
  const marker = "TOP_SECRET_2436_TESTER";
  const prior = process.env[name];
  process.env[name] = marker;
  try {
    const expected = [suite({ id: "secret-probe" })];
    const results = [{ id: "secret-probe", ok: false, code: 1, status: "failed", reason: `command exposed ${marker}`, executed: 1, expected: 1, seconds: 0 }];
    const report = buildShardReport("A", expected, results, { setupProfile: "node20-noinstall", setupExecutions: 1, installExecutions: 0 }, 1);
    assert.doesNotMatch(JSON.stringify(report), new RegExp(marker));
    assert.doesNotMatch(renderSummary(report), new RegExp(marker));
  } finally {
    if (prior === undefined) delete process.env[name]; else process.env[name] = prior;
  }
});

test("workflow matrix retains the exact trust boundary and independently locked Phase 3A registry", () => {
  // [TEST-MOD-APPROVED #2438] The Phase 3A slice remains exact after Phase 3B is appended.
  const workflow = fs.readFileSync(batchWorkflow(), "utf8");
  const manifest = readManifest();
  assert.match(workflow, /permissions:\s*\n\s+contents:\s*read/);
  // [TEST-MOD-APPROVED #2851] The old whole-source target-token ban rejected
  // the approved concurrency operand. Semantic events preserve the actual trust
  // boundary and prove an on.pull_request_target mutant still fails.
  assert.doesNotMatch(workflow, /id-token:\s*write|contents:\s*write|secrets\./);
  assertBatchTriggerBoundary(workflow);
  assertTargetTriggerMutantFails(workflow);
  assert.doesNotMatch(workflow, /^\s*paths(?:-ignore)?:/m);
  assert.match(workflow, /fail-fast:\s*false/);
  const baseline = manifest.suites.slice(0, 23);
  const shadow = manifest.suites.filter((suite) => suite.migrationWave === "phase3a-node-wave");
  const waveOriginPaths = [...new Set(shadow.map((item) => item.origin))];
  const presentOriginPaths = waveOriginPaths.filter((originPath) => fs.existsSync(path.join(DEFAULT_ROOT, originPath)));
  assert.equal(waveOriginPaths.length, 31);
  assert.ok(presentOriginPaths.length === 0 || presentOriginPaths.length === waveOriginPaths.length);
  const expectedWaveLifecycle = presentOriginPaths.length === waveOriginPaths.length
    ? "shadow-active"
    : "batched-historical";
  const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const assertionRows = (suites) => suites.map((item) => ({
    id: item.id,
    steps: item.steps.map(({ name, cwd, run, invocation }) => ({ name, cwd, run, invocation })),
  }));
  // [TEST-MOD-APPROVED #2897] The sealed inventory is 84 and STAYS 84 here. What
  // changed is that suites may now be added after the seal, and each one must be
  // declared by name in the validator's SUITES_ADDED_SINCE_SEAL. Reading the
  // total from that set keeps this assertion exact in both directions: an
  // UNDECLARED 85th suite still fails, because it moves the length without
  // moving the declared set. Re-pinning the literal to 85 would have been the
  // weaker fix - it would accept any 85th suite, declared or not.
  assert.equal(manifest.suites.length, 84 + SUITES_ADDED_SINCE_SEAL.length);
  assert.equal(baseline.reduce((sum, item) => sum + item.steps.length, 0), 51);
  assert.equal(shadow.length, 32);
  assert.equal(shadow.reduce((sum, item) => sum + item.steps.length, 0), 107);
  assert.equal(new Set(manifest.suites.map((item) => item.id)).size, 84 + SUITES_ADDED_SINCE_SEAL.length);
  assert.equal(digest(assertionRows(baseline)), "46b4392592c5d6cb56bc600adc98e083b14880b79dad29fe4e1438ac41923764");
  assert.equal(digest(manifest.commandCapabilities.commands.slice(0, 51)), "bb9c0e598a08ab91d8714ec2db80100c8b4d966d980a3cc290c3bcad93990a3f");
  assert.equal(digest(assertionRows(shadow)), "9dea11e17920bd597c737fd1a9afa096ae740aab28eabb82d93029fbb0be7b3e");
  assert.equal(digest(manifest.commandCapabilities.commands.slice(51, 158)), "3cdccc5cb491f7a642ffa2a49f450d6f7ed5b37450d1f18a1fe219d5c629e709");
  for (const item of baseline) {
    assert.equal(item.timeoutSeconds, 480);
    assert.equal(item.isolation, "clean-worktree");
  }
  for (const item of shadow) {
    assert.equal(item.lifecycle, expectedWaveLifecycle);
    assert.equal(item.isolation, "clean-worktree");
  }
});
