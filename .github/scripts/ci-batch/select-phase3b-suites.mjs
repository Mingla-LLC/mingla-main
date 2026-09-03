#!/usr/bin/env node
// #2438 / #2148 Phase 3B. Local-Git-only, NUL-safe selector and deferred-red
// decision protocol. Selection can broaden to every suite on one reviewed host;
// it can never suppress that host when evidence is missing or malformed.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isPrimarySuite, isMigratedSuite, suiteCommandFingerprint, suiteOriginPatterns } from "./validate-manifest-v2.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../../..");
export const MANIFEST = path.join(ROOT, ".github/ci-batch/MANIFEST.json");
export const WAVE = "phase3b-postgres-wave";
export const DOC_SCHEMA = "phase3b-selection-v1";
export const SELECTOR_VERSION = "phase3b-local-git-v1";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const byteSort = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

export function parseOriginPattern(value) {
  if (typeof value !== "string" || !value || /[\0\r\n?]/.test(value) || value.startsWith("/")
      || value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`unsafe origin path: ${JSON.stringify(value)}`);
  }
  const stars = [...value].filter((character) => character === "*").length;
  if (!stars) return { mode: "literal-v1", value };
  if (value.endsWith("/**") && stars === 2) return { mode: "descendants-v1", value: value.slice(0, -3) };
  const segment = value.slice(value.lastIndexOf("/") + 1);
  if (stars === 1 && segment.endsWith("*") && segment.indexOf("*") === segment.length - 1) {
    return { mode: "terminal-prefix-v1", value: value.slice(0, -1) };
  }
  throw new Error(`unsupported origin wildcard: ${value}`);
}

export function pathMatches(pattern, candidate) {
  parseOriginPattern(candidate); // changed paths obey the same repository-relative safety grammar
  const parsed = parseOriginPattern(pattern);
  if (parsed.mode === "literal-v1") return candidate === parsed.value;
  if (parsed.mode === "descendants-v1") return candidate.startsWith(`${parsed.value}/`);
  return candidate.startsWith(parsed.value) && !candidate.slice(parsed.value.length).includes("/");
}

export function parseNulPaths(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return [];
  if (buffer[buffer.length - 1] !== 0) throw new Error("changed-path stream is not NUL terminated");
  const values = buffer.subarray(0, -1).toString("utf8").split("\0");
  if (Buffer.from(`${values.join("\0")}\0`, "utf8").compare(buffer) !== 0) throw new Error("changed paths are not valid UTF-8");
  for (const value of values) parseOriginPattern(value);
  return [...new Set(values)].sort(byteSort);
}

export function phase3bSuites(manifest) {
  return manifest.suites.filter((suite) => suite.migrationWave === WAVE);
}

export function suitesForHost(manifest, hostClass) {
  const suites = phase3bSuites(manifest).filter((suite) => suite.hostClass === hostClass);
  if (!manifest.classes.includes(hostClass)) throw new Error(`unreviewed Phase 3B host: ${hostClass}`);
  return suites;
}

export function expectedPhase3bIdentities(manifest, suiteIds) {
  const suites = suiteIds.map((id) => phase3bSuites(manifest).find((suite) => suite.id === id));
  if (suites.some((suite) => !suite)) throw new Error("selected Phase 3B suite identity is not registered");
  const outerIds = suites.flatMap((suite) => suite.steps.map((step) => step.commandId));
  const leafIds = suites.flatMap((suite) => suite.steps.flatMap((step, stepIndex) =>
    step.children?.map((child) => child.id) || [`leaf:${suite.id}:${String(stepIndex + 1).padStart(2, "0")}:1`]));
  return { outerIds, leafIds };
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);


function profileInstalls(profile) {
  return profile?.install ? [profile.install] : Array.isArray(profile?.installs) ? profile.installs : [];
}

