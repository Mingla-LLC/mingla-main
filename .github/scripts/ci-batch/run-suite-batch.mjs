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
const SUPERVISOR_PATH = path.join(HERE, "process-supervisor.py");
const CHILD_ENV_NAMES = new Set(["CI", "NODE_ENV", "TZ", "LANG", "LC_ALL", "FORCE_COLOR"]);

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
  const expectedIds = Array.isArray(expected) ? expected.map((suite) => suite.id) : null;
  const expectedCount = expectedIds ? expectedIds.length : expected;
  const executed = results.length;
  const resultIds = results.map((result) => result.id);
  const duplicateIds = resultIds.filter((id, index) => !id || resultIds.indexOf(id) !== index);
  const identityMismatch = expectedIds ? JSON.stringify(resultIds) !== JSON.stringify(expectedIds) : false;
  const malformed = results.filter((result) => {
    const legacyStatus = result.status === undefined && typeof result.ok === "boolean";
    const typedStatus = ["passed", "failed", "timed-out", "missing"].includes(result.status)
      && result.ok === (result.status === "passed");
    return !legacyStatus && !typedStatus;
  });
  const failed = results.filter((result) => !result.ok);
  const shortfall = expectedCount - executed;
  const worstCode = failed.reduce((worst, result) => Math.max(worst, result.code), 0);
  const reconciliationOk = shortfall === 0 && duplicateIds.length === 0 && !identityMismatch && malformed.length === 0;
  return { executed, expected: expectedCount, shortfall, failed: failed.map((result) => result.id), duplicateIds: [...new Set(duplicateIds)],
    identityMismatch, malformedIds: malformed.map((result) => result.id || "<missing>"), ok: failed.length === 0 && reconciliationOk,
    code: failed.length ? worstCode || 1 : reconciliationOk ? 0 : 1 };
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
  return crypto.createHash("sha256").update(JSON.stringify(suite.steps.map((step) => ({ commandId: step.commandId, cwd: step.cwd, invocation: step.invocation })))).digest("hex");
}

export function capabilityPayloadDigest({ cwd, executable, argv }) {
  return crypto.createHash("sha256").update(JSON.stringify({ cwd, executable, argv })).digest("hex");
}

export function capabilityRegistryDigest(commands) {
  return crypto.createHash("sha256").update(JSON.stringify(commands)).digest("hex");
}

export function resolveCommandCapability(registry, suite, step, stepIndex) {
  if (!registry || registry.schemaVersion !== 1 || registry.expectedCommands !== registry.commands?.length
      || capabilityRegistryDigest(registry.commands || []) !== registry.registrySha256) {
    throw new Error("assertion command capability registry is missing or corrupt");
  }
  const matches = registry.commands.filter((entry) => entry.id === step.commandId);
  if (matches.length !== 1) throw new Error(`${suite.id}: step ${stepIndex} must resolve exactly one command capability`);
  const capability = matches[0];
  if (capability.suiteId !== suite.id || capability.stepIndex !== stepIndex || capability.cwd !== (step.cwd || ".")) {
    throw new Error(`${suite.id}: step ${stepIndex} command capability ownership drifted`);
  }
  if (capability.payloadSha256 !== capabilityPayloadDigest(capability)) {
    throw new Error(`${suite.id}: step ${stepIndex} command capability digest drifted`);
  }
  if (capability.executable !== step.invocation?.command
      || JSON.stringify(capability.argv) !== JSON.stringify(step.invocation?.argv)) {
    throw new Error(`${suite.id}: step ${stepIndex} preserved payload differs from its command capability`);
  }
  return { command: capability.executable, argv: [...capability.argv] };
}

function removeWorktree(root, temporaryRoot, workspaceRoot) {
  try { execFileSync("git", ["worktree", "remove", "--force", workspaceRoot], { cwd: root, stdio: "ignore" }); }
  finally { fs.rmSync(temporaryRoot, { recursive: true, force: true }); }
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function dependencyEntries(root) {
  const entries = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, item.name);
      const relative = path.relative(root, absolute);
      const stat = fs.lstatSync(absolute, { bigint: true });
      entries.push({ absolute, relative, stat });
      if (item.isDirectory() && !item.isSymbolicLink()) pending.push(absolute);
    }
  }
  return entries.sort((left, right) => left.relative.localeCompare(right.relative));
}

