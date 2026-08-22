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

export function reconcilePhase3bReports(manifest, host, rawDecision, primary, secondary = null) {
  const errors = []; let decision = null;
  try { decision = validateDecision(manifest, rawDecision, host); }
  catch (error) { errors.push(`decision-invalid: ${error.message}`); }
  const phase3bIds = new Set(phase3bSuites(manifest).map((suite) => suite.id));
  const expectedPrimaryIds = manifest.suites.filter((suite) => suite.class === host && suite.migrationWave !== WAVE).map((suite) => suite.id);
  const primaryIds = Array.isArray(primary?.executedSuiteIds) ? primary.executedSuiteIds : primary?.results?.map((result) => result.id) || [];
  const primaryPhase3b = primaryIds.filter((id) => phase3bIds.has(id));
  if (primaryPhase3b.length) errors.push(`wrong-lane-duplicate: ${primaryPhase3b.join(",")}`);
  if (primary?.schemaVersion !== 2 || primary?.class !== host
      || JSON.stringify(primary?.expectedSuiteIds) !== JSON.stringify(expectedPrimaryIds)
      || JSON.stringify(primaryIds) !== JSON.stringify(expectedPrimaryIds)
      || primary?.expected !== expectedPrimaryIds.length || primary?.executed !== expectedPrimaryIds.length) {
    errors.push("primary-identity-mismatch");
  }
  if (!primary?.ok || primary?.results?.some((result) => !result.ok)) errors.push("primary-failed");

  if (decision) {
    const selected = decision.selectedSuiteIds;
    if (!selected.length) {
      const secondaryIds = secondary?.results?.map((result) => result.id) || [];
      if (secondaryIds.some((id) => phase3bIds.has(id)) || secondary?.executed > 0) errors.push("no-selection-secondary-execution");
    } else if (!secondary) {
      errors.push(`missing-intended-secondary: ${selected.join(",")}`);
    } else {
      const identities = expectedPhase3bIdentities(manifest, selected);
      const secondaryIds = secondary.results?.map((result) => result.id) || [];
      const missing = selected.filter((id) => !secondaryIds.includes(id));
      if (missing.length) errors.push(`missing-intended-secondary: ${missing.join(",")}`);
      const foreign = secondaryIds.filter((id) => !selected.includes(id)
        || !suitesForHost(manifest, host).some((suite) => suite.id === id));
      if (foreign.length) errors.push(`wrong-host-or-unselected-secondary: ${foreign.join(",")}`);
      if (new Set(secondaryIds).size !== secondaryIds.length) errors.push("duplicate-secondary");
      if (JSON.stringify(secondaryIds) !== JSON.stringify(selected)) errors.push("secondary-order-mismatch");
      if (secondary.schemaVersion !== 2 || secondary.class !== `phase3b:${host}` || secondary.selectionDigest !== decision.digest
          || secondary.expected !== selected.length || secondary.executed !== selected.length
          || JSON.stringify(secondary.expectedSuiteIds) !== JSON.stringify(selected)
          || JSON.stringify(secondary.executedSuiteIds) !== JSON.stringify(selected)
          || JSON.stringify(secondary.expectedOuterIds) !== JSON.stringify(identities.outerIds)
          || JSON.stringify(secondary.executedOuterIds) !== JSON.stringify(identities.outerIds)
          || JSON.stringify(secondary.expectedLeafIds) !== JSON.stringify(identities.leafIds)
          || JSON.stringify(secondary.observedLeafIds) !== JSON.stringify(identities.leafIds)
          || new Set([...(secondary.executedLeafIds || []), ...(secondary.absentLeafIds || [])]).size !== identities.leafIds.length) {
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
