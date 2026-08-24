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
import { decodeManifestTextRepresentations } from "./validate-manifest-v2.mjs";
import { validateDecision } from "./select-phase3b-suites.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");
const MANIFEST_PATH = path.join(REPO_ROOT, ".github/ci-batch/MANIFEST.json");
const SUPERVISOR_PATH = path.join(HERE, "process-supervisor.py");
const CHILD_ENV_NAMES = new Set(["CI", "NODE_ENV", "TZ", "LANG", "LC_ALL", "FORCE_COLOR"]);
const PHASE3B_WAVE = "phase3b-postgres-wave";
const PHASE3C_WAVE = "phase3c-deno-wave";
// [#2439 SC-2.3] The waves whose suites execute through the LEAF path. Left
// unextended, a phase3c-deno-wave suite would take the else branch at the bottom
// of the step loop, run each outer as one command, and ignore `children`
// entirely: 46 outers reported executed while all 54 leaves silently never ran.
// That is a green check carrying no information, on seventeen migrations.
const LEAF_EXECUTION_WAVES = new Set([PHASE3B_WAVE, PHASE3C_WAVE]);
export function executesLeaves(suite) { return LEAF_EXECUTION_WAVES.has(suite?.migrationWave); }
// [#2439 SC-5.1] Wave-scoped predicate semantics. Phase 1, Phase 3A and
// phase3b-postgres-wave are UNCHANGED: an absent `file-exists` target there is a
// deliberate conditional proof and stays `skipped-absent`. For
// phase3c-deno-wave the origins assert the opposite - `test -f "$f" || exit 1` -
// so an absent target FAILS the outer and the suite, naming the missing path.
export function absentFileIsFailure(suite) { return suite?.migrationWave === PHASE3C_WAVE; }

export function loadManifest(p = MANIFEST_PATH) {
  return decodeManifestTextRepresentations(JSON.parse(fs.readFileSync(p, "utf8")));
}
export function expectedSuites(manifest, klass) { return manifest.suites.filter((suite) => !klass || suite.class === klass); }
export function expectedPrimarySuites(manifest, klass) {
  return manifest.suites.filter((suite) => (!klass || suite.class === klass) && !LEAF_EXECUTION_WAVES.has(suite.migrationWave));
}

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

export function profileInstalls(profile) {
  if (profile?.install) return [profile.install];
  return Array.isArray(profile?.installs) ? profile.installs : [];
}

function isCanonicalRootInstall(profile, profileName, index) {
  const installs = profileInstalls(profile); const install = installs[index];
  return profileName === "root-node20-yaml-no-save" && index === 0 && installs.length === 1 && install?.cwd === "."
    && install.invocation?.kind === "argv" && install.invocation.command === "npm"
    && JSON.stringify(install.invocation.argv) === JSON.stringify(["install", "--no-save", "yaml"])
    && JSON.stringify(profile.classes) === JSON.stringify(["root-node20-yaml-no-save"]);
}

export function dependencyMaterializations(profile, profileName = null) {
  const seen = new Set(); const result = [];
  for (const [index, { cwd }] of profileInstalls(profile).entries()) {
    if (isCanonicalRootInstall(profile, profileName, index)) {
      if (seen.has("<repo-root>")) throw new Error("duplicate canonical repository-root dependency tree");
      seen.add("<repo-root>"); result.push({ canonicalCwd: "<repo-root>", storedCwd: "." }); continue;
    }
    if (typeof cwd !== "string" || !cwd || cwd.trim() !== cwd || cwd.startsWith("/") || /^[A-Za-z]:/.test(cwd) || cwd.includes("\\") || cwd.includes("\0") || cwd.endsWith("/")
        || cwd === "<repo-root>" || cwd.split("/").some((part) => !part || part === "." || part === "..") || path.posix.normalize(cwd) !== cwd) {
      throw new Error(`install cwd is not canonical repository-relative POSIX: ${JSON.stringify(cwd)}`);
    }
    if (!seen.has(cwd)) { seen.add(cwd); result.push({ canonicalCwd: cwd, storedCwd: cwd }); }
  }
  return result;
}

export function canonicalDependencyCwds(profile, profileName = null) {
  return dependencyMaterializations(profile, profileName).map(({ canonicalCwd }) => canonicalCwd);
}