export function dependencySnapshot(root) {
  if (!root) return null;
  const rows = dependencyEntries(root).map(({ absolute, relative, stat }) => {
    const target = stat.isSymbolicLink() ? fs.readlinkSync(absolute) : "";
    return [relative, stat.mode, stat.dev, stat.ino, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs, target].join("\0");
  });
  return crypto.createHash("sha256").update(rows.join("\n")).digest("hex");
}

function rejectEscapingLinks(treeRoot, allowedWorkspace) {
  const canonicalWorkspace = fs.realpathSync(allowedWorkspace);
  for (const { absolute, relative, stat } of dependencyEntries(treeRoot)) {
    if (!stat.isSymbolicLink()) continue;
    const resolved = fs.realpathSync(absolute);
    if (!inside(canonicalWorkspace, resolved)) throw new Error(`dependency link escapes isolated workspace: ${relative}`);
  }
}

function verifyNoSharedInodes(source, destination, label) {
  const sourceStat = fs.statSync(source, { bigint: true });
  const destinationStat = fs.statSync(destination, { bigint: true });
  if (sourceStat.dev === destinationStat.dev && sourceStat.ino === destinationStat.ino) {
    throw new Error(`isolated dependency target shares writable inode: ${label}`);
  }
  if (!sourceStat.isDirectory() || !destinationStat.isDirectory()) return;
  const sourceEntries = new Map(dependencyEntries(source).map((entry) => [entry.relative, entry]));
  for (const destinationEntry of dependencyEntries(destination)) {
    const sourceEntry = sourceEntries.get(destinationEntry.relative);
    if (!sourceEntry || !sourceEntry.stat.isFile() || !destinationEntry.stat.isFile()) continue;
    if (destinationEntry.stat.dev === sourceEntry.stat.dev && destinationEntry.stat.ino === sourceEntry.stat.ino) {
      throw new Error(`isolated dependency target shares writable inode: ${label}/${destinationEntry.relative}`);
    }
  }
}

function verifyIndependentTree(source, destination, sourceWorkspace, destinationWorkspace) {
  rejectEscapingLinks(destination, destinationWorkspace);
  const sourceEntries = new Map(dependencyEntries(source).map((entry) => [entry.relative, entry]));
  for (const destinationEntry of dependencyEntries(destination)) {
    const sourceEntry = sourceEntries.get(destinationEntry.relative);
    if (!sourceEntry) throw new Error(`isolated dependency copy invented path: ${destinationEntry.relative}`);
    if (destinationEntry.stat.isFile() && sourceEntry.stat.isFile()
        && destinationEntry.stat.dev === sourceEntry.stat.dev && destinationEntry.stat.ino === sourceEntry.stat.ino) {
      throw new Error(`isolated dependency copy shares writable inode: ${destinationEntry.relative}`);
    }
    if (destinationEntry.stat.isSymbolicLink() && sourceEntry.stat.isSymbolicLink()) {
      const sourceTarget = fs.realpathSync(sourceEntry.absolute);
      const destinationTarget = fs.realpathSync(destinationEntry.absolute);
      const sourceRelative = path.relative(fs.realpathSync(sourceWorkspace), sourceTarget);
      const destinationRelative = path.relative(fs.realpathSync(destinationWorkspace), destinationTarget);
      if (sourceRelative !== destinationRelative) {
        throw new Error(`local dependency link did not rebase into isolated workspace: ${destinationEntry.relative}`);
      }
      verifyNoSharedInodes(sourceTarget, destinationTarget, destinationEntry.relative);
    }
  }
}

function cloneDependencyTree(source, destination, sourceWorkspace, destinationWorkspace) {
  rejectEscapingLinks(source, sourceWorkspace);
  try {
    if (process.platform === "darwin") execFileSync("cp", ["-cR", source, destination], { stdio: "ignore" });
    else execFileSync("cp", ["-a", "--reflink=auto", source, destination], { stdio: "ignore" });
  } catch {
    // Safe fallback for filesystems without copy-on-write clone support. Never
    // hardlink or symlink: either would let a suite mutate the shard installation.
    fs.cpSync(source, destination, { recursive: true, dereference: false, preserveTimestamps: true });
  }
  verifyIndependentTree(source, destination, sourceWorkspace, destinationWorkspace);
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
    try { cloneDependencyTree(installedModules, isolatedModules, root, workspaceRoot); }
    catch (error) { removeWorktree(root, temporaryRoot, workspaceRoot); throw error; }
  }
  return { root: workspaceRoot, cleanup: () => removeWorktree(root, temporaryRoot, workspaceRoot) };
}

