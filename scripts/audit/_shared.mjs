#!/usr/bin/env node
/**
 * Shared helpers for #426 production-readiness audit scripts.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const REPO_ROOT = join(__dirname, "..", "..");

export const EXIT = {
  OK: 0,
  VIOLATION: 1,
  ERROR: 2,
};

export function walkFiles(dir, { extensions, skipDirNames = new Set() } = {}) {
  const out = [];
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    return out;
  }
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (skipDirNames.has(entry)) continue;
      out.push(...walkFiles(full, { extensions, skipDirNames }));
      continue;
    }
    if (!extensions || extensions.some((ext) => full.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

export function rel(path) {
  return relative(REPO_ROOT, path).split(sep).join("/");
}

export function readText(path) {
  return readFileSync(path, "utf8");
}

export function listMigrationSqlFiles() {
  const dir = join(REPO_ROOT, "supabase", "migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(dir, f));
}

export function parseArgs(argv) {
  return {
    selfTest: argv.includes("--self-test"),
    warnOnly: argv.includes("--warn-only"),
  };
}

export function reportViolations(title, violations) {
  if (violations.length === 0) {
    console.log(`PASS: ${title}`);
    return EXIT.OK;
  }
  console.error(`FAIL: ${title} (${violations.length} violation(s))`);
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  return EXIT.VIOLATION;
}
