#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * META-ORCH-0972 — active product code must not branch on brands.kind.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, "..", "..", "..");

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx === -1 ? null : process.argv[idx + 1] ?? null;
}

const REPO_ROOT = path.resolve(argValue("--root") ?? DEFAULT_ROOT);

const SCAN_ROOTS = [
  path.join("mingla-business", "src"),
  path.join("mingla-business", "app"),
  path.join("mingla-admin", "src"),
  path.join("supabase", "functions"),
];
const EXACT_ALLOWLIST = new Set([
  path.join("mingla-business", "src", "types", "brand.ts"),
]);
const FORBIDDEN_KIND_READS = ["brand.kind", "brands.kind", "currentBrand.kind"];
const AUTHORING_PATH_HINT =
  /Drafts|Service|tripsService|eventDrafts|experienceCreator|brandAuthoringGate/i;
const VERIFIED_CLAIM_RETURN = /if\s*\([^)\n]*claim_status[^)\n]*!==[^)\n]*['"]verified['"][^)\n]*\)\s*return\b/;
const REQUIRED_ZERO_KIND_FILES = [
  path.join("supabase", "functions", "_shared", "agentTools.ts"),
  path.join("supabase", "functions", "parse-restaurant-menu", "index.ts"),
  path.join("supabase", "functions", "parse-play-activities", "index.ts"),
];

const failures = [];

function toRel(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join(path.posix.sep);
}

function shouldSkipDir(name) {
  return name === "node_modules" ||
    name === ".git" ||
    name === ".expo" ||
    name === "dist" ||
    name === "build" ||
    name === "web-build";
}

function isSourceFile(file) {
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file);
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (shouldSkipDir(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile() && isSourceFile(full)) {
      out.push(full);
    }
  }
  return out;
}

function scanForKindReads(file, source, labels) {
  const rel = toRel(file);
  if (EXACT_ALLOWLIST.has(rel)) return;
  for (const needle of FORBIDDEN_KIND_READS) {
    if (source.includes(needle)) {
      failures.push(`${labels}: ${rel} contains forbidden ${JSON.stringify(needle)}`);
    }
  }
}

for (const root of SCAN_ROOTS.map((rel) => path.join(REPO_ROOT, rel))) {
  for (const file of walk(root)) {
    const source = fs.readFileSync(file, "utf8");
    scanForKindReads(file, source, "N1");
    if (AUTHORING_PATH_HINT.test(toRel(file)) && VERIFIED_CLAIM_RETURN.test(source)) {
      failures.push(`N4: ${toRel(file)} contains a verified-claim early return`);
    }
  }
}

for (const relPath of REQUIRED_ZERO_KIND_FILES) {
  const file = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, "utf8");
  for (const needle of FORBIDDEN_KIND_READS) {
    if (source.includes(needle)) {
      failures.push(`N3: ${relPath} contains forbidden ${JSON.stringify(needle)}`);
    }
  }
}

if (failures.length > 0) {
  console.error("META-ORCH-0972 no-brand-kind-reads strict-grep failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("META-ORCH-0972 no-brand-kind-reads strict-grep passed (N1-N4).");
