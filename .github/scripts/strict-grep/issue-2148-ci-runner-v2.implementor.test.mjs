// #2436 happy-path and adversarial runtime proof. Distinct from the governance gate.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildShardReport, loadManifest, recordSetup, renderSummary, runInvocation,
  runSuiteV2, runSuitesV2, setupEvidencePath, validateSetupEvidence,
} from "../ci-batch/run-suite-batch.mjs";

function temporaryDirectory(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function gitFixture() {
  const root = temporaryDirectory("runner-v2-fixture-");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "runner@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Runner Proof"], { cwd: root });
  fs.writeFileSync(path.join(root, "proof.test.mjs"), "// proof\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  return root;
}
function suite(id, command, timeoutSeconds = 5) {
  return { id, class: "node20-noinstall", setupProfile: "node20-noinstall", timeoutSeconds,
    expectedFiles: ["proof.test.mjs"], generatedPaths: [], steps: [{ name: id, cwd: ".", run: command,
      invocation: { kind: "raw-shell", command: "bash", argv: ["-c", command] } }] };
}
function fixtureWorkspace(root) { return { root, cleanup() {} }; }

test("setup is exactly once and missing, mismatch, or duplicate evidence is red", () => {
  const manifest = loadManifest();
  const temp = temporaryDirectory("runner-v2-evidence-");
  assert.throws(() => fs.readFileSync(setupEvidencePath(manifest, "node20-noinstall", temp)), /ENOENT/);
  assert.throws(() => validateSetupEvidence(manifest, "node20-noinstall", { class: "node20-noinstall", setupProfile: "node20-noinstall", setupExecutions: 2, installExecutions: 0 }), /mismatch/);
  const evidencePath = recordSetup(manifest, "node20-noinstall", 0, temp);
  const evidence = JSON.parse(fs.readFileSync(evidencePath));
  assert.equal(validateSetupEvidence(manifest, "node20-noinstall", evidence).name, "node20-noinstall");
  assert.throws(() => recordSetup(manifest, "node20-noinstall", 0, temp), /EEXIST/);
  assert.throws(() => recordSetup(manifest, "business-node20-1", 0, temp), /mismatch/);
  fs.rmSync(temp, { recursive: true, force: true });
});

test("a failed suite does not hide a later passing suite", async () => {
  const root = gitFixture();
  const results = await runSuitesV2([suite("first", "exit 7"), suite("second", "true")], {
    root, profile: { install: null }, workspaceFactory: () => fixtureWorkspace(root),
  });
  assert.deepEqual(results.map(({ id, status, code }) => ({ id, status, code })), [
    { id: "first", status: "failed", code: 7 }, { id: "second", status: "passed", code: 0 },
  ]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a missing expected file and unexpected workspace mutation are red", async () => {
  const root = gitFixture();
  const missing = suite("missing", "true");
  missing.expectedFiles = ["vanished.test.mjs"];
  assert.equal((await runSuiteV2(missing, { root, profile: { install: null }, workspaceFactory: () => fixtureWorkspace(root) })).status, "missing");
  const mutated = await runSuiteV2(suite("mutated", "printf bad > product.txt"), { root, profile: { install: null }, workspaceFactory: () => fixtureWorkspace(root) });
  assert.equal(mutated.status, "failed");
  assert.match(mutated.reason, /unexpected workspace mutation/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("declared generated output is reported and cleaned with an isolated workspace", async () => {
  const root = gitFixture();
  const isolated = temporaryDirectory("runner-v2-isolated-");
  execFileSync("git", ["clone", "-q", root, isolated]);
  const generated = suite("generated", "mkdir -p reports && printf ok > reports/result.json");
  generated.generatedPaths = ["reports"];
  let cleaned = false;
  const result = await runSuiteV2(generated, { root, profile: { install: null }, workspaceFactory: () => ({ root: isolated,
    cleanup() { cleaned = true; fs.rmSync(isolated, { recursive: true, force: true }); } }) });
  assert.equal(result.status, "passed");
  assert.deepEqual(result.allowedCleanup, ["reports/result.json"]);
  assert.equal(cleaned, true);
  assert.equal(fs.existsSync(path.join(root, "reports/result.json")), false, "base checkout must remain untouched");
  fs.rmSync(root, { recursive: true, force: true });
});

test("timeout kills the whole process group, including descendants", async () => {
  const root = temporaryDirectory("runner-v2-timeout-");
  const marker = path.join(root, "descendant-survived");
  const child = `process.on('SIGTERM',()=>{});setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'bad'),600)`;
  const parent = `const{spawn}=require('child_process');spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'ignore'});setInterval(()=>{},1000)`;
  const result = await runInvocation({ command: process.execPath, argv: ["-e", parent] }, { cwd: root, timeoutMs: 100, graceMs: 50 });
  assert.equal(result.timedOut, true);
  assert.equal(result.code, 124);
  await new Promise((resolve) => setTimeout(resolve, 750));
  assert.equal(fs.existsSync(marker), false, "descendant escaped the process-group kill");
  fs.rmSync(root, { recursive: true, force: true });
});

test("a successful command cannot leak a background descendant past its suite", async () => {
  const root = temporaryDirectory("runner-v2-background-");
  const marker = path.join(root, "background-survived");
  const descendant = `process.on('SIGTERM',()=>{});setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'bad'),500)`;
  const parent = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'}).unref();`;
  const result = await runInvocation({ command: process.execPath, argv: ["-e", parent] }, { cwd: root, timeoutMs: 1_000, graceMs: 50 });
  assert.equal(result.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 650));
  assert.equal(fs.existsSync(marker), false, "background descendant escaped the completed suite command");
  fs.rmSync(root, { recursive: true, force: true });
});

test("JSON and GitHub summary counts stay honest", () => {
  const suites = [suite("pass", "true"), suite("timeout", "true")];
  const results = [
    { id: "pass", ok: true, code: 0, status: "passed", executed: 1, expected: 1, seconds: 1 },
    { id: "timeout", ok: false, code: 124, status: "timed-out", executed: 1, expected: 1, seconds: 5, reason: "deadline" },
  ];
  const report = buildShardReport("node20-noinstall", suites, results, { setupProfile: "node20-noinstall", setupExecutions: 1, installExecutions: 0 }, 6000);
  assert.equal(report.expected, 2);
  assert.equal(report.executed, 2);
  assert.equal(report.statuses.passed, 1);
  assert.equal(report.statuses["timed-out"], 1);
  assert.equal(report.ok, false);
  assert.match(renderSummary(report), /Executed \*\*2\/2\*\*/);
});
