#!/usr/bin/env node
// #2148 Phase 2 / #2436. Deterministic isolated executor for CI registry v2.
// Expected suites come only from the manifest. Setup is evidenced once per shard;
// every suite gets a detached worktree and deadline; failures never hide later
// suites; and the result accounts for every expected suite.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");
const MANIFEST_PATH = path.join(REPO_ROOT, ".github/ci-batch/MANIFEST.json");

export function loadManifest(p = MANIFEST_PATH) { return JSON.parse(fs.readFileSync(p, "utf8")); }
export function expectedSuites(manifest, klass) { return manifest.suites.filter((suite) => !klass || suite.class === klass); }

// Compatibility API for the pre-Phase-2 committed regression. Production uses
// runSuiteV2; this preserves the original no-shortfall/no-early-break proof.
export function runStep(step, { cwd = REPO_ROOT, exec = spawnSync } = {}) {
  const dir = path.resolve(cwd, step.cwd || ".");
  if (!fs.existsSync(dir)) return { ok: false, code: 2, reason: `working directory does not exist: ${step.cwd}` };
  const invocation = step.invocation || { command: "bash", argv: ["-c", step.run] };
  if (!invocation.command || !Array.isArray(invocation.argv) || invocation.argv.some((arg) => typeof arg !== "string")) {
    return { ok: false, code: 2, reason: "invalid typed invocation" };
  }
  const result = exec(invocation.command, invocation.argv, { cwd: dir, stdio: "inherit", env: { ...process.env, ...(step.env || {}) } });
  if (result.error) return { ok: false, code: 2, reason: `could not execute: ${result.error.message}` };
  const code = result.status === null ? 2 : result.status;
  return { ok: code === 0, code };
}

export function runSuites(suites, opts = {}) {
  const results = [];
  for (const suite of suites) {
    let code = 0;
    let reason = null;
    const started = Date.now();
    for (const step of suite.steps) {
      const result = runStep(step, opts);
      if (!result.ok) { code = result.code; reason = result.reason || `step failed: ${step.name}`; break; }
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    results.push({ id: suite.id, ok: code === 0, code, reason, seconds });
    console.log(`${code === 0 ? "PASS" : "FAIL"}  ${String(seconds).padStart(4)}s  ${suite.id}${reason ? `  (${reason})` : ""}`);
  }
  return results;
}

export function verdict(expected, results) {
  const executed = results.length;
  const failed = results.filter((result) => !result.ok);
  const shortfall = expected - executed;
  const worstCode = failed.reduce((worst, result) => Math.max(worst, result.code), 0);
  return { executed, expected, shortfall, failed: failed.map((result) => result.id), ok: failed.length === 0 && shortfall === 0,
    code: failed.length ? worstCode || 1 : shortfall === 0 ? 0 : 1 };
}

function safeClass(klass) {
  if (!/^[A-Za-z0-9_-]+$/.test(klass || "")) throw new Error(`invalid class identity: ${klass || "<empty>"}`);
  return klass;
}

export function setupEvidencePath(manifest, klass, tempRoot = process.env.RUNNER_TEMP || os.tmpdir()) {
  return path.join(tempRoot, `${manifest.runnerContract.setupEvidencePrefix}${safeClass(klass)}.json`);
}

export function setupProfileForClass(manifest, klass) {
  const owners = Object.entries(manifest.setupProfiles || {}).filter(([, profile]) => profile.classes?.includes(klass));
  if (owners.length !== 1) throw new Error(`class ${klass} must have exactly one setup profile owner; got ${owners.length}`);
  return { name: owners[0][0], profile: owners[0][1] };
}

export function validateSetupEvidence(manifest, klass, evidence) {
  const owner = setupProfileForClass(manifest, klass);
  const expectedInstalls = owner.profile.install === null ? 0 : 1;
  if (!evidence || evidence.class !== klass || evidence.setupProfile !== owner.name || evidence.setupExecutions !== 1 || evidence.installExecutions !== expectedInstalls) {
    throw new Error(`setup evidence mismatch for ${klass}: expected profile=${owner.name}, setup=1, installs=${expectedInstalls}`);
  }
  return owner;
}

export function recordSetup(manifest, klass, installExecutions, tempRoot = process.env.RUNNER_TEMP || os.tmpdir()) {
  const owner = setupProfileForClass(manifest, klass);
  const evidence = { class: klass, setupProfile: owner.name, setupExecutions: 1, installExecutions: Number(installExecutions) };
  validateSetupEvidence(manifest, klass, evidence);
  const evidencePath = setupEvidencePath(manifest, klass, tempRoot);
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
  return evidencePath;
}

export function commandFingerprint(suite) {
  return crypto.createHash("sha256").update(JSON.stringify(suite.steps.map((step) => ({ cwd: step.cwd, invocation: step.invocation })))).digest("hex");
}

function removeWorktree(root, temporaryRoot, workspaceRoot) {
  try { execFileSync("git", ["worktree", "remove", "--force", workspaceRoot], { cwd: root, stdio: "ignore" }); }
  finally { fs.rmSync(temporaryRoot, { recursive: true, force: true }); }
}

export function createIsolatedWorkspace({ root = REPO_ROOT, profile }) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ci-batch-suite-"));
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  execFileSync("git", ["worktree", "add", "--detach", workspaceRoot, "HEAD"], { cwd: root, stdio: "ignore" });
  if (profile.install) {
    const installedModules = path.join(root, profile.install.cwd, "node_modules");
    if (!fs.statSync(installedModules, { throwIfNoEntry: false })?.isDirectory()) {
      removeWorktree(root, temporaryRoot, workspaceRoot);
      throw new Error(`setup output missing: ${profile.install.cwd}/node_modules`);
    }
    const isolatedModules = path.join(workspaceRoot, profile.install.cwd, "node_modules");
    fs.mkdirSync(path.dirname(isolatedModules), { recursive: true });
    fs.symlinkSync(installedModules, isolatedModules, "dir");
  }
  return { root: workspaceRoot, cleanup: () => removeWorktree(root, temporaryRoot, workspaceRoot) };
}