function exposurePayload(exposure) {
  return { id: exposure.id, providerCwd: exposure.providerCwd, consumerCwd: exposure.consumerCwd,
    packageName: exposure.packageName, executableName: exposure.executableName, version: exposure.version,
    providerPackage: exposure.providerPackage, providerExecutable: exposure.providerExecutable,
    consumerPackageLink: exposure.consumerPackageLink, consumerPackageLinkTarget: exposure.consumerPackageLinkTarget,
    consumerBinLink: exposure.consumerBinLink, consumerBinLinkTarget: exposure.consumerBinLinkTarget,
    authorityLock: exposure.authorityLock, authorityKey: exposure.authorityKey };
}

function setupAuthority(manifest, executionClass) {
  const owners = Object.entries(manifest.setupProfiles || {}).filter(([, profile]) => profile.classes?.includes(executionClass));
  if (owners.length !== 1) throw new Error(`secondary class ${executionClass} must have one setup owner`);
  const [name, profile] = owners[0];
  const installs = profileInstalls(profile);
  const orderedInstalls = installs.map((install) => ({ id: install.id, cwd: install.cwd,
    command: install.invocation.command, argv: install.invocation.argv }));
  const orderedToolExposures = (profile.toolExposures || []).map(exposurePayload);
  const dependencyCwds = [];
  for (const install of installs) if (!dependencyCwds.includes(install.cwd)) dependencyCwds.push(install.cwd);
  return { name, orderedInstalls, setupFingerprint: sha256(JSON.stringify(orderedInstalls)),
    orderedToolExposures, toolExposureFingerprint: sha256(JSON.stringify(orderedToolExposures)), dependencyCwds };
}

function statusSummary(results) {
  return Object.fromEntries(["passed", "failed", "timed-out", "missing"].map((status) => [status, results.filter((result) => result.status === status).length]));
}

function topLevelVerdictIsExact(report, expectedIds) {
  const results = Array.isArray(report?.results) ? report.results : [];
  return same(report?.expectedSuiteIds, expectedIds) && same(report?.executedSuiteIds, expectedIds)
    && same(results.map((result) => result.id), expectedIds) && report?.expected === expectedIds.length
    && report?.executed === expectedIds.length && report?.shortfall === 0 && same(report?.failed, [])
    && same(report?.duplicateIds, []) && report?.identityMismatch === false && same(report?.malformedIds, [])
    && report?.ok === true && report?.code === 0 && same(report?.statuses, statusSummary(results));
}

function primaryResultIsExact(suite, result) {
  return result?.id === suite.id && result?.setupProfile === suite.setupProfile
    && result?.commandFingerprint === suiteCommandFingerprint(suite) && result?.expected === suite.steps.length
    && result?.executed === suite.steps.length && result?.status === "passed" && result?.ok === true && result?.code === 0;
}

function expectedLeafRows(suite) {
  const predicatePaths = []; const seenPaths = new Set();
  const rows = suite.steps.flatMap((step, stepIndex) => (step.children || [{
    id: `leaf:${suite.id}:${String(stepIndex + 1).padStart(2, "0")}:1`, predicate: { kind: "always" },
  }]).map((leaf) => {
    const predicate = leaf.predicate || { kind: "always" };
    if (predicate.kind === "always") {
      if (!same(Object.keys(predicate).sort(byteSort), ["kind"])) throw new Error(`${leaf.id}: malformed always predicate`);
      return { id: leaf.id, outerCommandId: step.commandId, expectedExecuted: true };
    }
    if (predicate.kind !== "file-exists" || !same(Object.keys(predicate).sort(byteSort), ["kind", "path"])) {
      throw new Error(`${leaf.id}: unknown or malformed predicate`);
    }
    const relative = predicate.path;
    if (typeof relative !== "string" || !relative || relative.trim() !== relative || relative.startsWith("/")
        || /^[A-Za-z]:/.test(relative) || relative.includes("\\") || relative.includes("\0") || relative.endsWith("/")
        || relative.split("/").some((part) => !part || part === "." || part === "..") || path.posix.normalize(relative) !== relative) {
      throw new Error(`${leaf.id}: predicate path escapes canonical repository truth`);
    }
    if (seenPaths.has(relative)) throw new Error(`${leaf.id}: duplicate predicate path`);
    seenPaths.add(relative); predicatePaths.push(relative);
    return { id: leaf.id, outerCommandId: step.commandId, expectedExecuted: fs.existsSync(path.join(ROOT, relative)) };
  }));
  if (!same([...predicatePaths].sort(byteSort), [...(suite.conditionalExpectedFiles || [])].sort(byteSort))) {
    throw new Error(`${suite.id}: conditional predicate paths drifted`);
  }
  return rows;
}