function exposurePayload(exposure) {
  return { id: exposure.id, providerCwd: exposure.providerCwd, consumerCwd: exposure.consumerCwd,
    packageName: exposure.packageName, executableName: exposure.executableName, version: exposure.version,
    providerPackage: exposure.providerPackage, providerExecutable: exposure.providerExecutable,
    consumerPackageLink: exposure.consumerPackageLink, consumerPackageLinkTarget: exposure.consumerPackageLinkTarget,
    consumerBinLink: exposure.consumerBinLink, consumerBinLinkTarget: exposure.consumerBinLinkTarget,
    authorityLock: exposure.authorityLock, authorityKey: exposure.authorityKey };
}

export function materializeToolExposures(profile, root = REPO_ROOT) {
  const records = [];
  for (const exposure of profile.toolExposures || []) {
    const started = Date.now(); const payload = exposurePayload(exposure);
    for (const cwd of [payload.providerCwd, payload.consumerCwd]) canonicalDependencyCwds({ installs: [{ cwd }] });
    const providerPackage = path.join(root, payload.providerPackage);
    const providerExecutable = path.join(root, payload.providerExecutable);
    const consumerPackageLink = path.join(root, payload.consumerPackageLink);
    const consumerBinLink = path.join(root, payload.consumerBinLink);
    const lock = JSON.parse(fs.readFileSync(path.join(root, payload.authorityLock), "utf8"));
    if (lock.packages?.[payload.authorityKey]?.version !== payload.version) throw new Error(`${payload.id}: lock authority mismatch`);
    const packageJson = JSON.parse(fs.readFileSync(providerPackage, "utf8"));
    const bin = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.[payload.executableName];
    if (packageJson.name !== payload.packageName || packageJson.version !== payload.version || bin?.replace(/^\.\//, "") !== path.posix.relative(path.posix.dirname(payload.providerPackage), payload.providerExecutable)) {
      throw new Error(`${payload.id}: provider package name/version/bin mismatch`);
    }
    const canonicalRoot = fs.realpathSync(root); const canonicalProvider = fs.realpathSync(path.dirname(providerPackage));
    if (!inside(canonicalRoot, canonicalProvider) || !fs.statSync(providerExecutable).isFile()) throw new Error(`${payload.id}: provider escapes repository or executable is missing`);
    if (fs.existsSync(consumerPackageLink) || fs.existsSync(consumerBinLink)) throw new Error(`${payload.id}: consumer tool destination already exists`);
    fs.mkdirSync(path.dirname(consumerPackageLink), { recursive: true }); fs.mkdirSync(path.dirname(consumerBinLink), { recursive: true });
    fs.symlinkSync(payload.consumerPackageLinkTarget, consumerPackageLink); fs.symlinkSync(payload.consumerBinLinkTarget, consumerBinLink);
    if (fs.realpathSync(consumerPackageLink) !== canonicalProvider || fs.realpathSync(consumerBinLink) !== fs.realpathSync(providerExecutable)
        || !inside(canonicalRoot, fs.realpathSync(consumerPackageLink)) || !inside(canonicalRoot, fs.realpathSync(consumerBinLink))) {
      throw new Error(`${payload.id}: consumer tool link containment mismatch`);
    }
    records.push({ ...payload, status: "passed", durationMs: Math.max(0, Date.now() - started) });
  }
  return records;
}

export function validateSetupEvidence(manifest, klass, evidence) {
  const owner = setupProfileForClass(manifest, klass);
  const installs = profileInstalls(owner.profile); const expectedInstalls = installs.length;
  if (!evidence || evidence.class !== klass || evidence.setupProfile !== owner.name || evidence.setupExecutions !== 1 || evidence.installExecutions !== expectedInstalls) {
    throw new Error(`setup evidence mismatch for ${klass}: expected profile=${owner.name}, setup=1, installs=${expectedInstalls}`);
  }
  if (installs.some((install) => install.id)) {
    const expected = installs.map((install) => ({ id: install.id, cwd: install.cwd, command: install.invocation.command, argv: install.invocation.argv }));
    if (JSON.stringify(evidence.orderedInstalls?.map(({ id, cwd, command, argv }) => ({ id, cwd, command, argv }))) !== JSON.stringify(expected)
        || evidence.setupFingerprint !== crypto.createHash("sha256").update(JSON.stringify(expected)).digest("hex")) {
      throw new Error(`setup evidence ordered capability mismatch for ${klass}`);
    }
  }
  const exposures = owner.profile.toolExposures || [];
  if (exposures.length) {
    const expected = exposures.map(exposurePayload);
    if (evidence.toolExposureExecutions !== expected.length
        || JSON.stringify(evidence.orderedToolExposures?.map(exposurePayload)) !== JSON.stringify(expected)
        || evidence.toolExposureFingerprint !== crypto.createHash("sha256").update(JSON.stringify(expected)).digest("hex")) {
      throw new Error(`setup evidence tool exposure mismatch for ${klass}`);
    }
  }
  return owner;
}

export function performSetup(manifest, klass, root = REPO_ROOT, tempRoot = process.env.RUNNER_TEMP || os.tmpdir()) {
  const owner = setupProfileForClass(manifest, klass);
  const installs = profileInstalls(owner.profile);
  const orderedInstalls = [];
  for (const install of installs) {
    const started = Date.now();
    const result = spawnSync(install.invocation.command, install.invocation.argv, {
      cwd: path.join(root, install.cwd),
      env: process.env,
      stdio: "inherit",
    });
    if (result.error || result.status !== 0) {
      throw new Error(`typed setup failed for ${klass} at ${install.cwd}: ${result.error?.message || `exit ${result.status}`}`);
    }
    orderedInstalls.push({ id: install.id, cwd: install.cwd, command: install.invocation.command, argv: install.invocation.argv,
      status: "passed", durationMs: Math.max(0, Date.now() - started) });
  }
  const orderedToolExposures = materializeToolExposures(owner.profile, root);
  return recordSetup(manifest, klass, installs.length, tempRoot, orderedInstalls, orderedToolExposures);
}

export function recordSetup(manifest, klass, installExecutions, tempRoot = process.env.RUNNER_TEMP || os.tmpdir(), orderedInstalls = null, orderedToolExposures = null) {
  const owner = setupProfileForClass(manifest, klass);
  const evidence = { class: klass, setupProfile: owner.name, setupExecutions: 1, installExecutions: Number(installExecutions) };
  if (orderedInstalls) {
    evidence.orderedInstalls = orderedInstalls;
    const payload = orderedInstalls.map(({ id, cwd, command, argv }) => ({ id, cwd, command, argv }));
    evidence.setupFingerprint = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }
  if (orderedToolExposures) {
    evidence.toolExposureExecutions = orderedToolExposures.length;
    evidence.orderedToolExposures = orderedToolExposures;
    evidence.toolExposureFingerprint = crypto.createHash("sha256").update(JSON.stringify(orderedToolExposures.map(exposurePayload))).digest("hex");
  }
  validateSetupEvidence(manifest, klass, evidence);
  const evidencePath = setupEvidencePath(manifest, klass, tempRoot);
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
  return evidencePath;
}

export function commandFingerprint(suite) {
  const rows = executesLeaves(suite)
    ? suite.steps.map((step) => ({ commandId: step.commandId, cwd: step.cwd, invocation: step.invocation, env: step.env || null, children: step.children || null, retry: step.retry || null }))
    : suite.steps.map((step) => ({ commandId: step.commandId, cwd: step.cwd, invocation: step.invocation }));
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

export function capabilityPayloadDigest({ cwd, executable, argv, env, compound }) {
  const payload = env !== undefined || compound !== undefined ? { cwd, executable, argv, env: env || null, compound: Boolean(compound) } : { cwd, executable, argv };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
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

export function resolveLeafCapability(registry, suite, step, stepIndex, child, childIndex) {
  // A typed predicate leaf carries no shell at all; the runner evaluates it.
  // WAVE-SCOPED: Phase 3B's `file-exists` leaves are conditional guards on a
  // real command and keep their invocation. Only Phase 3C introduces predicates
  // that ARE the assertion.
  const typedPredicate = suite?.migrationWave === PHASE3C_WAVE && child.predicate?.kind && child.predicate.kind !== "always";
  if (registry?.schemaVersion !== 1 || registry?.expectedLeaves !== registry?.leaves?.length
      || capabilityRegistryDigest(registry.leaves || []) !== registry.registrySha256) throw new Error("leaf capability registry is missing or corrupt");
  const matches = registry.leaves.filter((entry) => entry.id === child.id);
  if (matches.length !== 1) throw new Error(`${suite.id}: leaf ${child.id} must resolve exactly once`);
  const leaf = matches[0];
  if (leaf.suiteId !== suite.id || leaf.outerCommandId !== step.commandId || leaf.outerIndex !== stepIndex || leaf.leafIndex !== childIndex
      || leaf.cwd !== child.cwd || leaf.executable !== (child.invocation?.command ?? null) || JSON.stringify(leaf.argv) !== JSON.stringify(child.invocation?.argv ?? null)
      || JSON.stringify(leaf.env) !== JSON.stringify(child.env || null) || JSON.stringify(leaf.predicate) !== JSON.stringify(child.predicate)) throw new Error(`${child.id}: leaf ownership drifted`);
  const payload = { cwd: leaf.cwd, executable: leaf.executable, argv: leaf.argv, env: leaf.env, predicate: leaf.predicate };
  if (leaf.payloadSha256 !== crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex")) throw new Error(`${child.id}: leaf payload digest drifted`);
  if (typedPredicate) {
    if (leaf.executable !== null || leaf.argv !== null) throw new Error(`${child.id}: typed predicate leaf must carry no shell invocation`);
    return null;
  }
  return { command: leaf.executable, argv: [...leaf.argv] };
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

export function createIsolatedWorkspace({ root = REPO_ROOT, profile, suite }) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ci-batch-suite-"));
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  execFileSync("git", ["worktree", "add", "--detach", workspaceRoot, "HEAD"], { cwd: root, stdio: "ignore" });
  const materializations = dependencyMaterializations(profile, suite?.setupProfile);
  const dependencyCwds = materializations.map(({ canonicalCwd }) => canonicalCwd);
  for (const { canonicalCwd, storedCwd } of materializations) {
    const installedModules = canonicalCwd === "<repo-root>" ? path.join(root, "node_modules") : path.join(root, storedCwd, "node_modules");
    if (!fs.statSync(installedModules, { throwIfNoEntry: false })?.isDirectory()) {
      removeWorktree(root, temporaryRoot, workspaceRoot);
      throw new Error(`setup output missing: ${canonicalCwd}/node_modules`);
    }
    const isolatedModules = canonicalCwd === "<repo-root>" ? path.join(workspaceRoot, "node_modules") : path.join(workspaceRoot, storedCwd, "node_modules");
    if (fs.existsSync(isolatedModules)) { removeWorktree(root, temporaryRoot, workspaceRoot); throw new Error(`isolated dependency destination already exists: ${canonicalCwd}/node_modules`); }
    fs.mkdirSync(path.dirname(isolatedModules), { recursive: true });
    try { cloneDependencyTree(installedModules, isolatedModules, root, workspaceRoot); }
    catch (error) { removeWorktree(root, temporaryRoot, workspaceRoot); throw error; }
  }
  return { root: workspaceRoot, dependencyCwds, dependencyCloneCount: dependencyCwds.length,
    cleanup: () => removeWorktree(root, temporaryRoot, workspaceRoot) };
}

function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  try { if (process.platform === "win32") child.kill(signal); else process.kill(-child.pid, signal); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
}

const SECRET_NAME = /(?:secret|token|password|passwd|credential|private|api[_-]?key|auth|cookie|webhook)/i;

export function minimalChildEnvironment(requested = {}, home, { allowNodePath = false } = {}) {
  for (const name of Object.keys(requested)) {
    if (!CHILD_ENV_NAMES.has(name) && !(allowNodePath && name === "NODE_PATH" && requested[name] === "./node_modules")) throw new Error(`undeclared child environment capability: ${name}`);
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

export function runInvocation(invocation, { cwd, env = {}, timeoutMs, graceMs = 2_000, spawnImpl = spawn, allowNodePath = false,
  stdout = process.stdout, stderr = process.stderr, home } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let killTimer;
    let deadlineTimer;
    const ownsHome = !home;
    const temporaryHome = home || fs.mkdtempSync(path.join(os.tmpdir(), "ci-batch-home-"));
    let childEnv;
    try { childEnv = minimalChildEnvironment(env, temporaryHome, { allowNodePath }); }
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

/**
 * [#2439 SC-5.1 / SC-5.2] Evaluate a typed leaf predicate.
 *
 * Returns null for `always` (the leaf runs its command), or a verdict for a
 * typed predicate the runner owns. A failing verdict names the exact target, so
 * the reason is attributable rather than "a leaf failed somewhere".
 *
 * @param {object} child        the declared leaf
 * @param {string} workspaceRoot isolated worktree root
 * @param {string} leafCwd      resolved leaf working directory
 * @returns {{ok: boolean, reason: string|null}|null}
 */
export function evaluateTypedPredicate(child, workspaceRoot, leafCwd) {
  const kind = child.predicate?.kind;
  if (!kind || kind === "always") return null;
  if (kind === "file-exists") {
    const targets = child.predicate.paths || (child.predicate.path ? [child.predicate.path] : []);
    if (!targets.length) return { ok: false, reason: `${child.id}: required-file predicate names no target` };
    for (const target of targets) {
      if (!fs.statSync(path.resolve(leafCwd, target), { throwIfNoEntry: false })?.isFile()) {
        return { ok: false, reason: `MISSING: ${target} (required by ${child.id})` };
      }
    }
    return { ok: true, reason: null };
  }
  if (kind === "source-contract") {
    const { path: target, needle, sense } = child.predicate;
    if (!["must-contain", "must-not-contain"].includes(sense)) return { ok: false, reason: `${child.id}: unknown source-contract sense` };
    const absolute = path.resolve(leafCwd, target);
    if (!fs.statSync(absolute, { throwIfNoEntry: false })?.isFile()) return { ok: false, reason: `MISSING: ${target} (source contract ${child.id})` };
    const contains = fs.readFileSync(absolute, "utf8").includes(needle);
    if (sense === "must-contain" && !contains) return { ok: false, reason: `${target} no longer contains ${JSON.stringify(needle)} (${child.id})` };
    if (sense === "must-not-contain" && contains) return { ok: false, reason: `${target} contains forbidden ${JSON.stringify(needle)} (${child.id})` };
    return { ok: true, reason: null };
  }
  return { ok: false, reason: `${child.id}: unsupported leaf predicate ${kind}` };
}

export async function runSuiteV2(suite, { root = REPO_ROOT, profile, workspaceFactory = createIsolatedWorkspace,
  execute = runInvocation, now = Date.now, graceMs = 2_000, commandCapabilities,
  leafCapabilities,
  removeHome = (home) => fs.rmSync(home, { recursive: true, force: true }) } = {}) {
  const started = now();
  let workspace;
  let code = 0;
  let reason = null;
  let status = "passed";
  let executed = 0;
  const leafResults = [];
  let allowedCleanup = [];
  let suiteHome;
  const dependencyRoots = dependencyMaterializations(profile, suite.setupProfile).map(({ canonicalCwd, storedCwd }) =>
    canonicalCwd === "<repo-root>" ? path.join(root, "node_modules") : path.join(root, storedCwd, "node_modules"));
  let immutableSnapshots = [];
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
    immutableSnapshots = dependencyRoots.map((dependencyRoot) => dependencySnapshot(dependencyRoot));
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
      if (executesLeaves(suite)) {
        const children = step.children || [{ id: `leaf:${suite.id}:${String(stepIndex + 1).padStart(2, "0")}:1`, predicate: { kind: "always" }, cwd: step.cwd, invocation: step.invocation, env: step.env || null }];
        let outerFailed = false;
        for (const [childIndex, child] of children.entries()) {
          // Phase 1 / 3A / 3B semantics are untouched: an absent conditional
          // proof is skipped silently, because that is what those origins meant.
          if (child.predicate?.kind === "file-exists" && !absentFileIsFailure(suite)
              && !fs.existsSync(path.join(workspace.root, child.predicate.path))) {
            leafResults.push({ id: child.id, outerCommandId: step.commandId, status: "skipped-absent", executed: false }); continue;
          }
          const leafCwd = path.resolve(workspace.root, child.cwd || ".");
          // [#2439 SC-5.1 / SC-5.2] Typed predicates are evaluated here, by the
          // runner, and they FAIL LOUDLY naming the exact target. The origins say
          // `test -f "$f" || { echo "MISSING: $f"; exit 1; }` and
          // `grep -q <needle> <file>`; representing those as skip-silently leaves
          // would be a fresh instance of the #1584 dark-suite class.
          const verdict = absentFileIsFailure(suite) ? evaluateTypedPredicate(child, workspace.root, leafCwd) : null;
          if (verdict) {
            leafResults.push({ id: child.id, outerCommandId: step.commandId, status: verdict.ok ? "passed" : "failed", executed: true });
            if (!verdict.ok) {
              outerFailed = true; status = "failed"; code = Math.max(code, 2); reason ||= verdict.reason;
            }
            continue;
          }
          const leafInvocation = resolveLeafCapability(leafCapabilities, suite, step, stepIndex, child, childIndex);
          const leafRemaining = suite.timeoutSeconds * 1_000 - (now() - started);
          if (leafRemaining <= 0) { leafResults.push({ id: child.id, outerCommandId: step.commandId, status: "timed-out", executed: true }); status = "timed-out"; code = 124; reason = "suite deadline exceeded"; outerFailed = true; break; }
          const leafResult = await execute(leafInvocation, { cwd: leafCwd, env: child.env || step.env, timeoutMs: leafRemaining, graceMs, home: suiteHome,
            allowNodePath: suite.id === "issue-1902-public-event-lifecycle-tests" && step.commandId.endsWith(":03") });
          leafResults.push({ id: child.id, outerCommandId: step.commandId, status: leafResult.ok ? "passed" : leafResult.timedOut ? "timed-out" : "failed", executed: true });
          if (!leafResult.ok) { outerFailed = true; status = leafResult.timedOut ? "timed-out" : "failed"; code = Math.max(code, leafResult.code || 1); reason ||= leafResult.reason || `leaf failed: ${child.id}`; if (leafResult.timedOut) break; }
        }
        executed += 1;
        if (status === "timed-out") break;
        if (outerFailed) continue;
      } else {
        const result = await execute(invocation, { cwd, env: step.env, timeoutMs: remaining, graceMs, home: suiteHome });
        executed += 1;
        if (!result.ok) { status = result.timedOut ? "timed-out" : "failed"; code = result.code; reason = result.reason || `step failed: ${step.name}`; break; }
      }
    }
    if (dependencyRoots.length) {
      let changed = false;
      try { changed = dependencyRoots.some((dependencyRoot, index) => dependencySnapshot(dependencyRoot) !== immutableSnapshots[index]); }
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
  const expectedLeafRows = executesLeaves(suite)
    ? suite.steps.flatMap((step, stepIndex) => (step.children || [{ id: `leaf:${suite.id}:${String(stepIndex + 1).padStart(2, "0")}:1` }])
      .map((leaf) => ({ id: leaf.id, outerCommandId: step.commandId }))) : [];
  const observedLeaves = new Map(leafResults.map((leaf) => [leaf.id, leaf]));
  const completeLeafResults = expectedLeafRows.map((leaf) => observedLeaves.get(leaf.id) || { ...leaf,
    status: status === "timed-out" ? "not-run-suite-deadline" : "missing", executed: false });
  const outerResults = executesLeaves(suite) ? suite.steps.map((step, index) => {
    const leaves = completeLeafResults.filter((leaf) => leaf.outerCommandId === step.commandId);
    const initiated = index < executed;
    const outerStatus = !initiated ? (status === "timed-out" ? "not-run-suite-deadline" : "missing")
      : leaves.some((leaf) => ["timed-out", "not-run-suite-deadline"].includes(leaf.status)) ? "timed-out"
        : leaves.some((leaf) => leaf.status === "failed") ? "failed"
          : leaves.some((leaf) => leaf.status === "missing") ? "missing" : "passed";
    return { id: step.commandId, status: outerStatus, executed: initiated,
      expectedLeaves: leaves.length, executedLeaves: leaves.filter((leaf) => leaf.executed).length,
      skippedAbsentLeaves: leaves.filter((leaf) => leaf.status === "skipped-absent").length };
  }) : undefined;
  return redactResultText({ id: suite.id, setupProfile: suite.setupProfile, commandFingerprint: commandFingerprint(suite), status,
    ok: status === "passed", code, reason, durationMs, seconds: Math.round(durationMs / 1_000), timeoutSeconds: suite.timeoutSeconds,
    expected: suite.steps.length, executed, outerResults,
    expectedLeaves: completeLeafResults.length || undefined,
    presentLeaves: completeLeafResults.length ? completeLeafResults.filter((leaf) => leaf.status !== "skipped-absent").length : undefined,
    executedLeaves: completeLeafResults.length ? completeLeafResults.filter((leaf) => leaf.executed).length : undefined,
    absentLeaves: completeLeafResults.length ? completeLeafResults.filter((leaf) => leaf.status === "skipped-absent").length : undefined,
    leafResults: completeLeafResults.length ? completeLeafResults : undefined, allowedCleanup,
    dependencyCwds: workspace?.dependencyCwds || canonicalDependencyCwds(profile, suite.setupProfile),
    dependencyCloneCount: workspace?.dependencyCloneCount ?? canonicalDependencyCwds(profile, suite.setupProfile).length });
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
  return { schemaVersion: 2, class: klass, setupClass: setupEvidence?.class || null, setupProfile: setupEvidence?.setupProfile || null,
    setupExecutions: setupEvidence?.setupExecutions || 0, installExecutions: setupEvidence?.installExecutions || 0,
    orderedInstalls: setupEvidence?.orderedInstalls || [], setupFingerprint: setupEvidence?.setupFingerprint || null,
    toolExposureExecutions: setupEvidence?.toolExposureExecutions || 0,
    orderedToolExposures: setupEvidence?.orderedToolExposures || [], toolExposureFingerprint: setupEvidence?.toolExposureFingerprint || null,
    expectedSuiteIds: suites.map((suite) => suite.id), executedSuiteIds: results.map((result) => result.id),
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

function writeReport(manifest, report, root = REPO_ROOT, resultsFile = manifest.runnerContract.resultsFile) {
  fs.writeFileSync(path.join(root, resultsFile), `${JSON.stringify(report, null, 2)}\n`);
  const summary = renderSummary(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  for (const line of renderAnnotations(report)) console.error(line);
}

function selectedPhase3bSuites(manifest, hostClass, documentPath, failSafeClass) {
  const owned = manifest.suites.filter((suite) => suite.migrationWave === "phase3b-postgres-wave" && suite.hostClass === hostClass);
  if (!manifest.classes.includes(hostClass) || !owned.length) throw new Error(`unreviewed Phase 3B host ${hostClass}`);
  try {
    const document = validateDecision(manifest, JSON.parse(fs.readFileSync(documentPath, "utf8")), hostClass);
    return { document, suites: document.selectedSuiteIds.map((id) => owned.find((suite) => suite.id === id)) };
  } catch (error) {
    const executionClasses = [...new Set(owned.map((suite) => suite.executionClass))];
    if (!failSafeClass || executionClasses.length !== 1 || executionClasses[0] !== failSafeClass) throw new Error("Phase 3B selection evidence is missing, corrupt, or cross-host");
    return { document: { digest: "fail-safe-host", mode: "fail-safe-host", deferredError: true, error: error.message }, suites: owned };
  }
}

/**
 * [#2439] Phase 3C host execution. There is no selection protocol here: a
 * Phase 3C host runs every suite the registry assigns to it, so there is no
 * decision document to forge, defer, or fail safe over.
 */
export function phase3cSuitesForHost(manifest, hostClass) {
  const owned = manifest.suites.filter((suite) => suite.migrationWave === PHASE3C_WAVE && suite.hostClass === hostClass);
  if (!manifest.classes.includes(hostClass) || !owned.length) throw new Error(`unreviewed Phase 3C host ${hostClass}`);
  return owned;
}

async function runPhase3cHost(manifest, hostClass) {
  const suites = phase3cSuitesForHost(manifest, hostClass);
  const started = Date.now(); let evidence = null; let results = [];
  try {
    const classes = [...new Set(suites.map((suite) => suite.executionClass))];
    if (classes.length !== 1) throw new Error(`${hostClass}: assigned suites span unreviewed Phase 3C classes`);
    const evidencePath = setupEvidencePath(manifest, classes[0]); evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
    const { profile } = validateSetupEvidence(manifest, classes[0], evidence);
    results = await runSuitesV2(suites, { profile, commandCapabilities: manifest.commandCapabilities,
      leafCapabilities: manifest.phase3cLeafCapabilities, graceMs: manifest.runnerContract.timeoutGraceSeconds * 1_000 });
    fs.rmSync(evidencePath, { force: true });
  } catch (error) {
    results = suites.map((suite) => missingPhase3bResult(suite, error.message));
  }
  const report = buildShardReport(`phase3c:${hostClass}`, suites, results, evidence, Date.now() - started);
  report.expectedOuterIds = suites.flatMap((suite) => suite.steps.map((step) => step.commandId));
  report.executedOuterIds = results.flatMap((result) => {
    const suite = suites.find((candidate) => candidate.id === result.id);
    return suite ? suite.steps.slice(0, result.executed).map((step) => step.commandId) : [];
  });
  report.expectedLeafIds = suites.flatMap((suite) => suite.steps.flatMap((step, stepIndex) =>
    step.children?.map((child) => child.id) || [`leaf:${suite.id}:${String(stepIndex + 1).padStart(2, "0")}:1`]));
  const leafResults = results.flatMap((result) => result.leafResults || []);
  report.observedLeafIds = leafResults.map((leaf) => leaf.id);
  report.executedLeafIds = leafResults.filter((leaf) => leaf.executed).map((leaf) => leaf.id);
  // [#2439 SC-5.1] Phase 3C has no conditional proofs at all: every required
  // file is required. An empty absent set is an assertion, not a description -
  // a non-empty one here means a leaf was skipped where the origin would have
  // failed the job.
  report.absentLeafIds = leafResults.filter((leaf) => leaf.status === "skipped-absent").map((leaf) => leaf.id);
  if (report.absentLeafIds.length) { report.ok = false; report.code = report.code || 1; }
  writeReport(manifest, report, REPO_ROOT, "suite-results-phase3c.json"); process.exitCode = report.code;
}

function missingPhase3bResult(suite, reason) {
  const leafResults = suite.steps.flatMap((step, stepIndex) => (step.children || [{ id: `leaf:${suite.id}:${String(stepIndex + 1).padStart(2, "0")}:1` }])
    .map((leaf) => ({ id: leaf.id, outerCommandId: step.commandId, status: "missing", executed: false })));
  return { id: suite.id, setupProfile: suite.setupProfile, commandFingerprint: commandFingerprint(suite), status: "missing", ok: false,
    code: 2, reason, durationMs: 0, seconds: 0, timeoutSeconds: suite.timeoutSeconds, expected: suite.steps.length, executed: 0,
    outerResults: suite.steps.map((step) => ({ id: step.commandId, status: "missing", executed: false,
      expectedLeaves: leafResults.filter((leaf) => leaf.outerCommandId === step.commandId).length, executedLeaves: 0, skippedAbsentLeaves: 0 })),
    expectedLeaves: leafResults.length, presentLeaves: leafResults.length, executedLeaves: 0, absentLeaves: 0, leafResults, allowedCleanup: [] };
}

async function runPhase3bHost(manifest, hostClass, documentPath, failSafeClass) {
  const { document, suites } = selectedPhase3bSuites(manifest, hostClass, documentPath, failSafeClass); const started = Date.now(); let evidence = null; let results = [];
  try {
    if (suites.length) {
      const classes = [...new Set(suites.map((suite) => suite.executionClass))]; if (classes.length !== 1) throw new Error(`${hostClass}: selected suites span unreviewed secondary classes`);
      const evidencePath = setupEvidencePath(manifest, classes[0]); evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
      const { profile } = validateSetupEvidence(manifest, classes[0], evidence);
      results = await runSuitesV2(suites, { profile, commandCapabilities: manifest.commandCapabilities, leafCapabilities: manifest.phase3bLeafCapabilities,
        graceMs: manifest.runnerContract.timeoutGraceSeconds * 1_000 }); fs.rmSync(evidencePath, { force: true });
    }
  } catch (error) {
    results = suites.map((suite) => missingPhase3bResult(suite, error.message));
  }
  const report = buildShardReport(`phase3b:${hostClass}`, suites, results, evidence, Date.now() - started);
  report.expectedOuterIds = suites.flatMap((suite) => suite.steps.map((step) => step.commandId));
  report.executedOuterIds = results.flatMap((result) => {
    const suite = suites.find((candidate) => candidate.id === result.id);
    return suite ? suite.steps.slice(0, result.executed).map((step) => step.commandId) : [];
  });
  report.expectedLeafIds = suites.flatMap((suite) => suite.steps.flatMap((step, stepIndex) =>
    step.children?.map((child) => child.id) || [`leaf:${suite.id}:${String(stepIndex + 1).padStart(2, "0")}:1`]));
  const leafResults = results.flatMap((result) => result.leafResults || []);
  report.observedLeafIds = leafResults.map((leaf) => leaf.id);
  report.executedLeafIds = leafResults.filter((leaf) => leaf.executed).map((leaf) => leaf.id);
  report.absentLeafIds = leafResults.filter((leaf) => leaf.status === "skipped-absent").map((leaf) => leaf.id);
  report.selectionDigest = document.digest; report.selectionMode = document.mode; report.deferredError = document.deferredError;
  if (document.deferredError) { report.ok = false; report.code = report.code || 1; }
  writeReport(manifest, report, REPO_ROOT, "suite-results-phase3b.json"); process.exitCode = report.code;
}

async function main() {
  const manifest = loadManifest();
  if (process.argv[2] === "--setup") {
    console.log(`executed and recorded one typed setup at ${performSetup(manifest, process.argv[3])}`);
    return;
  }
  if (process.argv[2] === "--record-setup") {
    console.log(`recorded one setup execution at ${recordSetup(manifest, process.argv[3], process.argv[4])}`);
    return;
  }
  if (process.argv[2] === "--run-phase3b-host") {
    const flag = process.argv[5] === "--fail-safe-host" ? process.argv[6] : null;
    return runPhase3bHost(manifest, process.argv[3], process.argv[4], flag);
  }
  if (process.argv[2] === "--run-phase3c-host") {
    return runPhase3cHost(manifest, process.argv[3]);
  }
  const klass = process.argv[2] === "--run" ? process.argv[3] : process.argv[2];
  const suites = expectedPrimarySuites(manifest, klass);
  if (!klass || suites.length === 0) throw new Error(`no suites registered for class "${klass || "<empty>"}"`);
  const started = Date.now();
  let evidence;
  let results;
  try {
    const evidencePath = setupEvidencePath(manifest, klass);
    if (!fs.statSync(evidencePath, { throwIfNoEntry: false })?.isFile()) throw new Error(`setup evidence missing for ${klass}`);
    evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
    const { profile } = validateSetupEvidence(manifest, klass, evidence);
    results = await runSuitesV2(suites, { profile, commandCapabilities: manifest.commandCapabilities, leafCapabilities: manifest.phase3bLeafCapabilities,
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
