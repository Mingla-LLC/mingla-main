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
import { decodeManifestTextRepresentations, isMigratedSuite, isPrimarySuite, suiteCommandFingerprint, suiteOriginPatterns } from "./validate-manifest-v2.mjs";
import { changedPathDigest, deriveChangedPaths, pathMatches, validateDecision } from "./select-phase3b-suites.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");
const MANIFEST_PATH = path.join(REPO_ROOT, ".github/ci-batch/MANIFEST.json");
const SUPERVISOR_PATH = path.join(HERE, "process-supervisor.py");
const CHILD_ENV_NAMES = new Set(["CI", "NODE_ENV", "TZ", "LANG", "LC_ALL", "FORCE_COLOR"]);
// [#2439 SC-6.1 / PR #2546] The four authorised inert literals #1326 carries.
// They were registered in the manifest and pinned by the validator but the
// RUNNER still rejected them, so every attempt of the money-critical NG Paystack
// suite died on `undeclared child environment capability: SUPABASE_URL` — an
// environment represented but not executable, exactly like the retry that was
// carried in the schema and never honoured. Values are re-checked against the
// reviewed literals at spawn time; the registry is the gate, this is the lock.
const PHASE3C_AUTHORISED_ENV_NAMES = new Set([
  "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "PAYSTACK_MODE", "PAYSTACK_SECRET_KEY_TEST",
]);
const PHASE3B_WAVE = "phase3b-postgres-wave";
const PHASE3C_WAVE = "phase3c-deno-wave";

// [#2439] Lane routing is DERIVED from the registry, never from a wave name.
// A migrated suite is one the registry gives its own executionClass; it runs in
// its host's own lane, which is the lane that reports leaves. Phase 1 and Phase
// 3A suites carry no executionClass and take the single-command branch. This is
// byte-identical to the previous two-name set on today's tree (29 migrated
// suites either way) and it is the reason Phase 3D cannot repeat the failure
// that took six batch hosts red on PR #2546.
export function executesLeaves(suite) { return isMigratedSuite(suite); }

/**
 * [#2439 SC-5.1] Whether an absent `file-exists` target FAILS, derived per
 * TARGET rather than per wave.
 *
 * The real distinction was never the wave: it is whether the registry declares
 * this exact target as a CONDITIONAL proof. Phase 3B's #1902 registers its three
 * absent targets in `conditionalExpectedFiles` and means "run when present";
 * Phase 3C registers none and means `test -f "$f" || exit 1`. Deriving from the
 * registration makes both behaviours fall out of the data, and the validator
 * already enforces that every phase3b file-exists target is registered there.
 */
export function absentFileIsFailure(suite, target) {
  if (!isMigratedSuite(suite)) return false;
  return !(suite.conditionalExpectedFiles || []).includes(target);
}
// The runner honours whatever bounded retry the REVIEWED registry declares; it
// is the schema, not the runner, that decides which steps may declare one (the
// validator pins it to exactly #1326's two steps at 3 attempts / 10s).
export function retryIsHonoured(suite) { return isMigratedSuite(suite); }
/**
 * [PR #2546] Bounded backoff between retry attempts.
 *
 * This MUST hold the event loop open. It previously called `timer.unref()`,
 * which tells Node the timer may not keep the process alive — and during a
 * backoff the timer is the ONLY pending work, so Node drained the loop and
 * EXITED mid-wait. Attempt 1 failed, "waiting 10s" printed, and the process
 * ended: no attempt 2, no verdict, no results artifact. A bounded retry whose
 * own wait terminates the run is a retry in name only, and #1326 is a
 * money-critical Nigerian Paystack path whose three attempts are the reason the
 * origin's `for attempt in 1 2 3` / `sleep 10` exists.
 *
 * Reproduced deterministically: an unref'd timer prints the wait line and exits
 * 0 without running the next attempt; a ref'd timer runs all three.
 */
export const sleepBounded = (ms) => new Promise((resolve) => { setTimeout(resolve, Math.max(0, ms)); });