function secondaryResultIsExact(suite, result, authority) {
  let expectedLeaves;
  try { expectedLeaves = expectedLeafRows(suite); } catch { return false; }
  if (result?.id !== suite.id || result?.setupProfile !== suite.setupProfile
      || result?.commandFingerprint !== suiteCommandFingerprint(suite) || result?.expected !== suite.steps.length
      || result?.executed !== suite.steps.length || result?.status !== "passed" || result?.ok !== true || result?.code !== 0
      || !same(result?.dependencyCwds, authority.dependencyCwds) || result?.dependencyCloneCount !== authority.dependencyCwds.length
      || !Array.isArray(result?.leafResults) || result.leafResults.length !== expectedLeaves.length
      || !Array.isArray(result?.outerResults) || result.outerResults.length !== suite.steps.length) return false;
  for (const [index, expected] of expectedLeaves.entries()) {
    const leaf = result.leafResults[index];
    if (leaf?.id !== expected.id || leaf?.outerCommandId !== expected.outerCommandId
        || (expected.expectedExecuted ? leaf?.status !== "passed" || leaf.executed !== true
          : leaf?.status !== "skipped-absent" || leaf.executed !== false)) return false;
  }
  for (const [index, step] of suite.steps.entries()) {
    const leaves = result.leafResults.filter((leaf) => leaf.outerCommandId === step.commandId);
    const outer = result.outerResults[index];
    if (outer?.id !== step.commandId || outer?.status !== "passed" || outer?.executed !== true
        || outer?.expectedLeaves !== leaves.length || outer?.executedLeaves !== leaves.filter((leaf) => leaf.executed).length
        || outer?.skippedAbsentLeaves !== leaves.filter((leaf) => leaf.status === "skipped-absent").length) return false;
  }
  const absent = result.leafResults.filter((leaf) => leaf.status === "skipped-absent").length;
  return result.expectedLeaves === expectedLeaves.length && result.presentLeaves === expectedLeaves.length - absent
    && result.executedLeaves === expectedLeaves.length - absent && result.absentLeaves === absent;
}

function setupEvidenceIsExact(report, authority, executionClass) {
  const installs = Array.isArray(report?.orderedInstalls) ? report.orderedInstalls : [];
  const installPayload = installs.map(({ id, cwd, command, argv }) => ({ id, cwd, command, argv }));
  const installRecordsValid = installs.every((record) => record.status === "passed" && Number.isFinite(record.durationMs) && record.durationMs >= 0);
  const exposures = Array.isArray(report?.orderedToolExposures) ? report.orderedToolExposures : [];
  const exposureRecordsValid = exposures.every((record) => record.status === "passed" && Number.isFinite(record.durationMs) && record.durationMs >= 0);
  return report?.setupClass === executionClass && report?.setupProfile === authority.name && report?.setupExecutions === 1
    && report?.installExecutions === authority.orderedInstalls.length && same(installPayload, authority.orderedInstalls)
    && report?.setupFingerprint === authority.setupFingerprint && installRecordsValid
    && report?.toolExposureExecutions === authority.orderedToolExposures.length
    && same(exposures.map(exposurePayload), authority.orderedToolExposures)
    && report?.toolExposureFingerprint === authority.toolExposureFingerprint && exposureRecordsValid;
}

/**
 * [#2882] Which primary suites this host was DUE to run.
 *
 * A report carrying no `routing` block is a pre-#2882 or unrouted run and the
 * answer is unchanged: everything the host owns. `mode: "full"` — push, schedule,
 * workflow_dispatch — is the same answer said explicitly.
 */