function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  try { if (process.platform === "win32") child.kill(signal); else process.kill(-child.pid, signal); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
}

export function runInvocation(invocation, { cwd, env = {}, timeoutMs, graceMs = 2_000, spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let killTimer;
    let deadlineTimer;
    const child = spawnImpl(invocation.command, invocation.argv, { cwd, env: { ...process.env, ...env }, stdio: "inherit", detached: process.platform !== "win32" });
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      clearTimeout(killTimer);
      resolve(value);
    };
    child.once("error", (error) => finish({ ok: false, code: 2, timedOut: false, reason: `could not execute: ${error.message}` }));
    child.once("exit", (code, signal) => {
      // A timed-out group is not clean merely because its leader exited on TERM:
      // descendants may ignore TERM and retain the process-group id. Wait through
      // the grace window and send KILL to the group before resolving.
      if (timedOut) return;
      const actualCode = Number.isInteger(code) ? code : 2;
      // A command that exits successfully can still leave a background descendant.
      // No process may escape its suite boundary, so reap any remaining group now.
      signalProcessGroup(child, "SIGKILL");
      finish({ ok: actualCode === 0, code: actualCode, timedOut: false,
        reason: signal ? `process ended by signal ${signal}` : actualCode ? `process exited ${actualCode}` : null });
    });
    deadlineTimer = setTimeout(() => {
      timedOut = true;
      signalProcessGroup(child, "SIGTERM");
      killTimer = setTimeout(() => {
        signalProcessGroup(child, "SIGKILL");
        finish({ ok: false, code: 124, timedOut: true, reason: "suite deadline exceeded" });
      }, graceMs);
    }, Math.max(1, timeoutMs));
  });
}

function repositoryStatus(root) {
  return execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root, encoding: "utf8" })
    .split("\n").filter(Boolean).map((line) => line.slice(3).split(" -> ").pop());
}