function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  try { if (process.platform === "win32") child.kill(signal); else process.kill(-child.pid, signal); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
}

const SECRET_NAME = /(?:secret|token|password|passwd|credential|private|api[_-]?key|auth|cookie|webhook)/i;

export function minimalChildEnvironment(requested = {}, home) {
  for (const name of Object.keys(requested)) {
    if (!CHILD_ENV_NAMES.has(name)) throw new Error(`undeclared child environment capability: ${name}`);
  }
  const temporaryHome = home || fs.mkdtempSync(path.join(os.tmpdir(), "ci-batch-home-"));
  const temporaryDirectory = path.join(temporaryHome, "tmp");
  const cacheDirectory = path.join(temporaryHome, ".npm");
  fs.mkdirSync(temporaryDirectory, { recursive: true });
  fs.mkdirSync(cacheDirectory, { recursive: true });
  return {
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    HOME: temporaryHome,
    TMPDIR: temporaryDirectory,
    XDG_CACHE_HOME: path.join(temporaryHome, ".cache"),
    npm_config_cache: cacheDirectory,
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_offline: "true",
    npm_config_update_notifier: "false",
    CI: "true",
    NODE_ENV: "test",
    TZ: "UTC",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    ...requested,
  };
}

function secretValues(extraEnv = {}) {
  const values = [];
  for (const [name, value] of Object.entries({ ...process.env, ...extraEnv })) {
    if (typeof value !== "string" || value.length < 6) continue;
    // Values excluded from the explicit child environment are sensitive by
    // boundary, regardless of whether their variable name looks secret-like.
    if ((!CHILD_ENV_NAMES.has(name) && name !== "PATH") || SECRET_NAME.test(name)) {
      values.push(value, encodeURIComponent(value), Buffer.from(value).toString("base64"), Buffer.from(value).toString("base64url"));
    }
  }
  return [...new Set(values.filter((value) => value.length >= 6))].sort((a, b) => b.length - a.length);
}

export function redactText(value, extraEnv = {}) {
  let redacted = String(value ?? "");
  for (const secret of secretValues(extraEnv)) redacted = redacted.split(secret).join("[REDACTED]");
  return redacted
    .replace(/\b(?:github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9_]{8,}|AKIA[0-9A-Z]{16})\b/g, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]");
}

function redactValue(value) {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item)]));
  return value;
}

// Suite identity and accounting fields come from the reviewed manifest and
// must remain byte-stable until reconciliation is complete. Redact only the
// free-text fields that can contain child output or environment-derived paths.
function redactResultText(result) {
  return {
    ...result,
    reason: result.reason === null || result.reason === undefined ? result.reason : redactText(result.reason),
    allowedCleanup: Array.isArray(result.allowedCleanup) ? result.allowedCleanup.map((entry) => redactText(entry)) : result.allowedCleanup,
  };
}

function pipeRedacted(stream, destination, env) {
  if (!stream) return;
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      destination.write(`${redactText(buffer.slice(0, newline), env)}\n`);
      buffer = buffer.slice(newline + 1);
    }
  });
  stream.on("end", () => { if (buffer) destination.write(redactText(buffer, env)); });
}