export function expectedRoutedPrimaryIds(ownedPrimary, routing) {
  if (!routing || routing.mode !== "routed") return ownedPrimary.map((suite) => suite.id);
  const changedPaths = Array.isArray(routing.changedPaths) ? routing.changedPaths : [];
  try {
    return ownedPrimary
      .filter((suite) => suiteOriginPatterns(suite).some((pattern) => changedPaths.some((file) => pathMatches(pattern, file))))
      .map((suite) => suite.id);
  } catch {
    // A registry too broken to route from should already have failed the build
    // in the validator, but the reconcile step runs `if: always()` and so can
    // still reach here. Fall back to OWNERSHIP — the larger expectation — so a
    // routed run that skipped anything goes red. The named reason is pushed by
    // reconcilePrimaryRouting; a stack trace here would say less and hide it.
    return ownedPrimary.map((suite) => suite.id);
  }
}

export function changedPathDigest(changedPaths) {
  return sha256(Buffer.concat([...changedPaths].sort(byteSort).map((value) => Buffer.from(`${value}\0`, "utf8"))));
}

/**
 * [#2882] Every way the routing block itself could be a lie, refused.
 *
 * The selector already derived and SEALED this pull request's changed-path list
 * in a separate step before any suite ran. When that document is trustworthy
 * (`mode: "selected"`), the runner's independently derived list must agree with
 * it byte for byte — two derivations, one answer, or red.
 */
function reconcilePrimaryRouting(ownedPrimary, decision, primary) {
  const errors = [];
  const routing = primary?.routing;
  if (routing === undefined || routing === null) return errors;
  if (!["routed", "full"].includes(routing.mode)) return [`primary-routing-mode-invalid: ${routing.mode}`];
  if (routing.registry !== undefined && !Number.isInteger(routing.registry)) errors.push("primary-routing-denominator-invalid");
  if (routing.mode === "full") {
    if (Array.isArray(routing.classSelectedSuiteIds)
        && JSON.stringify(routing.classSelectedSuiteIds) !== JSON.stringify(ownedPrimary.map((suite) => suite.id))) {
      errors.push("primary-routing-full-mode-selected-a-subset");
    }
    return errors;
  }
  const changedPaths = routing.changedPaths;
  // F4 restated at reconcile time: an empty diff on a routed event is "could not
  // observe", never "observed nothing".
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) return [...errors, "primary-routing-empty-diff"];
  for (const value of changedPaths) {
    try { parseOriginPattern(value); } catch (error) { return [...errors, `primary-routing-path-unsafe: ${error.message}`]; }
  }
  for (const suite of ownedPrimary) {
    try { suiteOriginPatterns(suite); }
    catch (error) { return [...errors, `primary-routing-registry-unreadable: ${error.message}`]; }
  }
  const recomputed = expectedRoutedPrimaryIds(ownedPrimary, routing);
  if (JSON.stringify(routing.classSelectedSuiteIds) !== JSON.stringify(recomputed)) errors.push("primary-routing-mismatch");
  if (routing.changedPathSha256 !== changedPathDigest(changedPaths)) errors.push("primary-routing-digest-mismatch");
  if (decision?.mode === "selected" && decision.changedPathSha256 !== changedPathDigest(changedPaths)) {
    errors.push("primary-routing-diff-disagrees-with-selector");
  }
  return errors;
}