export function loadManifest(p = MANIFEST_PATH) {
  return decodeManifestTextRepresentations(JSON.parse(fs.readFileSync(p, "utf8")));
}
export function expectedSuites(manifest, klass) { return manifest.suites.filter((suite) => !klass || suite.class === klass); }
export function expectedPrimarySuites(manifest, klass) {
  return manifest.suites.filter((suite) => (!klass || suite.class === klass) && isPrimarySuite(suite));
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

// ---------------------------------------------------------------------------
// [#2882] Pull-request suite routing.
//
// ci-batch runs all 85 registered suites on every pull request and is 53% of the
// CI bill. `originPaths` already records, per suite, which source changes
// invalidate it. On a pull request the runner now executes the suites the diff
// invalidates; on `push: main`, `schedule` and `workflow_dispatch` selection is
// the identity function and all 85 still run. Nothing is deleted or weakened —
// only WHEN a suite runs changes, never WHETHER it exists.
//
// Every count printed below is DERIVED from the registry, never typed.
// `validate-manifest-v2.mjs:51-62` records why: two literals that must agree is
// how a number lands where two sides had said different things and merged clean.
// ---------------------------------------------------------------------------
export const ROUTED_EVENTS = new Set(["pull_request", "pull_request_target"]);

/**
 * [#2882 F3/F4] The changed-path list, or a refusal.
 *
 * The two failures here are the load-bearing ones. This repository's recorded
 * failure mode is absence of signal reading as confirmation, and a router is the
 * purest form of that bug: if it cannot see the diff it selects nothing, every
 * suite skips, and the run reports green having tested nothing.
 *
 * So: a derivation that fails is a FAILURE (F3), and an empty diff on a
 * pull request is "could not observe" (F4), never "observed zero". Neither is
 * ever read as "no files changed".
 */
export function routingContext({ env = process.env, root = REPO_ROOT, readFile = fs.readFileSync } = {}) {
  const eventName = env.GITHUB_EVENT_NAME || "";
  if (!ROUTED_EVENTS.has(eventName)) return { eventName: eventName || "local", mode: "full" };
  let source;
  try {
    if (!env.GITHUB_EVENT_PATH) throw new Error("GITHUB_EVENT_PATH is not set");
    source = deriveChangedPaths({ root, eventName: "pull_request", event: JSON.parse(readFile(env.GITHUB_EVENT_PATH, "utf8")) });
  } catch (error) {
    throw new Error(`changed-path derivation failed: ${error.message}`);
  }
  if (!source.changedPaths.length) {
    // Deliberately does NOT interpolate the event name. `GITHUB_EVENT_NAME` is
    // outside the child environment allowlist, so `redactText` treats its value
    // as sensitive by boundary and would replace it with [REDACTED] in the
    // GitHub annotation — turning the one line an operator sees into a sentence
    // missing its subject.
    throw new Error("routed event produced no changed paths: could not observe, not observed zero");
  }
  return { eventName, mode: "routed", changedPaths: source.changedPaths, baseSha: source.baseSha, headSha: source.headSha };
}

/**
 * [#2882] The selection itself.
 *
 * F1 and F2 are asserted across EVERY registered suite on every run — including
 * `full` mode and including classes this job will not execute — so a registry
 * entry that routes to nothing cannot hide in a class nobody ran today.
 * F5 rides along: `pathMatches` parses under the ONE reviewed grammar and an
 * unsupported pattern throws rather than being caught and skipped.
 */
export function selectSuites(manifest, candidates, context) {
  const patterns = new Map(manifest.suites.map((suite) => [suite.id, suiteOriginPatterns(suite)]));
  const registry = manifest.suites.length;
  if (context.mode !== "routed") {
    return { mode: "full", registry, candidates: candidates.length, selectedSuiteIds: manifest.suites.map((suite) => suite.id), suites: candidates, reasons: new Map() };
  }
  const reasons = new Map();
  const invalidated = (suite) => {
    for (const pattern of patterns.get(suite.id)) {
      const hit = context.changedPaths.find((file) => pathMatches(pattern, file));
      if (hit) { reasons.set(suite.id, pattern); return true; }
    }
    return false;
  };
  const selectedSuiteIds = manifest.suites.filter(invalidated).map((suite) => suite.id);
  return { mode: "routed", registry, candidates: candidates.length, selectedSuiteIds, suites: candidates.filter((suite) => reasons.has(suite.id)), reasons };
}

export function routingReport(context, selection) {
  return {
    mode: selection.mode,
    eventName: context.eventName,
    registry: selection.registry,
    changedPathCount: selection.mode === "routed" ? context.changedPaths.length : null,
    changedPaths: selection.mode === "routed" ? context.changedPaths : null,
    changedPathSha256: selection.mode === "routed" ? changedPathDigest(context.changedPaths) : null,
    selectedSuiteIds: selection.selectedSuiteIds,
    classSelectedSuiteIds: selection.suites.map((suite) => suite.id),
  };
}

/**
 * [#2882 §8] The selection, always printed beside its denominator.
 *
 * Four of sixteen sampled commits on `main` select ZERO suites. That is a
 * legitimate outcome — and it is indistinguishable, in a log, from a router that
 * silently did nothing. So a zero is printed as an event with its denominator
 * and an explicit sentence, never as a silence. Shape follows
 * `scripts/secrets/postdeploy-governed-fallback-watch.mjs`.
 */
export function renderRoutingLine(klass, context, selection) {
  const changed = selection.mode === "routed" ? String(context.changedPaths.length) : "n/a";
  const lines = [`PASS ci-batch-route class=${klass} event=${context.eventName} mode=${selection.mode} `
    + `changed=${changed} registry=${selection.registry} selected=${selection.selectedSuiteIds.length} of ${selection.registry} `
    + `class_selected=${selection.suites.length} of ${selection.candidates}`];
  for (const suite of selection.suites) {
    const reason = selection.reasons.get(suite.id);
    lines.push(`  + ${suite.id}${reason ? `          (${reason})` : ""}`);
  }
  if (!selection.suites.length) {
    lines.push(selection.selectedSuiteIds.length
      ? "  (no suite in this class is invalidated by this diff; other classes have work)"
      : "  (no registered suite is invalidated by this diff)");
  }
  return lines.join("\n");
}

export function renderRoutingFailure(reason, detail) {
  return `FAIL ci-batch-route ${reason}\n- ${detail}`;
}

/**
 * [#2882 §12 layer 2] The tier-2 escape detector.
 *
 * Routing's real risk is not a wrong match, it is a MISSING pattern: a suite
 * quietly stops running for the changes it exists to catch, and nothing says so.
 *
 * On `push: main` every suite runs. In that same run, recompute what a pull
 * request would have selected for this merge's diff and cross-reference it
 * against which suites actually FAILED. A suite that failed here but would not
 * have been selected at PR time is an `originPaths` blind spot, and the run
 * names it together with the files that escaped — an operator gets the repair,
 * not just an alarm. It cannot produce a false positive: it only speaks when a
 * suite has genuinely failed.
 *
 * Its limit, stated rather than papered over: this detects only HARMFUL
 * incompleteness. A suite whose `originPaths` is incomplete but which still
 * passes on main surfaces nowhere. Nothing in this design proves `originPaths`
 * complete and nothing here claims to.
 */
export function detectTier2Escapes(manifest, results, { env = process.env, root = REPO_ROOT, readFile = fs.readFileSync } = {}) {
  if ((env.GITHUB_EVENT_NAME || "") !== "push") return null;
  const failedIds = results.filter((result) => !result.ok).map((result) => result.id);
  if (!failedIds.length) return { checked: 0, blindSpots: [] };
  let changedPaths;
  try {
    if (!env.GITHUB_EVENT_PATH) throw new Error("GITHUB_EVENT_PATH is not set");
    ({ changedPaths } = deriveChangedPaths({ root, eventName: "push", event: JSON.parse(readFile(env.GITHUB_EVENT_PATH, "utf8")) }));
  } catch (error) {
    // The detector going blind must NEVER weaken tier 2 — every suite already
    // ran. Say that it could not look; do not let the silence read as "clean".
    return { checked: failedIds.length, blindSpots: [], unavailable: error.message };
  }
  const blindSpots = [];
  for (const id of failedIds) {
    const suite = manifest.suites.find((candidate) => candidate.id === id);
    if (!suite) continue;
    const patterns = suiteOriginPatterns(suite);
    if (patterns.some((pattern) => changedPaths.some((file) => pathMatches(pattern, file)))) continue;
    // [#2882 P3] §12 promised the FILE, not the diff. When a changed file is one
    // this suite actually executes, that file IS the escapee and can be named
    // outright — the operator gets the exact originPaths entry to add. When no
    // changed file is executed by the suite, the escapee is some dependency it
    // reads rather than runs and causality is genuinely unknown, so the diff is
    // offered as candidates and LABELLED as candidates. Naming a guess as a
    // finding would be the same dishonesty this whole change exists to remove.
    const executed = new Set([...(suite.expectedFiles || []), ...(suite.conditionalExpectedFiles || [])]);
    const escaped = changedPaths.filter((file) => executed.has(file));
    blindSpots.push({ id, escapedPaths: escaped.length ? escaped : changedPaths, certain: escaped.length > 0 });
  }
  return { checked: failedIds.length, blindSpots };
}

export function renderTier2EscapeAnnotations(escapes) {
  if (!escapes) return [];
  const lines = [];
  if (escapes.unavailable) {
    lines.push("::warning title=originPaths blind-spot detector unavailable::"
      + `could not derive this push's diff (${escapes.unavailable}); ${escapes.checked} failing suite(s) went unchecked`);
  }
  for (const spot of escapes.blindSpots) {
    const shown = spot.escapedPaths.slice(0, 5).join(", ");
    const more = spot.escapedPaths.length > 5 ? ` (+${spot.escapedPaths.length - 5} more)` : "";
    lines.push(spot.certain
      ? `::error title=originPaths blind spot::${spot.id} failed on main but this diff would not have `
        + `selected it at PR time; it EXECUTES ${shown}${more}, which its originPaths does not cover — add that path`
      : `::error title=originPaths blind spot::${spot.id} failed on main but this diff would not have `
        + `selected it at PR time; its originPaths covers none of the ${spot.escapedPaths.length} changed `
        + `file(s), and it executes none of them either, so the escaping dependency is one of: ${shown}${more}`);
  }
  return lines;
}

export function routeOrFail(manifest, klass, candidates, options = {}) {
  let context;
  try {
    context = routingContext(options);
  } catch (error) {
    console.error(renderRoutingFailure("changed_paths_underivable", error.message));
    throw error;
  }
  const selection = selectSuites(manifest, candidates, context);
  console.log(renderRoutingLine(klass, context, selection));
  return { context, selection };
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

// Re-exported from the single canonical definition so the runner that WRITES a
// fingerprint and the reconciler that CHECKS it cannot drift apart.
export const commandFingerprint = suiteCommandFingerprint;

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
  // Derived from the sealed capability, not the wave: a typed predicate leaf is
  // one the registry declares with no executable and no argv at all.
  const registered = (registry?.leaves || []).find((entry) => entry.id === child.id);
  const typedPredicate = registered ? registered.executable === null && registered.argv === null : false;
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

export function minimalChildEnvironment(requested = {}, home, { allowNodePath = false, allowReviewedEnv = false } = {}) {
  for (const name of Object.keys(requested)) {
    const reviewedEnv = allowReviewedEnv && PHASE3C_AUTHORISED_ENV_NAMES.has(name) && typeof requested[name] === "string"
      && !/\$\{\{|\$\(|`|secrets\./.test(requested[name]);
    if (!CHILD_ENV_NAMES.has(name) && !reviewedEnv
      && !(allowNodePath && name === "NODE_PATH" && requested[name] === "./node_modules")) throw new Error(`undeclared child environment capability: ${name}`);
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
    if ((!CHILD_ENV_NAMES.has(name) && name !== "PATH" && !PHASE3C_AUTHORISED_ENV_NAMES.has(name)) || (SECRET_NAME.test(name) && !PHASE3C_AUTHORISED_ENV_NAMES.has(name))) {
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

export function runInvocation(invocation, { cwd, env = {}, timeoutMs, graceMs = 2_000, spawnImpl = spawn, allowNodePath = false, allowReviewedEnv = false,
  stdout = process.stdout, stderr = process.stderr, home } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let killTimer;
    let deadlineTimer;
    const ownsHome = !home;
    const temporaryHome = home || fs.mkdtempSync(path.join(os.tmpdir(), "ci-batch-home-"));
    let childEnv;
    try { childEnv = minimalChildEnvironment(env, temporaryHome, { allowNodePath, allowReviewedEnv }); }
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
          if (child.predicate?.kind === "file-exists" && child.predicate.path
              && !absentFileIsFailure(suite, child.predicate.path)
              && !fs.existsSync(path.join(workspace.root, child.predicate.path))) {
            leafResults.push({ id: child.id, outerCommandId: step.commandId, status: "skipped-absent", executed: false }); continue;
          }
          const leafCwd = path.resolve(workspace.root, child.cwd || ".");
          // Resolve the sealed capability FIRST, for every leaf including typed
          // predicates. It proves ownership and the payload digest, and it
          // returns null for a leaf that carries no shell. Evaluating the
          // predicate before this ran would let a tampered `predicate` in the
          // suite execute without ever meeting its own sealed registry entry.
          const leafInvocation = resolveLeafCapability(leafCapabilities, suite, step, stepIndex, child, childIndex);
          // [#2439 SC-5.1 / SC-5.2] Typed predicates are evaluated here, by the
          // runner, and they FAIL LOUDLY naming the exact target. The origins say
          // `test -f "$f" || { echo "MISSING: $f"; exit 1; }` and
          // `grep -q <needle> <file>`; representing those as skip-silently leaves
          // would be a fresh instance of the #1584 dark-suite class.
          if (leafInvocation === null) {
            const verdict = evaluateTypedPredicate(child, workspace.root, leafCwd);
            leafResults.push({ id: child.id, outerCommandId: step.commandId, status: verdict.ok ? "passed" : "failed", executed: true });
            if (!verdict.ok) {
              outerFailed = true; status = "failed"; code = Math.max(code, 2); reason ||= verdict.reason;
            }
            continue;
          }
          // [#2439 SC-4.1 / SC-4.2] The bounded retry is a typed field the runner
          // HONOURS. #1326's origin wrapped this exact invocation in a
          // three-attempt loop with a 10s back-off; that loop is deliberately
          // absent from the command string, so without this the retry would be
          // silently DROPPED — a weakening SC-4.3 forbids outright. Attempts are
          // bounded by the schema and every wait is bounded by the suite deadline.
          const retry = step.retry && retryIsHonoured(suite) ? step.retry : null;
          const maxAttempts = retry ? retry.attempts : 1;
          let leafResult = null;
          let deadlineHit = false;
          for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            const leafRemaining = suite.timeoutSeconds * 1_000 - (now() - started);
            if (leafRemaining <= 0) { deadlineHit = true; break; }
            leafResult = await execute(leafInvocation, { cwd: leafCwd, env: child.env || step.env, timeoutMs: leafRemaining, graceMs, home: suiteHome,
              allowNodePath: suite.id === "issue-1902-public-event-lifecycle-tests" && step.commandId.endsWith(":03"),
              // Only a migrated suite whose registry record DECLARES the env may
              // receive it; the validator pins which suites and which literals.
              allowReviewedEnv: isMigratedSuite(suite) && Boolean(step.env) });
            if (leafResult.ok || leafResult.timedOut || attempt === maxAttempts) break;
            const backoffMs = retry.backoffSeconds * 1_000;
            const remainingAfter = suite.timeoutSeconds * 1_000 - (now() - started);
            if (remainingAfter <= backoffMs) { deadlineHit = true; break; }
            console.log(`RETRY ${child.id} attempt ${attempt}/${maxAttempts} failed; waiting ${retry.backoffSeconds}s`);
            await sleepBounded(backoffMs);
          }
          if (deadlineHit) { leafResults.push({ id: child.id, outerCommandId: step.commandId, status: "timed-out", executed: true }); status = "timed-out"; code = 124; reason = "suite deadline exceeded"; outerFailed = true; break; }
          leafResults.push({ id: child.id, outerCommandId: step.commandId, status: leafResult.ok ? "passed" : leafResult.timedOut ? "timed-out" : "failed", executed: true });
          if (!leafResult.ok) {
            outerFailed = true; status = leafResult.timedOut ? "timed-out" : "failed"; code = Math.max(code, leafResult.code || 1);
            // [PR #2546] The reason must NAME the failing leaf. It used to take
            // `runInvocation`'s bare "process exited 1", so a suite whose later
            // five steps all printed PASS reported a nonzero exit with nothing
            // identifying which step produced it. The verdict was honest; the
            // evidence line was not, and an unattributable failure is
            // indistinguishable from a spurious one.
            reason ||= `${child.id} (${step.commandId}): ${leafResult.reason || "leaf failed"}`;
            if (leafResult.timedOut) break;
          }
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
  // [PR #2546] The verdict and its own evidence must agree, in BOTH directions.
  // "passed with a failing leaf" would ship a green lie; "failed with every leaf
  // passing" is the inverse and is what a bare exit code looked like. Either way
  // the run is not trustworthy, so fail closed rather than report the mismatch.
  const verdictDisagrees = (leaves) => {
    if (!leaves.length) return null;
    const bad = leaves.filter((leaf) => !["passed", "skipped-absent"].includes(leaf.status));
    if (status === "passed" && bad.length) return `suite reported passed while ${bad.length} leaf result(s) did not pass`;
    if (status !== "passed" && !bad.length && !reason) return "suite reported a failure with no failing leaf and no reason";
    return null;
  };
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
  const disagreement = verdictDisagrees(completeLeafResults);
  if (disagreement) { status = "failed"; code = Math.max(code, 2); reason = `verdict/evidence mismatch: ${disagreement}`; }
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
    // [PR #2546] A leaf-executing suite never breaks early (ORCH-1383 R2), so a
    // failure in step 1 is followed by five more steps printing PASS. Print every
    // outer's own outcome so the verdict and the visible evidence cannot look
    // like they disagree.
    for (const outer of result.outerResults || []) {
      const leaves = (result.leafResults || []).filter((leaf) => leaf.outerCommandId === outer.id);
      const detail = leaves.map((leaf) => `${leaf.id.split(":").pop()}=${leaf.status}`).join(" ");
      console.log(redactText(`      ${outer.status === "passed" ? "ok  " : "FAIL"}  ${outer.id}  [${detail}]`));
    }
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
  const owned = manifest.suites.filter((suite) => suite.migrationWave === PHASE3B_WAVE && suite.hostClass === hostClass);
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
  // [PR #2546] Last-resort artifact guard. If this process ends before a report
  // is emitted — for ANY reason, including one nobody has thought of yet — write
  // a failing one naming that fact. "No files were found" tells an operator
  // nothing; "the run ended before any verdict was recorded" tells them exactly
  // where to look. Armed before the first suite runs and disarmed on emission.
  let emitted = false;
  const guard = () => {
    if (emitted) return;
    emitted = true;
    try {
      const report = buildShardReport(`phase3c:${hostClass}`, [], [], null, 0);
      report.ok = false; report.code = process.exitCode || 2;
      report.abnormalTermination = "the run ended before any Phase 3C verdict was recorded";
      writeReport(manifest, report, REPO_ROOT, "suite-results-phase3c.json");
    } catch { /* a guard that throws would replace one red with a worse one */ }
    if (!process.exitCode) process.exitCode = 2;
  };
  process.once("exit", guard);
  // [PR #2546] Host resolution is INSIDE the try. It used to throw before the
  // report was written, so a hard error produced no `suite-results-phase3c.json`
  // at all and the upload failed with `if-no-files-found: error` — a second,
  // misleading red on top of the real one. The artifact must always exist and
  // must say what went wrong.
  const started = Date.now(); let evidence = null; let results = []; let suites = [];
  // [#2882] `routed` separates the two ways this host can end up with no suites.
  // A host that never RESOLVED is a failure and must emit a red report; a host
  // that resolved and whose registered suites are simply not invalidated by this
  // pull request is a legitimate green with zero work. Before routing those were
  // the same state, so they need distinguishing before either is acted on.
  let routed = false; let context = null; let selection = null;
  try {
    const owned = phase3cSuitesForHost(manifest, hostClass);
    ({ context, selection } = routeOrFail(manifest, `phase3c:${hostClass}`, owned));
    suites = selection.suites; routed = true;
    if (suites.length) {
      const classes = [...new Set(suites.map((suite) => suite.executionClass))];
      if (classes.length !== 1) throw new Error(`${hostClass}: assigned suites span unreviewed Phase 3C classes`);
      const evidencePath = setupEvidencePath(manifest, classes[0]); evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
      const { profile } = validateSetupEvidence(manifest, classes[0], evidence);
      results = await runSuitesV2(suites, { profile, commandCapabilities: manifest.commandCapabilities,
        leafCapabilities: manifest.phase3cLeafCapabilities, graceMs: manifest.runnerContract.timeoutGraceSeconds * 1_000 });
      fs.rmSync(evidencePath, { force: true });
    }
  } catch (error) {
    results = suites.map((suite) => missingPhase3bResult(suite, error.message));
    if (!routed || (!suites.length && !results.length)) {
      // Nothing resolved: still emit an honest, failing report rather than no file.
      const report = buildShardReport(`phase3c:${hostClass}`, [], [], null, Date.now() - started);
      report.ok = false; report.code = 2; report.hostResolutionError = error.message;
      if (context && selection) report.routing = routingReport(context, selection);
      emitted = true; process.removeListener("exit", guard);
      writeReport(manifest, report, REPO_ROOT, "suite-results-phase3c.json");
      process.exitCode = 2;
      return;
    }
  }
  emitted = true;
  process.removeListener("exit", guard);
  return emitPhase3cReport(manifest, hostClass, suites, results, evidence, started, context, selection);
}

/**
 * [PR #2546] The Phase 3C artifact is written on EVERY path. `runPhase3cHost`
 * used to reach its writeReport only when suite execution returned normally, so
 * any abnormal termination — the unref'd backoff above, an uncaught rejection, a
 * supervisor kill — produced no `suite-results-phase3c.json` at all and the
 * upload failed with `if-no-files-found: error`. That stacked a second,
 * misleading red on top of the real one and hid which host actually broke.
 */
function emitPhase3cReport(manifest, hostClass, suites, results, evidence, started, context = null, selection = null) {
  const report = buildShardReport(`phase3c:${hostClass}`, suites, results, evidence, Date.now() - started);
  if (context && selection) report.routing = routingReport(context, selection);
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
  // [#2882] Print the decision BEFORE the job spends anything on setup, so an
  // operator reading a job that did almost nothing can see why, and so an
  // underivable diff (F3) or an unobservable one (F4) reds the run in seconds
  // rather than after fourteen hosts have finished installing.
  if (process.argv[2] === "--route-preview") {
    const previewClass = process.argv[3];
    const previewCandidates = expectedPrimarySuites(manifest, previewClass);
    if (!previewClass || previewCandidates.length === 0) throw new Error(`no suites registered for class "${previewClass || "<empty>"}"`);
    routeOrFail(manifest, previewClass, previewCandidates);
    return;
  }
  const klass = process.argv[2] === "--run" ? process.argv[3] : process.argv[2];
  const candidates = expectedPrimarySuites(manifest, klass);
  // An UNREGISTERED class is still a hard error. Routing changes which of a
  // class's registered suites run today; it never makes an unknown class legal.
  if (!klass || candidates.length === 0) throw new Error(`no suites registered for class "${klass || "<empty>"}"`);
  let context; let selection;
  try {
    ({ context, selection } = routeOrFail(manifest, klass, candidates));
  } catch (error) {
    // [#2882 F3/F4] A router that cannot see the diff must not leave the upload
    // step to report "no files were found" — that stacks a misleading red on top
    // of the real one and hides which job actually broke. Same reasoning as the
    // Phase 3C exit guard: the artifact always exists and always says what went
    // wrong.
    const report = buildShardReport(klass, [], [], null, 0);
    report.ok = false; report.code = 2; report.routingError = error.message;
    writeReport(manifest, report);
    process.exitCode = 2;
    return;
  }
  const suites = selection.suites;
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
  // The artifact carries the evidence, not just the console. `verdict()`'s
  // executed === expected identity-and-order check is preserved verbatim on the
  // ROUTED set — `buildShardReport` already received `suites`, which is now the
  // selection — and the reconciler re-derives that selection independently.
  report.routing = routingReport(context, selection);
  // [#2882 §12 layer 2] Tier 2 is where an originPaths blind spot becomes
  // visible: everything ran, so a failure here that PR-time routing would have
  // skipped names its own gap. Annotation only — the suite failure already
  // fails the run, and a detector must never be able to red a green one.
  const escapes = detectTier2Escapes(manifest, results);
  if (escapes) report.routing.tier2Escapes = escapes;
  for (const line of renderTier2EscapeAnnotations(escapes)) console.error(line);
  writeReport(manifest, report);
  process.exitCode = report.code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => { console.error(`::error title=CI batch runner::${annotationEscape(redactText(error.message))}`); process.exitCode = 2; });
}