export function runInvocation(invocation, { cwd, env = {}, timeoutMs, graceMs = 2_000, spawnImpl = spawn,
  stdout = process.stdout, stderr = process.stderr, home } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let killTimer;
    let deadlineTimer;
    const ownsHome = !home;
    const temporaryHome = home || fs.mkdtempSync(path.join(os.tmpdir(), "ci-batch-home-"));
    let childEnv;
    try { childEnv = minimalChildEnvironment(env, temporaryHome); }
    catch (error) { if (ownsHome) fs.rmSync(temporaryHome, { recursive: true, force: true }); resolve({ ok: false, code: 2, timedOut: false, reason: redactText(error.message) }); return; }
    const supervised = spawnImpl === spawn;
    const actual = supervised
      ? { command: "/usr/bin/python3", argv: [SUPERVISOR_PATH, "--timeout-ms", String(Math.max(1, timeoutMs)), "--grace-ms", String(Math.max(0, graceMs)), "--", invocation.command, ...invocation.argv] }
      : invocation;
    const child = spawnImpl(actual.command, actual.argv, { cwd, env: childEnv, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    pipeRedacted(child.stdout, stdout, env);
    pipeRedacted(child.stderr, stderr, env);
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      clearTimeout(killTimer);
      if (ownsHome) fs.rmSync(temporaryHome, { recursive: true, force: true });
      resolve(redactValue(value));
    };
    child.once("error", (error) => finish({ ok: false, code: 2, timedOut: false, reason: `could not execute: ${redactText(error.message, env)}` }));
    child.once("exit", (code, signal) => {
      if (timedOut) return;
      const actualCode = Number.isInteger(code) ? code : 2;
      if (!supervised) signalProcessGroup(child, "SIGKILL");
      finish({ ok: actualCode === 0, code: actualCode, timedOut: actualCode === 124,
        reason: signal ? `process ended by signal ${signal}` : actualCode ? `process exited ${actualCode}` : null });
    });
    if (!supervised) {
      deadlineTimer = setTimeout(() => {
        timedOut = true;
        signalProcessGroup(child, "SIGTERM");
        killTimer = setTimeout(() => {
          signalProcessGroup(child, "SIGKILL");
          finish({ ok: false, code: 124, timedOut: true, reason: "suite deadline exceeded" });
        }, graceMs);
      }, Math.max(1, timeoutMs));
    }
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
  execute = runInvocation, now = Date.now, graceMs = 2_000, commandCapabilities,
  removeHome = (home) => fs.rmSync(home, { recursive: true, force: true }) } = {}) {
  const started = now();
  let workspace;
  let code = 0;
  let reason = null;
  let status = "passed";
  let executed = 0;
  let allowedCleanup = [];
  let suiteHome;
  const dependencyRoot = profile?.install ? path.join(root, profile.install.cwd, "node_modules") : null;
  let immutableSnapshot = null;
  try {
    workspace = workspaceFactory({ root, profile, suite });
    suiteHome = fs.mkdtempSync(path.join(os.tmpdir(), "ci-batch-home-"));
    for (const expectedFile of suite.expectedFiles || []) {
      if (!fs.statSync(path.join(workspace.root, expectedFile), { throwIfNoEntry: false })?.isFile()) {
        status = "missing"; code = 2; reason = `expected file missing: ${expectedFile}`; break;
      }
    }
    // Workspace/dependency cloning is trusted preparation and may update source
    // filesystem metadata (APFS clonefile does this for some xattrs). Establish
    // ownership only after preparation, immediately before untrusted suite code.
    immutableSnapshot = dependencyRoot ? dependencySnapshot(dependencyRoot) : null;
    for (const [stepIndex, step] of (status === "passed" ? suite.steps : []).entries()) {
      const cwd = path.resolve(workspace.root, step.cwd || ".");
      const relative = path.relative(workspace.root, cwd);
      if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
        status = "missing"; code = 2; reason = `working directory does not exist: ${step.cwd}`; break;
      }
      const remaining = suite.timeoutSeconds * 1_000 - (now() - started);
      if (remaining <= 0) { status = "timed-out"; code = 124; reason = "suite deadline exceeded"; break; }
      // Committed regressions inject a non-spawning executor to measure deadline
      // propagation. Production always uses runInvocation and therefore has no
      // compatibility path around the reviewed capability registry.
      const invocation = commandCapabilities
        ? resolveCommandCapability(commandCapabilities, suite, step, stepIndex)
        : execute !== runInvocation ? step.invocation
          : (() => { throw new Error(`${suite.id}: production execution requires the assertion command capability registry`); })();
      const result = await execute(invocation, { cwd, env: step.env, timeoutMs: remaining, graceMs, home: suiteHome });
      executed += 1;
      if (!result.ok) { status = result.timedOut ? "timed-out" : "failed"; code = result.code; reason = result.reason || `step failed: ${step.name}`; break; }
    }
    if (dependencyRoot) {
      let changed = false;
      try { changed = dependencySnapshot(dependencyRoot) !== immutableSnapshot; }
      catch { changed = true; }
      if (changed) {
        status = "failed"; code = code || 2; reason = "shard dependency snapshot changed during suite execution";
      }
    }
    if (workspace) {
      const changed = repositoryStatus(workspace.root);
      const unexpected = changed.filter((relative) => !generatedPathAllowed(relative, suite.generatedPaths || []));
      allowedCleanup = changed.filter((relative) => generatedPathAllowed(relative, suite.generatedPaths || []));
      if (unexpected.length && reason !== "shard dependency snapshot changed during suite execution") {
        status = "failed"; code = code || 2; reason = `unexpected workspace mutation: ${unexpected.join(", ")}`;
      }
    }
  } catch (error) { status = /missing|does not exist/i.test(error.message) ? "missing" : "failed"; code = 2; reason = error.message; }
  finally {
    try { if (suiteHome) removeHome(suiteHome); }
    catch (error) { status = "failed"; code = code || 2; reason = `suite HOME cleanup failed: ${error.message}`; }
    try { workspace?.cleanup(); }
    catch (error) { status = "failed"; code = code || 2; reason = `workspace cleanup failed: ${error.message}`; }
  }
  const durationMs = Math.max(0, now() - started);
  return redactResultText({ id: suite.id, setupProfile: suite.setupProfile, commandFingerprint: commandFingerprint(suite), status,
    ok: status === "passed", code, reason, durationMs, seconds: Math.round(durationMs / 1_000), timeoutSeconds: suite.timeoutSeconds,
    expected: suite.steps.length, executed, allowedCleanup });
}