export function reconcilePhase3bReports(manifest, host, rawDecision, primary, secondary = null) {
  const errors = []; let decision = null;
  try { decision = validateDecision(manifest, rawDecision, host); }
  catch (error) { errors.push(`decision-invalid: ${error.message}`); }
  // [#2439] DERIVED lane membership. This filter used to read
  // `suite.migrationWave !== WAVE`, i.e. "not Phase 3B", which silently meant
  // "primary" only while Phase 3B was the only migrated wave. The moment Phase
  // 3C shipped, its seventeen suites were in neither set: they ran in their own
  // host lane while this reconciler still counted them as primary, and six batch
  // hosts died on `primary-identity-mismatch`. The fix is not a second
  // hard-coded name — it is to ask the registry which lane a suite belongs to.
  const migratedIds = new Set(manifest.suites.filter(isMigratedSuite).map((suite) => suite.id));
  // [#2882] The primary lane now ROUTES on `originPaths` for pull-request events,
  // so "what this host owns" and "what this host was due to run" stopped being
  // the same list. Reconciling against ownership alone made every routed run red
  // with `primary-identity-mismatch` — reproduced before this line was written.
  //
  // The report does NOT get to declare its own expectation. It supplies only the
  // changed-path list; the selection is recomputed HERE from the registry, and a
  // disagreement is red. That keeps the identity-and-order guarantee exactly as
  // strong as it was: the routed set is derived twice, independently, and both
  // derivations must agree before any suite is allowed to be absent.
  const ownedPrimary = manifest.suites.filter((suite) => suite.class === host && isPrimarySuite(suite));
  errors.push(...reconcilePrimaryRouting(ownedPrimary, decision, primary));
  const expectedPrimaryIds = expectedRoutedPrimaryIds(ownedPrimary, primary?.routing);
  const primaryIds = Array.isArray(primary?.results) ? primary.results.map((result) => result.id) : [];
  // Any migrated suite appearing in the primary report is a wrong-lane duplicate,
  // whichever wave it belongs to — not only a Phase 3B one.
  const primaryMigrated = primaryIds.filter((id) => migratedIds.has(id));
  if (primaryMigrated.length) errors.push(`wrong-lane-duplicate: ${primaryMigrated.join(",")}`);
  const expectedPrimarySuites = expectedPrimaryIds.map((id) => manifest.suites.find((suite) => suite.id === id));
  if (primary?.schemaVersion !== 2 || primary?.class !== host || !topLevelVerdictIsExact(primary, expectedPrimaryIds)
      || expectedPrimarySuites.some((suite, index) => !primaryResultIsExact(suite, primary?.results?.[index]))) {
    errors.push("primary-identity-mismatch");
  }
  if (!primary?.ok || primary?.results?.some((result) => !result.ok)) errors.push("primary-failed");

  if (decision) {
    const selected = decision.selectedSuiteIds;
    if (!selected.length) {
      if (secondary !== null && secondary !== undefined) errors.push("no-selection-secondary-execution");
    } else if (!secondary) {
      errors.push(`missing-intended-secondary: ${selected.join(",")}`);
    } else {
      const identities = expectedPhase3bIdentities(manifest, selected);
      const selectedSuites = selected.map((id) => phase3bSuites(manifest).find((suite) => suite.id === id));
      const executionClasses = [...new Set(selectedSuites.map((suite) => suite.executionClass))];
      let authority = null;
      try { if (executionClasses.length !== 1) throw new Error("selected suites span setup owners"); authority = setupAuthority(manifest, executionClasses[0]); }
      catch (error) { errors.push(`secondary-setup-authority-invalid: ${error.message}`); }
      const secondaryIds = Array.isArray(secondary.results) ? secondary.results.map((result) => result.id) : [];
      const missing = selected.filter((id) => !secondaryIds.includes(id));
      if (missing.length) errors.push(`missing-intended-secondary: ${missing.join(",")}`);
      const foreign = secondaryIds.filter((id) => !selected.includes(id)
        || !suitesForHost(manifest, host).some((suite) => suite.id === id));
      if (foreign.length) errors.push(`wrong-host-or-unselected-secondary: ${foreign.join(",")}`);
      if (new Set(secondaryIds).size !== secondaryIds.length) errors.push("duplicate-secondary");
      if (JSON.stringify(secondaryIds) !== JSON.stringify(selected)) errors.push("secondary-order-mismatch");
      const rawLeaves = selectedSuites.flatMap((suite, index) => secondary.results?.[index]?.leafResults || []);
      const derivedExecutedLeafIds = rawLeaves.filter((leaf) => leaf.executed).map((leaf) => leaf.id);
      const derivedAbsentLeafIds = rawLeaves.filter((leaf) => leaf.status === "skipped-absent").map((leaf) => leaf.id);
      const leafUnion = [...derivedExecutedLeafIds, ...derivedAbsentLeafIds];
      if (secondary.schemaVersion !== 2 || secondary.class !== `phase3b:${host}` || secondary.selectionDigest !== decision.digest
          || secondary.selectionMode !== decision.mode || secondary.deferredError !== decision.deferredError
          || !topLevelVerdictIsExact(secondary, selected) || !authority || !setupEvidenceIsExact(secondary, authority, executionClasses[0])
          || selectedSuites.some((suite, index) => !secondaryResultIsExact(suite, secondary.results?.[index], authority))
          || !same(secondary.expectedOuterIds, identities.outerIds) || !same(secondary.executedOuterIds, identities.outerIds)
          || !same(secondary.expectedLeafIds, identities.leafIds) || !same(secondary.observedLeafIds, identities.leafIds)
          || !same(rawLeaves.map((leaf) => leaf.id), identities.leafIds)
          || !same(secondary.executedLeafIds, derivedExecutedLeafIds) || !same(secondary.absentLeafIds, derivedAbsentLeafIds)
          || new Set(derivedExecutedLeafIds).size !== derivedExecutedLeafIds.length
          || new Set(derivedAbsentLeafIds).size !== derivedAbsentLeafIds.length
          || derivedExecutedLeafIds.some((id) => derivedAbsentLeafIds.includes(id))
          || !same([...leafUnion].sort(byteSort), [...identities.leafIds].sort(byteSort))) {
        errors.push("secondary-evidence-mismatch");
      }
      if (!secondary.ok || secondary.results?.some((result) => result.executed !== result.expected || !result.ok)) errors.push("secondary-failed");
    }
    for (const id of selected) {
      const primaryCount = primaryIds.filter((candidate) => candidate === id).length;
      const secondaryCount = (secondary?.results || []).filter((result) => result.id === id).length;
      if (primaryCount !== 0 || secondaryCount !== 1) errors.push(`lane-cardinality-mismatch: ${id}:primary=${primaryCount}:secondary=${secondaryCount}`);
    }
    if (decision.deferredError) errors.push(`deferred-selector-failure: ${decision.error}`);
  }
  return errors;
}

