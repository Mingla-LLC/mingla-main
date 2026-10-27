#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../../..");
export const BOOTSTRAP_PATH = path.join(HERE, "MANIFEST.json");
// #3643 Phase 3D: re-sealed after the #2198 and #2418 gates' enforcement moved
// from their deleted per-issue workflows to the CI batch suites that now run them.
export const BOOTSTRAP_SHA256 = "0b5f222c73e323eafa031f3f5da11c8bceb237763b765262c7c277e9f992e956";
export const DESCRIPTOR_SUFFIX = ".gate.json";

function fail(code, detail = "") {
  throw new Error(`strict-grep:effective-registry:${code}${detail ? `:${detail}` : ""}`);
}
function walkMjs(root, relative = "") {
  const absolute = path.join(root, relative);
  const files = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.posix.join(relative.split(path.sep).join(path.posix.sep), entry.name);
    if (entry.isDirectory()) files.push(...walkMjs(root, child));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(child);
  }
  return files;
}

export function loadBootstrap({ manifestPath = BOOTSTRAP_PATH, expectedSha = BOOTSTRAP_SHA256 } = {}) {
  const raw = fs.readFileSync(manifestPath);
  const actual = crypto.createHash("sha256").update(raw).digest("hex");
  if (actual !== expectedSha) fail("bootstrap_seal_mismatch", `${actual}:expected=${expectedSha}`);
  return JSON.parse(raw.toString("utf8"));
}

function localGate({ root, relativeScript, bootstrapScripts }) {
  const script = `.github/scripts/strict-grep/${relativeScript}`;
  if (bootstrapScripts.has(script)) return null;
  const descriptorPath = `${path.join(root, script)}${DESCRIPTOR_SUFFIX}`;
  if (!fs.existsSync(descriptorPath)) fail("undeclared_gate", script);
  let declaration;
  try {
    declaration = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
  } catch (error) {
    fail("malformed_descriptor", `${script}:${error.message}`);
  }
  if (!declaration || declaration.schemaVersion !== 1 || declaration.kind !== "strict-grep-gate") {
    fail("malformed_descriptor", script);
  }
  const gate = declaration.gate;
  if (!gate || !["file", "inline"].includes(gate.kind) ||
      typeof gate.enforcement !== "string" || typeof gate.invocation !== "string" ||
      !Array.isArray(gate.modes) || gate.modes.length === 0 ||
      !gate.modes.every((mode) => ["plain", "self-test"].includes(mode)) ||
      !Array.isArray(gate.jobKeys) || typeof gate.selfTest !== "string") {
    fail("malformed_gate", script);
  }
  const encoded = JSON.stringify(declaration);
  if (/\.github\/workflows\/[^"']+\.ya?ml/.test(encoded)) fail("workflow_name_forbidden", script);
  return { script, ...gate, localDescriptor: path.relative(root, descriptorPath).split(path.sep).join(path.posix.sep) };
}

export function loadEffectiveManifest({
  root = ROOT,
  manifestPath = BOOTSTRAP_PATH,
  expectedSha = BOOTSTRAP_SHA256,
  discover = manifestPath === BOOTSTRAP_PATH,
} = {}) {
  if (!discover) return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const bootstrap = loadBootstrap({ manifestPath, expectedSha });
  const bootstrapScripts = new Set(bootstrap.gates.map((gate) => gate.script));
  const strictRoot = path.join(root, ".github/scripts/strict-grep");
  const disk = walkMjs(strictRoot);
  const locals = disk.map((relative) => localGate({ root, relativeScript: relative, bootstrapScripts })).filter(Boolean);
  const scripts = new Set(bootstrapScripts);
  for (const gate of locals) {
    if (scripts.has(gate.script)) fail("duplicate_gate", gate.script);
    scripts.add(gate.script);
  }
  const descriptorFiles = [];
  const collectDescriptors = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) collectDescriptors(child);
      else if (entry.name.endsWith(DESCRIPTOR_SUFFIX)) descriptorFiles.push(child);
    }
  };
  collectDescriptors(strictRoot);
  for (const descriptor of descriptorFiles) {
    const script = descriptor.slice(0, -DESCRIPTOR_SUFFIX.length);
    if (!fs.existsSync(script)) fail("stale_descriptor", path.relative(root, descriptor));
    const relativeScript = path.relative(root, script).split(path.sep).join(path.posix.sep);
    if (bootstrapScripts.has(relativeScript)) fail("bootstrap_shadow", relativeScript);
  }
  const localWired = locals.filter((gate) => gate.selfTest === "wired").length;
  return {
    ...bootstrap,
    expectedStrictGrepMjsFiles: bootstrap.expectedStrictGrepMjsFiles + locals.length,
    selfTestWiredFloor: bootstrap.selfTestWiredFloor + localWired,
    gates: [...bootstrap.gates, ...locals.sort((a, b) => a.script.localeCompare(b.script))],
  };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const manifest = loadEffectiveManifest();
  console.log(`PASS strict-grep effective registry (${manifest.gates.length} gates)`);
}
