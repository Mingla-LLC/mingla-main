#!/usr/bin/env node
// #2435 / #2148 Phase 1. Fail-closed validator for the deterministic CI registry.
// The registry is deliberately static. Discovery is used only to prove that the
// committed inventory is complete; it is never used to decide what CI executes.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(HERE, "../../..");
export const DEFAULT_MANIFEST = path.join(DEFAULT_ROOT, ".github/ci-batch/MANIFEST.json");
const LIVE_ORIGIN = /^(?:issue-|orch-|meta-).*\.ya?ml$/;
const ALLOWED_DISPOSITIONS = new Set([
  "batched-active",
  "full-suite-superset",
  "build-assertion-consumer",
  "database-special",
  "operational-excluded",
  "approved-retired",
]);

function fail(errors, message) {
  errors.push(message);
}

function strings(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function trackedFiles(root) {
  try {
    return execFileSync("git", ["ls-files", "-z"], { cwd: root })
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
  } catch {
    throw new Error("registry validation requires a git worktree");
  }
}

export function discoverLiveOrigins(root = DEFAULT_ROOT) {
  return fs
    .readdirSync(path.join(root, ".github/workflows"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && LIVE_ORIGIN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function indentedBlock(lines, key, indent = 0) {
  const start = lines.findIndex((line) => line.match(new RegExp(`^ {${indent}}${key}:\\s*(?:#.*)?$`)));
  if (start < 0) return [];
  const out = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && (line.match(/^ */)?.[0].length || 0) <= indent) break;
    out.push(line);
  }
  return out;
}

export function inspectWorkflow(root, workflowName) {
  const source = fs.readFileSync(path.join(root, ".github/workflows", workflowName), "utf8");
  const lines = source.split(/\r?\n/);
  const onLine = lines.find((line) => /^on:\s*/.test(line)) || "";
  const onBlock = indentedBlock(lines, "on");
  const inlineEvents = onLine.match(/^on:\s*\[([^\]]+)\]/)?.[1]
    ?.split(",").map((item) => item.trim()).filter(Boolean) || [];
  const events = new Set(inlineEvents);
  for (const line of onBlock) {
    const match = line.match(/^ {2}([A-Za-z_]+):/);
    if (match) events.add(match[1]);
  }
  const pathScope = [];
  let pathIndent = -1;
  for (const line of onBlock) {
    const indent = line.match(/^ */)?.[0].length || 0;
    if (/^\s+paths(?:-ignore)?:\s*$/.test(line)) { pathIndent = indent; continue; }
    if (pathIndent >= 0 && line.trim() && indent <= pathIndent) pathIndent = -1;
    const item = pathIndent >= 0 ? line.match(/^\s+-\s+["']?([^"'#]+?)["']?\s*(?:#.*)?$/) : null;
    if (item) pathScope.push(item[1].trim());
  }
  const actions = [...new Set(lines.map((line) => line.match(/^\s*-\s+uses:\s*([^\s#]+)/)?.[1]).filter(Boolean))].sort();
  const runners = [...new Set(lines.map((line) => line.match(/^\s*runs-on:\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/)?.[1]?.trim()).filter(Boolean))].sort();
  const runtimeVersions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const action = lines[index].match(/^\s*-\s+uses:\s*actions\/setup-(node|python)@([^\s#]+)/);
    const deno = lines[index].match(/^\s*-\s+uses:\s*denoland\/setup-deno@([^\s#]+)/);
    if (!action && !deno) continue;
    const window = lines.slice(index + 1, index + 8).join("\n");
    if (action) {
      const version = window.match(new RegExp(`${action[1]}-version:\\s*["']?([^"'\\s#]+)`))?.[1] || "unspecified";
      runtimeVersions.push(`${action[1]}:${version}`);
    } else {
      const version = window.match(/deno-version:\s*["']?([^"'\s#]+)/)?.[1] || "unspecified";
      runtimeVersions.push(`deno:${version}`);
    }
  }
  const jobsBlock = indentedBlock(lines, "jobs");
  const jobKeys = jobsBlock.map((line) => line.match(/^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/)?.[1]).filter(Boolean);
  const permissionBlock = indentedBlock(lines, "permissions").map((line) => line.trim()).filter(Boolean);
  const topPermission = lines.find((line) => /^permissions:\s*\S+/.test(line))?.replace(/^permissions:\s*/, "") || null;
  const environments = [...new Set(lines.map((line) => line.match(/^\s+environment:\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/)?.[1]?.trim()).filter(Boolean))].sort();
  return {
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    triggers: [...events].sort(),
    pathScope: [...new Set(pathScope)].sort(),
    jobKeys: [...new Set(jobKeys)].sort(),
    runners,
    runtimeVersions: [...new Set(runtimeVersions)].sort(),
    setupActions: actions,
    trustBoundary: {
      permissions: topPermission ? [topPermission] : permissionBlock,
      environments,
      usesRepositorySecrets: source.includes("secrets."),
      usesOidc: /id-token:\s*write/.test(source),
      pullRequestTarget: events.has("pull_request_target"),
    },
  };
}

export function discoverWorkflowProviders(root = DEFAULT_ROOT) {
  const workflowNames = new Set(
    fs
      .readdirSync(path.join(root, ".github/workflows"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
      .map((entry) => entry.name),
  );
  const references = new Map();
  for (const relative of trackedFiles(root)) {
    if (
      relative.startsWith(".github/workflows/") ||
      relative.startsWith("docs/") ||
      relative.endsWith(".md") ||
      relative === ".github/ci-batch/MANIFEST.json"
    ) continue;
    const absolute = path.join(root, relative);
    let source;
    try {
      source = fs.readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    const mentioned = new Set(source.match(/[A-Za-z0-9_.-]+\.ya?ml/g) || []);
    for (const name of mentioned) {
      if (!workflowNames.has(name)) continue;
      if (!references.has(name)) references.set(name, []);
      references.get(name).push(relative);
    }
  }
  return [...references]
    .map(([workflow, referenceFiles]) => ({ workflow, referenceFiles: [...new Set(referenceFiles)].sort() }))
    .sort((a, b) => a.workflow.localeCompare(b.workflow));
}

export function validateRegistry(
  manifest,
  { root = DEFAULT_ROOT, liveOrigins = null, workflowProviders = null, matrixSource = null } = {},
) {
  const errors = [];
  if (manifest.schemaVersion !== 2) fail(errors, "schemaVersion must be exactly 2");
  if (manifest.generatedAtCommit !== undefined) fail(errors, "generatedAtCommit is forbidden: it makes registry diffs nondeterministic");
  if (manifest.expectedExecutableSuites !== 22 || manifest.expectedSuites !== 22) {
    fail(errors, "expectedExecutableSuites and compatibility expectedSuites must both equal the amended lock 22");
  }
  if (!Array.isArray(manifest.classes) || manifest.classes.length === 0 || new Set(manifest.classes).size !== manifest.classes.length) {
    fail(errors, "classes must be a non-empty unique array");
  }
  if (!manifest.setupProfiles || typeof manifest.setupProfiles !== "object" || Array.isArray(manifest.setupProfiles)) {
    fail(errors, "setupProfiles must be an object");
  }
  if (!Array.isArray(manifest.suites) || manifest.suites.length !== 22) fail(errors, "suites must contain exactly 22 entries");

  const suiteIds = new Set();
  const suiteOrigins = new Set();
  for (const suite of manifest.suites || []) {
    if (!suite.id || suiteIds.has(suite.id)) fail(errors, `duplicate or empty suite id: ${suite.id || "<empty>"}`);
    suiteIds.add(suite.id);
    if (suite.lifecycle !== "batched-active") fail(errors, `${suite.id}: lifecycle must be batched-active`);
    if (!manifest.classes?.includes(suite.class)) fail(errors, `${suite.id}: unknown class ${suite.class}`);
    if (!suite.setupProfile || !manifest.setupProfiles?.[suite.setupProfile]) fail(errors, `${suite.id}: unknown setupProfile ${suite.setupProfile}`);
    if (manifest.setupProfiles?.[suite.setupProfile]?.classes?.includes(suite.class) !== true) {
      fail(errors, `${suite.id}: setupProfile ${suite.setupProfile} does not route class ${suite.class}`);
    }
    if (suiteOrigins.has(suite.origin)) fail(errors, `${suite.id}: duplicate executable origin ${suite.origin}`);
    suiteOrigins.add(suite.origin);
    if (fs.existsSync(path.join(root, suite.origin || ""))) fail(errors, `${suite.id}: origin is live and batched (duplicate provider): ${suite.origin}`);
    if (suite.runtime?.name !== "node" || suite.runtime?.version !== "20") fail(errors, `${suite.id}: runtime must pin node 20`);
    if (!suite.ownerIssue || !/^#\d+$/.test(suite.ownerIssue)) fail(errors, `${suite.id}: ownerIssue must be an issue token`);
    if (!suite.cwd || !fs.existsSync(path.join(root, suite.cwd))) fail(errors, `${suite.id}: cwd does not exist: ${suite.cwd}`);
    if (!Number.isInteger(suite.timeoutMinutes) || suite.timeoutMinutes < 1) fail(errors, `${suite.id}: invalid timeoutMinutes`);
    if (!suite.isolation?.trim()) fail(errors, `${suite.id}: isolation contract is missing`);
    if (!suite.requiredContext?.trim()) fail(errors, `${suite.id}: requiredContext classification is missing`);
    if (!suite.exceptionRationale?.includes("Raw shell")) fail(errors, `${suite.id}: suite raw-shell exception is missing`);
    if (!suite.timingSeconds || !("p50" in suite.timingSeconds) || !("p95" in suite.timingSeconds)) fail(errors, `${suite.id}: p50/p95 timing classification is missing`);
    for (const key of ["envNames", "expectedFiles", "originPaths", "externalReferenceFiles", "generatedPaths"]) {
      if (!strings(suite[key])) fail(errors, `${suite.id}: ${key} must be a string array`);
    }
    if (suite.expectedFiles?.length === 0) fail(errors, `${suite.id}: expectedFiles cannot be empty`);
    for (const expected of suite.expectedFiles || []) {
      if (!fs.existsSync(path.join(root, expected))) fail(errors, `${suite.id}: expected file is missing: ${expected}`);
    }
    if (!Array.isArray(suite.steps) || suite.steps.length === 0) fail(errors, `${suite.id}: missing execution steps`);
    for (const [index, step] of (suite.steps || []).entries()) {
      if (!step.run?.trim()) fail(errors, `${suite.id}: step ${index} has an empty compatibility command`);
      const invocation = step.invocation;
      if (invocation?.kind !== "raw-shell" || invocation.command !== "bash" || !strings(invocation.argv) || invocation.argv.length !== 2 || invocation.argv[0] !== "-c" || invocation.argv[1] !== step.run) {
        fail(errors, `${suite.id}: step ${index} typed invocation must be bash [-c, exact legacy command]`);
      }
      if (!step.exceptionRationale?.includes("legacy workflow")) fail(errors, `${suite.id}: step ${index} raw-shell exception is not explicit`);
    }
  }

  const resolvedMatrixSource = matrixSource ?? fs.readFileSync(path.join(root, ".github/workflows/ci-batch.yml"), "utf8");
  const matrixClasses = new Set([...resolvedMatrixSource.matchAll(/- class:\s*(\S+)/g)].map((match) => match[1]));
  for (const klass of manifest.classes || []) {
    if (!matrixClasses.has(klass)) fail(errors, `class ${klass} has no ci-batch matrix route`);
  }
  for (const klass of matrixClasses) {
    if (!manifest.classes?.includes(klass)) fail(errors, `ci-batch matrix class ${klass} is absent from registry`);
  }

  const legacy = manifest.legacyOrigins || [];
  if (!Array.isArray(legacy) || legacy.length !== 198) fail(errors, "legacyOrigins must contain exactly the amended 198 origins");
  const legacyKeys = new Set();
  for (const item of legacy) {
    const key = `${item.stem}.${item.extension}`;
    if (!item.stem || !["yml", "yaml"].includes(item.extension)) fail(errors, `invalid legacy origin identity: ${key}`);
    if (legacyKeys.has(key)) fail(errors, `duplicate legacy origin: ${key}`);
    legacyKeys.add(key);
    if (!ALLOWED_DISPOSITIONS.has(item.disposition)) fail(errors, `${key}: unknown disposition ${item.disposition}`);
    if (!item.ownerIssue || !/^#\d+$/.test(item.ownerIssue)) fail(errors, `${key}: missing ownerIssue`);
    if (!item.rationale?.trim()) fail(errors, `${key}: missing disposition rationale`);
    if (item.disposition === "batched-active" && !suiteIds.has(item.replacementSuite)) fail(errors, `${key}: missing active replacement suite`);
    if (item.disposition !== "batched-active") {
      if (item.providerWorkflow !== `.github/workflows/${key}`) fail(errors, `${key}: live origin must name its sole provider workflow`);
      if (!fs.existsSync(path.join(root, item.providerWorkflow || ""))) fail(errors, `${key}: live provider workflow is missing`);
      const expectedMetadata = inspectWorkflow(root, key);
      if (JSON.stringify(item.workflowMetadata) !== JSON.stringify(expectedMetadata)) fail(errors, `${key}: runtime/setup/trust/trigger inventory drifted`);
    }
  }
  const expectedOriginKeys = new Set(liveOrigins ?? discoverLiveOrigins(root));
  for (const suite of manifest.suites || []) expectedOriginKeys.add(path.basename(suite.origin));
  for (const key of expectedOriginKeys) if (!legacyKeys.has(key)) fail(errors, `origin omitted from registry: ${key}`);
  for (const key of legacyKeys) if (!expectedOriginKeys.has(key)) fail(errors, `stale or invented origin in registry: ${key}`);

  const discoveredProviders = workflowProviders ?? discoverWorkflowProviders(root);
  const registeredProviders = manifest.workflowProviders || [];
  if (!Array.isArray(registeredProviders) || registeredProviders.length !== 89) fail(errors, "workflowProviders must contain exactly the amended 89 providers");
  const providerKeys = new Set();
  const registeredByName = new Map();
  for (const item of registeredProviders) {
    if (!item.workflow || providerKeys.has(item.workflow)) fail(errors, `duplicate or empty workflow provider: ${item.workflow || "<empty>"}`);
    providerKeys.add(item.workflow);
    registeredByName.set(item.workflow, item);
    if (item.transition !== "retained-live-provider") fail(errors, `${item.workflow}: transition must preserve the live provider in Phase 1`);
    if (!strings(item.referenceFiles) || item.referenceFiles.length === 0) fail(errors, `${item.workflow}: referenceFiles must be non-empty`);
    for (const ref of item.referenceFiles || []) if (!fs.existsSync(path.join(root, ref))) fail(errors, `${item.workflow}: stale reference file ${ref}`);
  }
  for (const discovered of discoveredProviders) {
    const registered = registeredByName.get(discovered.workflow);
    if (!registered) fail(errors, `externally referenced workflow provider omitted: ${discovered.workflow}`);
    else if (JSON.stringify(registered.referenceFiles) !== JSON.stringify(discovered.referenceFiles)) {
      fail(errors, `${discovered.workflow}: external reference file inventory drifted`);
    }
  }
  for (const name of providerKeys) {
    if (!discoveredProviders.some((item) => item.workflow === name)) fail(errors, `stale external provider registration: ${name}`);
  }

  return errors;
}

export function loadAndValidate(manifestPath = DEFAULT_MANIFEST, options = {}) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return { manifest, errors: validateRegistry(manifest, options) };
}

function main() {
  const manifestPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_MANIFEST;
  const { errors } = loadAndValidate(manifestPath);
  if (errors.length) {
    for (const error of errors) console.error(`::error::${error}`);
    console.error(`#2435 registry v2: FAIL (${errors.length} error(s))`);
    process.exit(1);
  }
  console.log("#2435 registry v2: PASS — 198 origins, 22 executable suites, 89 external providers");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