function generatedPathAllowed(relative, allowed) {
  const normalized = relative.replaceAll(path.sep, "/");
  return allowed.some((candidate) => { const clean = candidate.replace(/^\.\//, "").replace(/\/$/, ""); return normalized === clean || normalized.startsWith(`${clean}/`); });
}

export async function runSuiteV2(suite, { root = REPO_ROOT, profile, workspaceFactory = createIsolatedWorkspace,
  execute = runInvocation, now = Date.now, graceMs = 2_000 } = {}) {
  const started = now();
  let workspace;
  let code = 0;
  let reason = null;
  let status = "passed";
  let executed = 0;
  let allowedCleanup = [];
  try {
    workspace = workspaceFactory({ root, profile, suite });
    for (const expectedFile of suite.expectedFiles || []) {
      if (!fs.statSync(path.join(workspace.root, expectedFile), { throwIfNoEntry: false })?.isFile()) {
        status = "missing"; code = 2; reason = `expected file missing: ${expectedFile}`; break;
      }
    }
    for (const step of status === "passed" ? suite.steps : []) {
      const cwd = path.resolve(workspace.root, step.cwd || ".");
      const relative = path.relative(workspace.root, cwd);
      if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
        status = "missing"; code = 2; reason = `working directory does not exist: ${step.cwd}`; break;
      }
      const remaining = suite.timeoutSeconds * 1_000 - (now() - started);
      if (remaining <= 0) { status = "timed-out"; code = 124; reason = "suite deadline exceeded"; break; }
      const result = await execute(step.invocation, { cwd, env: step.env, timeoutMs: remaining, graceMs });
      executed += 1;
      if (!result.ok) { status = result.timedOut ? "timed-out" : "failed"; code = result.code; reason = result.reason || `step failed: ${step.name}`; break; }
    }
    if (workspace) {
      const changed = repositoryStatus(workspace.root);
      const unexpected = changed.filter((relative) => !generatedPathAllowed(relative, suite.generatedPaths || []));
      allowedCleanup = changed.filter((relative) => generatedPathAllowed(relative, suite.generatedPaths || []));
      if (unexpected.length) { status = "failed"; code = code || 2; reason = `unexpected workspace mutation: ${unexpected.join(", ")}`; }
    }
  } catch (error) { status = /missing|does not exist/i.test(error.message) ? "missing" : "failed"; code = 2; reason = error.message; }
  finally {
    try { workspace?.cleanup(); }
    catch (error) { status = "failed"; code = code || 2; reason = `workspace cleanup failed: ${error.message}`; }
  }
  const durationMs = Math.max(0, now() - started);
  return { id: suite.id, setupProfile: suite.setupProfile, commandFingerprint: commandFingerprint(suite), status,
    ok: status === "passed", code, reason, durationMs, seconds: Math.round(durationMs / 1_000), timeoutSeconds: suite.timeoutSeconds,
    expected: suite.steps.length, executed, allowedCleanup };
}

export async function runSuitesV2(suites, options = {}) {
  const results = [];
  for (const suite of suites) {
    const result = await runSuiteV2(suite, options);
    results.push(result);
    console.log(`${result.ok ? "PASS" : "FAIL"}  ${String(result.seconds).padStart(4)}s  ${suite.id}${result.reason ? `  (${result.reason})` : ""}`);
  }
  return results;
}

export function buildShardReport(klass, suites, results, setupEvidence, durationMs) {
  const base = verdict(suites.length, results);
  const statuses = Object.fromEntries(["passed", "failed", "timed-out", "missing"].map((status) => [status, results.filter((result) => result.status === status).length]));
  return { schemaVersion: 2, class: klass, setupProfile: setupEvidence?.setupProfile || null,
    setupExecutions: setupEvidence?.setupExecutions || 0, installExecutions: setupEvidence?.installExecutions || 0,
    durationMs, ...base, statuses, results };
}

function annotationEscape(value) { return String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A"); }

export function renderSummary(report) {
  const rows = report.results.map((result) => `| ${result.id} | ${result.status} | ${result.executed}/${result.expected} | ${result.seconds}s | ${result.reason || ""} |`);
  return [`## CI batch: ${report.class}`, "",
    `Setup profile **${report.setupProfile || "missing"}**: ${report.setupExecutions} setup / ${report.installExecutions} install execution(s).`,
    `Executed **${report.executed}/${report.expected}** suites; passed ${report.statuses.passed}, failed ${report.statuses.failed}, timed out ${report.statuses["timed-out"]}, missing ${report.statuses.missing}.`, "",
    "| Suite | Status | Commands | Time | Reason |", "|---|---:|---:|---:|---|", ...rows, ""].join("\n");
}

function writeReport(manifest, report, root = REPO_ROOT) {
  fs.writeFileSync(path.join(root, manifest.runnerContract.resultsFile), `${JSON.stringify(report, null, 2)}\n`);
  const summary = renderSummary(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  for (const result of report.results.filter((item) => !item.ok)) {
    console.error(`::error title=${annotationEscape(`CI suite ${result.id}`)}::${annotationEscape(`${result.status}: ${result.reason || "unknown failure"}`)}`);
  }
  if (report.shortfall) console.error(`::error title=CI suite shortfall::expected ${report.expected}, executed ${report.executed}`);
}

async function main() {
  const manifest = loadManifest();
  if (process.argv[2] === "--record-setup") {
    console.log(`recorded one setup execution at ${recordSetup(manifest, process.argv[3], process.argv[4])}`);
    return;
  }
  const klass = process.argv[2] === "--run" ? process.argv[3] : process.argv[2];
  const suites = expectedSuites(manifest, klass);
  if (!klass || suites.length === 0) throw new Error(`no suites registered for class "${klass || "<empty>"}"`);
  const started = Date.now();
  let evidence;
  let results;
  try {
    const evidencePath = setupEvidencePath(manifest, klass);
    if (!fs.statSync(evidencePath, { throwIfNoEntry: false })?.isFile()) throw new Error(`setup evidence missing for ${klass}`);
    evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
    const { profile } = validateSetupEvidence(manifest, klass, evidence);
    results = await runSuitesV2(suites, { profile, graceMs: manifest.runnerContract.timeoutGraceSeconds * 1_000 });
    fs.rmSync(evidencePath, { force: true });
  } catch (error) {
    results = suites.map((suite) => ({ id: suite.id, setupProfile: suite.setupProfile, commandFingerprint: commandFingerprint(suite),
      status: "missing", ok: false, code: 2, reason: error.message, durationMs: 0, seconds: 0,
      timeoutSeconds: suite.timeoutSeconds, expected: suite.steps.length, executed: 0, allowedCleanup: [] }));
  }
  const report = buildShardReport(klass, suites, results, evidence, Date.now() - started);
  writeReport(manifest, report);
  process.exitCode = report.code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => { console.error(`::error title=CI batch runner::${annotationEscape(error.message)}`); process.exitCode = 2; });
}
