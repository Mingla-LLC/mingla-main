#!/usr/bin/env node
/**
 * ORCH-0816 strict-grep gate — "Last 7 days" KPI tile binds to `stats.rev7d`.
 *
 * Background: prior to ORCH-0816 the home-screen tile labelled "Last 7 days"
 * was bound to `currentBrand.stats.rev`, which is the brand's LIFETIME GMV.
 * The label and the data disagreed for the entire life of the home screen.
 * This gate prevents the binding from ever silently regressing to the
 * lifetime field again.
 *
 * Three checks (all must pass; any failure exits non-zero):
 *
 *   1. `mingla-business/app/(tabs)/home.tsx` exists and contains a KpiTile
 *      with `label="Last 7 days"`.
 *   2. The same JSX block references `stats.rev7d`.
 *   3. The same JSX block does NOT reference `stats.rev` without the `7d`
 *      suffix (i.e., bare lifetime field).
 *
 * Codified by ORCH-0816 SPEC §9.3.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const HOME_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "app",
  "(tabs)",
  "home.tsx",
);

const failures = [];

const readOrEmpty = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

if (!existsSync(HOME_PATH)) {
  failures.push(
    "Check 1 FAIL: mingla-business/app/(tabs)/home.tsx is missing",
  );
} else {
  const src = readOrEmpty(HOME_PATH);

  // Find every KpiTile JSX block that contains label="Last 7 days".
  // Greedy until the closing `/>` (KpiTile is always self-closing in this
  // file). The regex deliberately spans newlines.
  const tileRegex = /<KpiTile\b[\s\S]*?label="Last 7 days"[\s\S]*?\/>/g;
  const tiles = src.match(tileRegex);

  if (tiles === null || tiles.length === 0) {
    failures.push(
      'Check 1 FAIL: home.tsx contains no KpiTile with label="Last 7 days"',
    );
  } else {
    for (const tile of tiles) {
      // Check 2 — must reference stats.rev7d.
      if (!/stats\.rev7d\b/.test(tile)) {
        failures.push(
          'Check 2 FAIL: a KpiTile labelled "Last 7 days" does not reference `stats.rev7d` — windowed field is the only legal binding',
        );
      }
      // Check 3 — must NOT reference bare stats.rev (lifetime field).
      // The regex uses a negative lookahead to allow `stats.rev7d` but
      // forbid `stats.rev` followed by any non-identifier char.
      if (/stats\.rev(?![a-zA-Z0-9_])/.test(tile)) {
        failures.push(
          'Check 3 FAIL: a KpiTile labelled "Last 7 days" references `stats.rev` (lifetime field) — must use `stats.rev7d`',
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error("ORCH-0816 strict-grep FAIL:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("ORCH-0816 strict-grep PASS — Last-7-days tile binds rev7d.");
