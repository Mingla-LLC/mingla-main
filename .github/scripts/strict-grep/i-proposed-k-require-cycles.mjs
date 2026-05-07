#!/usr/bin/env node
/**
 * I-PROPOSED-K strict-grep gate — REQUIRE-CYCLES-BASELINED.
 *
 * Detects circular dependencies in mingla-business via madge and compares
 * against the checked-in baseline. New cycles fail CI; removed cycles warn.
 *
 * Per META-ORCH-0744-PROCESS / SPEC §3.1.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");
const BUSINESS_ROOT = join(REPO_ROOT, "mingla-business");
const BASELINE_PATH = join(BUSINESS_ROOT, ".metro-cycle-baseline.txt");
const TARGET_DIRS = ["src/", "app/"];
const TARGET_EXTENSIONS = "ts,tsx";
const NPX_CANDIDATES = ["npx", "/opt/homebrew/bin/npx", "/usr/local/bin/npx"];

function normalizeCycle(cycleLine) {
  const stripped = cycleLine.replace(/^\d+\)\s*/, "").trim();
  const separator = stripped.includes(" | ") ? " | " : " > ";
  return stripped
    .split(separator)
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()
    .join(" | ");
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    console.error(
      `[I-PROPOSED-K] SCRIPT ERROR — baseline file missing: ${relative(REPO_ROOT, BASELINE_PATH)}`,
    );
    console.error(
      "Fix: create mingla-business/.metro-cycle-baseline.txt from the current madge cycle list before enabling this gate.",
    );
    process.exit(2);
  }

  return new Set(
    readFileSync(BASELINE_PATH, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map(normalizeCycle),
  );
}

function runMadge() {
  const args = [
    "--yes",
    "madge",
    "--circular",
    "--extensions",
    TARGET_EXTENSIONS,
    ...TARGET_DIRS,
  ];

  const failures = [];
  for (const npxBin of NPX_CANDIDATES) {
    try {
      return execFileSync(npxBin, args, {
        cwd: BUSINESS_ROOT,
        env: {
          ...process.env,
          PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}`,
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      if (error.stdout) {
        return error.stdout.toString();
      }
      failures.push(`${npxBin}: ${error.message}`);
    }
  }

  console.error("[I-PROPOSED-K] SCRIPT ERROR — madge invocation failed:");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(2);
}

function parseCycles(output) {
  return output
    .split("\n")
    .filter((line) => /^\d+\)\s+\S+/.test(line))
    .map(normalizeCycle)
    .filter(Boolean);
}

const baseline = readBaseline();
const liveCycles = new Set(parseCycles(runMadge()));
const newCycles = [...liveCycles].filter((cycle) => !baseline.has(cycle));
const removedCycles = [...baseline].filter((cycle) => !liveCycles.has(cycle));

if (newCycles.length > 0) {
  console.error(
    `[I-PROPOSED-K] FAIL — ${newCycles.length} NEW require-cycle(s) detected vs baseline:`,
  );
  for (const cycle of newCycles) {
    console.error(`  - ${cycle}`);
  }
  console.error(
    "\nFix: break the cycle, or update mingla-business/.metro-cycle-baseline.txt in the same PR with review rationale.",
  );
  process.exit(1);
}

if (removedCycles.length > 0) {
  console.warn(
    `[I-PROPOSED-K] WARN — ${removedCycles.length} baseline cycle(s) no longer exist. Remove stale baseline entries:`,
  );
  for (const cycle of removedCycles) {
    console.warn(`  - ${cycle}`);
  }
}

console.log(
  `[I-PROPOSED-K] PASS — ${liveCycles.size} cycle(s) match baseline. Zero new cycles introduced.`,
);
process.exit(0);
