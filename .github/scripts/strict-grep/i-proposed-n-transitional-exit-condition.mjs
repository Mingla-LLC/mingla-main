#!/usr/bin/env node
/**
 * I-PROPOSED-N strict-grep gate — TRANSITIONAL-EXIT-CONDITIONED.
 *
 * Verifies every [TRANSITIONAL] marker in mingla-business/src/ + app/ has an
 * exit-condition keyword within 5 lines. Known legacy violators are baselined;
 * new violators fail CI.
 *
 * Per META-ORCH-0744-PROCESS / SPEC §3.4.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");
const TARGET_ROOTS = [
  join(REPO_ROOT, "mingla-business", "src"),
  join(REPO_ROOT, "mingla-business", "app"),
];
const BASELINE_PATH = join(REPO_ROOT, "Mingla_Artifacts", ".transitional-baseline.txt");
const FILE_EXTENSIONS = [".ts", ".tsx"];
const TRANSITIONAL_PATTERN = /\[TRANSITIONAL\]/;
const EXIT_KEYWORDS = [
  /\bEXIT\b/i,
  /exits when/i,
  /exit condition/i,
  /\bCycle\s+[0-9A-Z]+/,
  /\bB-cycle\b/i,
  /\bB[0-9]+\b/,
  /\bORCH-[0-9]{4}/,
];

function rel(path) {
  return relative(REPO_ROOT, path).split(sep).join("/");
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__" || entry === "__snapshots__") {
        continue;
      }
      yield* walk(path);
    } else if (FILE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      yield path;
    }
  }
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return new Set();
  return new Set(
    readFileSync(BASELINE_PATH, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );
}

function findViolations() {
  const violations = [];
  for (const root of TARGET_ROOTS) {
    for (const file of walk(root)) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        if (!TRANSITIONAL_PATTERN.test(lines[index])) continue;
        const window = lines
          .slice(index, Math.min(index + 6, lines.length))
          .join("\n");
        if (EXIT_KEYWORDS.some((pattern) => pattern.test(window))) continue;
        violations.push({
          file: rel(file),
          line: index + 1,
          text: lines[index].trim().slice(0, 140),
        });
      }
    }
  }
  return violations;
}

const baseline = readBaseline();
const violations = findViolations();
const newViolations = violations.filter(
  (violation) => !baseline.has(`${violation.file}:${violation.line}`),
);
const liveViolationKeys = new Set(
  violations.map((violation) => `${violation.file}:${violation.line}`),
);
const staleBaselineEntries = [...baseline].filter((entry) => !liveViolationKeys.has(entry));

if (violations.length > 0) {
  console.warn(
    `[I-PROPOSED-N] WARN — ${violations.length} TRANSITIONAL marker(s) without exit-condition keyword in 5-line window:`,
  );
  for (const violation of violations) {
    const key = `${violation.file}:${violation.line}`;
    const tag = baseline.has(key) ? "BASELINE" : "NEW";
    console.warn(`  [${tag}] ${key} — ${violation.text}`);
  }
}

if (staleBaselineEntries.length > 0) {
  console.warn(
    `[I-PROPOSED-N] WARN — ${staleBaselineEntries.length} baseline entrie(s) no longer match live violations:`,
  );
  for (const entry of staleBaselineEntries) {
    console.warn(`  - ${entry}`);
  }
  console.warn("Fix: remove stale entries from Mingla_Artifacts/.transitional-baseline.txt.");
}

if (newViolations.length > 0) {
  console.error(
    `\n[I-PROPOSED-N] FAIL — ${newViolations.length} NEW TRANSITIONAL marker(s) added without exit-condition keyword:`,
  );
  for (const violation of newViolations) {
    console.error(`  - ${violation.file}:${violation.line} — ${violation.text}`);
  }
  console.error(
    "\nFix: add an exit keyword within 5 lines: EXIT, exits when, exit condition, Cycle X, B-cycle, B<N>, or ORCH-NNNN.",
  );
  process.exit(1);
}

if (violations.length === 0) {
  console.log("[I-PROPOSED-N] PASS — zero TRANSITIONAL markers without exit-condition.");
} else {
  console.log(
    `[I-PROPOSED-N] PASS-with-baseline — ${violations.length} known violator(s); zero new ones added.`,
  );
}
process.exit(0);