export async function runSuitesV2(suites, options = {}) {
  const results = [];
  for (const suite of suites) {
    const result = await runSuiteV2(suite, options);
    results.push(result);
    console.log(redactText(`${result.ok ? "PASS" : "FAIL"}  ${String(result.seconds).padStart(4)}s  ${suite.id}${result.reason ? `  (${result.reason})` : ""}`));
  }
  return results;
}

export function buildShardReport(klass, suites, results, setupEvidence, durationMs) {
  const base = verdict(suites, results);
  const statuses = Object.fromEntries(["passed", "failed", "timed-out", "missing"].map((status) => [status, results.filter((result) => result.status === status).length]));
  return { schemaVersion: 2, class: klass, setupProfile: setupEvidence?.setupProfile || null,
    setupExecutions: setupEvidence?.setupExecutions || 0, installExecutions: setupEvidence?.installExecutions || 0,
    durationMs, ...base, statuses, results: results.map(redactResultText) };
}

function annotationEscape(value) { return String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A"); }

export function renderSummary(report) {
  const safeReport = { ...report, results: report.results.map(redactResultText) };
  const cell = (value) => redactText(value).replaceAll("|", "\\|").replaceAll("\n", " ");
  const rows = safeReport.results.map((result) => `| ${cell(result.id)} | ${cell(result.status)} | ${result.executed}/${result.expected} | ${result.seconds}s | ${cell(result.reason || "")} |`);
  return [`## CI batch: ${cell(safeReport.class)}`, "",
    `Setup profile **${cell(safeReport.setupProfile || "missing")}**: ${safeReport.setupExecutions} setup / ${safeReport.installExecutions} install execution(s).`,
    `Executed **${safeReport.executed}/${safeReport.expected}** suites; passed ${safeReport.statuses.passed}, failed ${safeReport.statuses.failed}, timed out ${safeReport.statuses["timed-out"]}, missing ${safeReport.statuses.missing}.`, "",
    "| Suite | Status | Commands | Time | Reason |", "|---|---:|---:|---:|---|", ...rows, ""].join("\n");
}

export function renderAnnotations(report) {
  const annotation = (title, message) => `::error title=${annotationEscape(redactText(title))}::${annotationEscape(redactText(message))}`;
  const lines = report.results.filter((item) => !item.ok).map((result) =>
    annotation(`CI suite ${result.id}`, `${result.status}: ${result.reason || "unknown failure"}`));
  if (report.shortfall) lines.push(annotation("CI suite shortfall", `expected ${report.expected}, executed ${report.executed}`));
  if (report.identityMismatch) lines.push(annotation("CI suite identity mismatch", "executed suite identities or order differ from the manifest"));
  if (report.duplicateIds.length) lines.push(annotation("CI suite duplicate identities", report.duplicateIds.join(", ")));
  if (report.malformedIds.length) lines.push(annotation("CI suite malformed results", report.malformedIds.join(", ")));
  return lines;
}

function writeReport(manifest, report, root = REPO_ROOT) {
  fs.writeFileSync(path.join(root, manifest.runnerContract.resultsFile), `${JSON.stringify(report, null, 2)}\n`);
  const summary = renderSummary(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  for (const line of renderAnnotations(report)) console.error(line);
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
    results = await runSuitesV2(suites, { profile, commandCapabilities: manifest.commandCapabilities,
      graceMs: manifest.runnerContract.timeoutGraceSeconds * 1_000 });
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
  main().catch((error) => { console.error(`::error title=CI batch runner::${annotationEscape(redactText(error.message))}`); process.exitCode = 2; });
}