export function selectionDocument(manifest, hostClass, changedPaths, { failSafe = false, error = null, source = {} } = {}) {
  const owned = suitesForHost(manifest, hostClass);
  const matched = failSafe ? owned : owned.filter((suite) => changedPaths.some((file) => suite.originPaths.some((pattern) => pathMatches(pattern, file))));
  const sortedPaths = [...changedPaths].sort(byteSort);
  const body = { schema: DOC_SCHEMA, selectorVersion: SELECTOR_VERSION, wave: WAVE, hostClass,
    eventName: source.eventName || null, baseSha: source.baseSha || null, headSha: source.headSha || null,
    mergeBaseSha: source.mergeBaseSha || null, pathSource: source.pathSource || null,
    changedPathSha256: sha256(Buffer.concat(sortedPaths.map((value) => Buffer.from(`${value}\0`, "utf8")))),
    mode: failSafe ? "fail-safe-host" : "selected", changedPaths: sortedPaths,
    originDecisions: owned.map((suite) => ({ suiteId: suite.id, origin: suite.origin, patterns: suite.originPaths,
      matched: failSafe || sortedPaths.some((file) => suite.originPaths.some((pattern) => pathMatches(pattern, file))) })),
    selectedSuiteIds: matched.map((suite) => suite.id), selectedClassIds: [...new Set(matched.map((suite) => suite.executionClass))],
    ownedSuiteIds: owned.map((suite) => suite.id), staticHostOwnership: phase3bSuites(manifest).map((suite) => ({ suiteId: suite.id, hostClass: suite.hostClass, executionClass: suite.executionClass })),
    deferredError: Boolean(error), error };
  return { ...body, digest: sha256(JSON.stringify(body)) };
}

