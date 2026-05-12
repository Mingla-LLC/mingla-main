#!/usr/bin/env node
/**
 * ORCH-0810 strict-grep gate — BRAND_STATS_REAL_AGGREGATION.
 *
 * Const #9 (no fabricated data). The Brand Profile KPI tiles (Events,
 * Attendees, GMV) MUST be sourced from real Supabase queries, not
 * hardcoded zero literals shipped to the UI as "all time" stats.
 *
 * Two checks (any failure exits non-zero):
 *
 *   1. `mingla-business/src/services/brandsService.ts` MUST export
 *      `aggregateBrandStatsByBrandIds`, AND both `getBrand` and
 *      `getBrands` MUST invoke it. This guarantees both single and
 *      list fetch paths attach real attendee + GMV figures before
 *      handing the brand record to the UI.
 *   2. The same file MUST NOT re-introduce the literal
 *      `stats: { events: 0, followers: 0, rev: 0, attendees: 0 }` as
 *      the *terminal* return value of a brand fetch. Defaults from
 *      `EMPTY_BRAND_STATS` in `brandMapping.ts` are allowed as a
 *      starting point — but `brandsService.ts` MUST overwrite them.
 *
 * Per ORCH-0810 root-cause fix bundled into PR #86 (2026-05-12).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const SERVICE_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "services",
  "brandsService.ts",
);

const failures = [];

function readOrEmpty(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

if (!existsSync(SERVICE_PATH)) {
  failures.push(
    "Check 1 FAIL: mingla-business/src/services/brandsService.ts missing.",
  );
} else {
  const src = readOrEmpty(SERVICE_PATH);

  // Check 1a — aggregator exists and is exported.
  if (!/export\s+async\s+function\s+aggregateBrandStatsByBrandIds\b/.test(src)) {
    failures.push(
      "Check 1 FAIL: brandsService.ts missing `export async function aggregateBrandStatsByBrandIds` — Const #9 requires real KPI aggregation (attendees + GMV) instead of hardcoded zeros.",
    );
  }

  // Check 1b — getBrands invokes the aggregator.
  const getBrandsMatch = src.match(
    /export\s+async\s+function\s+getBrands\b[\s\S]*?\n\}\n/,
  );
  if (getBrandsMatch === null) {
    failures.push(
      "Check 1 FAIL: brandsService.ts missing `export async function getBrands` body — cannot verify aggregator wiring.",
    );
  } else if (!/aggregateBrandStatsByBrandIds\s*\(/.test(getBrandsMatch[0])) {
    failures.push(
      "Check 1 FAIL: `getBrands` does not call `aggregateBrandStatsByBrandIds` — the brand list MUST attach real attendees + GMV per Const #9.",
    );
  }

  // Check 1c — getBrand invokes the aggregator.
  const getBrandMatch = src.match(
    /export\s+async\s+function\s+getBrand\s*\([^)]*\)[\s\S]*?\n\}\n/,
  );
  if (getBrandMatch === null) {
    failures.push(
      "Check 1 FAIL: brandsService.ts missing `export async function getBrand` body — cannot verify aggregator wiring.",
    );
  } else if (!/aggregateBrandStatsByBrandIds\s*\(/.test(getBrandMatch[0])) {
    failures.push(
      "Check 1 FAIL: `getBrand` does not call `aggregateBrandStatsByBrandIds` — the single-brand fetch MUST attach real attendees + GMV per Const #9.",
    );
  }

  // Check 2 — no terminal zero-stats literal returned to UI from this file.
  const zeroLiteral =
    /stats\s*:\s*\{\s*events\s*:\s*0\s*,\s*followers\s*:\s*0\s*,\s*rev\s*:\s*0\s*,\s*attendees\s*:\s*0\s*\}/;
  if (zeroLiteral.test(src)) {
    failures.push(
      "Check 2 FAIL: brandsService.ts contains the literal `stats: { events: 0, followers: 0, rev: 0, attendees: 0 }` — Const #9 forbids fabricating KPI tiles. Use `aggregateBrandStatsByBrandIds` and merge results into the brand stats object.",
    );
  }
}

if (failures.length > 0) {
  console.error("ORCH-0810 strict-grep FAIL:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("ORCH-0810 strict-grep PASS — brand KPI tiles wired to real aggregator.");