export function validateDecision(manifest, document, hostClass) {
  if (!document || document.schema !== DOC_SCHEMA || document.selectorVersion !== SELECTOR_VERSION || document.wave !== WAVE || document.hostClass !== hostClass) throw new Error("selection document identity mismatch");
  const digest = document.digest; const body = { ...document }; delete body.digest;
  if (digest !== sha256(JSON.stringify(body))) throw new Error("selection document digest mismatch");
  const owned = suitesForHost(manifest, hostClass).map((suite) => suite.id);
  const ownedSuites = suitesForHost(manifest, hostClass);
  if (!Array.isArray(document.changedPaths) || JSON.stringify(document.changedPaths) !== JSON.stringify([...document.changedPaths].sort(byteSort))) throw new Error("changed path ordering mismatch");
  for (const changedPath of document.changedPaths) parseOriginPattern(changedPath);
  const expectedDecisions = ownedSuites.map((suite) => ({ suiteId: suite.id, origin: suite.origin, patterns: suite.originPaths,
    matched: document.mode === "fail-safe-host" || document.changedPaths.some((file) => suite.originPaths.some((pattern) => pathMatches(pattern, file))) }));
  if (JSON.stringify(document.ownedSuiteIds) !== JSON.stringify(owned)
      || document.selectedSuiteIds.some((id) => !owned.includes(id))
      || new Set(document.selectedSuiteIds).size !== document.selectedSuiteIds.length) throw new Error("selection ownership mismatch");
  if (document.mode === "fail-safe-host" && JSON.stringify(document.selectedSuiteIds) !== JSON.stringify(owned)) throw new Error("fail-safe must select the complete host");
  if (document.mode === "selected" && (!['pull_request','push'].includes(document.eventName)
      || !/^[0-9a-f]{40}$/.test(document.baseSha || "") || !/^[0-9a-f]{40}$/.test(document.headSha || "")
      || !/^[0-9a-f]{40}$/.test(document.mergeBaseSha || "")
      || document.pathSource !== (document.eventName === "pull_request" ? "local-git-three-dot-nul" : "local-git-two-dot-nul"))) {
    throw new Error("selection source identity mismatch");
  }
  const identities = expectedPhase3bIdentities(manifest, document.selectedSuiteIds);
  if (JSON.stringify(document.selectedClassIds) !== JSON.stringify([...new Set(document.selectedSuiteIds.map((id) => phase3bSuites(manifest).find((suite) => suite.id === id).executionClass))])
      || document.changedPathSha256 !== sha256(Buffer.concat(document.changedPaths.map((value) => Buffer.from(`${value}\0`, "utf8"))))
      || JSON.stringify(document.staticHostOwnership) !== JSON.stringify(phase3bSuites(manifest).map((suite) => ({ suiteId: suite.id, hostClass: suite.hostClass, executionClass: suite.executionClass })))
      || JSON.stringify(document.originDecisions) !== JSON.stringify(expectedDecisions)
      || JSON.stringify(document.selectedSuiteIds) !== JSON.stringify(expectedDecisions.filter((decision) => decision.matched).map((decision) => decision.suiteId))
      || identities.outerIds.length < document.selectedSuiteIds.length) throw new Error("selection evidence inventory mismatch");
  if (!['selected','fail-safe-host'].includes(document.mode)) throw new Error("selection mode is invalid");
  return document;
}

export function normalizeDecision(manifest, raw, hostClass, selectorOutcome = "success") {
  try {
    if (selectorOutcome !== "success") throw new Error(`selector outcome ${selectorOutcome}`);
    return validateDecision(manifest, raw, hostClass);
  } catch (error) {
    return selectionDocument(manifest, hostClass, [], { failSafe: true, error: error.message });
  }
}

export function deriveChangedPaths({ root = ROOT, eventName, event }) {
  let range;
  let baseSha;
  let headSha;
  if (eventName === "pull_request") {
    const base = event?.pull_request?.base?.sha; const head = event?.pull_request?.head?.sha;
    if (!base || !head) throw new Error("pull_request base/head SHA missing");
    range = `${base}...${head}`;
    baseSha = base; headSha = head;
  } else if (eventName === "push") {
    if (!event?.before || !event?.after || /^0+$/.test(event.before)) throw new Error("push before/after SHA missing");
    range = `${event.before}..${event.after}`;
    baseSha = event.before; headSha = event.after;
  } else throw new Error(`unsupported selector event: ${eventName}`);
  const changedPaths = parseNulPaths(execFileSync("git", ["diff", "--name-only", "-z", "--no-renames", "--diff-filter=ACMRTD", range], { cwd: root, encoding: "buffer" }));
  const mergeBaseSha = execFileSync("git", ["merge-base", baseSha, headSha], { cwd: root, encoding: "utf8" }).trim();
  return { changedPaths, eventName, baseSha, headSha, mergeBaseSha, pathSource: eventName === "pull_request" ? "local-git-three-dot-nul" : "local-git-two-dot-nul" };
}

function atomicWrite(destination, document) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(document)}\n`, { flag: "wx" });
  fs.renameSync(temporary, destination);
}

function output(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""));
}

function args() { return Object.fromEntries(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value.slice(2), !all[index + 1] || all[index + 1].startsWith("--") ? true : all[index + 1]] : null).filter(Boolean)); }

export function selfTest() {
  const literal = "mingla-business/app/event/[id]/edit.tsx";
  if (!pathMatches(literal, literal) || pathMatches(literal, "mingla-business/app/event/id/edit.tsx")) throw new Error("literal bracket contract failed");
  if (!pathMatches("mingla-business/src/components/theme/**", "mingla-business/src/components/theme/a.ts")
      || !pathMatches("mingla-business/src/utils/__tests__/issue1022*", "mingla-business/src/utils/__tests__/issue1022A.test.ts")) throw new Error("reviewed wildcard contract failed");
  for (const bad of ["/abs", "a//b", "a/../b", "a?b", "a/**/b", "a*[x]", "a\n"] ) {
    try { parseOriginPattern(bad); throw new Error(`accepted ${bad}`); } catch (error) { if (/accepted/.test(error.message)) throw error; }
  }
  const nul = parseNulPaths(Buffer.from("b\0a\0")); if (JSON.stringify(nul) !== JSON.stringify(["a", "b"])) throw new Error("NUL byte sort failed");
  console.log("#2438 selector self-test: PASS");
}

async function main() {
  const options = args(); if (options["self-test"]) return selfTest();
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")); const host = String(options.host || "");
  const destination = String(options.document || path.join(process.env.RUNNER_TEMP || os.tmpdir(), `phase3b-${host}.json`));
  if (options.select) {
    try {
      const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
      const source = deriveChangedPaths({ eventName: process.env.GITHUB_EVENT_NAME, event });
      const document = selectionDocument(manifest, host, source.changedPaths, { source });
      atomicWrite(destination, document); output({ document: destination, digest: document.digest, runSecondary: document.selectedSuiteIds.length > 0, deferredError: false });
    } catch (error) {
      const document = selectionDocument(manifest, host, [], { failSafe: true, error: error.message });
      atomicWrite(destination, document); output({ document: destination, digest: document.digest, runSecondary: true, deferredError: true }); process.exitCode = 1;
    }
    return;
  }
  if (options.normalize) {
    let raw = null; try { raw = JSON.parse(fs.readFileSync(String(options.input), "utf8")); } catch {}
    const document = normalizeDecision(manifest, raw, host, String(options.outcome || "missing")); atomicWrite(destination, document);
    output({ document: destination, digest: document.digest, runSecondary: document.selectedSuiteIds.length > 0, deferredError: document.deferredError }); return;
  }
  if (options.reconcile) {
    let decision = null; let primary = null; let secondary = null; const readErrors = [];
    try { decision = JSON.parse(fs.readFileSync(String(options.input), "utf8")); } catch (error) { readErrors.push(`decision-unreadable: ${error.message}`); }
    try { primary = JSON.parse(fs.readFileSync(String(options.primary), "utf8")); } catch (error) { readErrors.push(`primary-unreadable: ${error.message}`); }
    if (options.secondary && fs.existsSync(String(options.secondary))) {
      try { secondary = JSON.parse(fs.readFileSync(String(options.secondary), "utf8")); } catch (error) { readErrors.push(`secondary-unreadable: ${error.message}`); }
    }
    const errors = [...readErrors, ...reconcilePhase3bReports(manifest, host, decision, primary, secondary)];
    if (errors.length) throw new Error(`Phase 3B reconciliation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
    return;
  }
  throw new Error("expected --select, --normalize, --reconcile, or --self-test");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((error) => { console.error(error.message); process.exitCode = 2; });
