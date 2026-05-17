#!/usr/bin/env node
/**
 * I-PROPOSED-BRAND-DELETE-BLOCKING-DATE-AWARE strict-grep gate (ORCH-0862).
 *
 * Asserts that every brand-delete blocker count query filters past-dated
 * events out by joining `event_dates` and checking `end_at > now()`. Without
 * the date filter, brands with stale `status='scheduled'` rows whose
 * `event_dates.end_at` is in the past wrongly block delete forever — this
 * was DISCOVERY-7 in ORCH-0862's investigation, proven live on Test Stripe
 * brand 2026-05-17.
 *
 * Scope:
 *   - mingla-business/src/services/brandsService.ts → `softDeleteBrand` Step 1
 *     count query MUST include `event_dates!inner(end_at)` in select AND
 *     `.gt("event_dates.end_at", <nowIso>)` in the chain.
 *   - mingla-business/src/hooks/useBrands.ts → `useBrandCascadePreview`'s
 *     `upcomingResult` and `liveResult` query builders MUST include both.
 *
 * Aligns the delete-blocking semantics with the ORCH-0850
 * [End-not-start parity systemic] canonical lifecycle helper so home and
 * delete agree on what "upcoming" means.
 *
 * Exit codes:
 *   0 — clean
 *   1 — any required filter missing
 *   2 — script error / file system failure
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

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
const HOOK_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "hooks",
  "useBrands.ts",
);

let violations = 0;
const violationDetails = [];

function fail(file, msg) {
  violations += 1;
  violationDetails.push(`${file}: ${msg}`);
}

function loadFile(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    console.error(`FATAL: could not read ${path}: ${err.message}`);
    process.exit(2);
  }
}

// ---- Check 1: softDeleteBrand Step 1 -------------------------------------

const serviceSrc = loadFile(SERVICE_PATH);

// Extract the softDeleteBrand function body (rough boundary: from
// "export async function softDeleteBrand" up to the next "// ----- " block
// header or end of file).
const sdBrandMatch = serviceSrc.match(
  /export\s+async\s+function\s+softDeleteBrand[\s\S]*?(?=^export\s+async\s+function|^export\s+function|^\/\/\s*-----|\Z)/m,
);
if (sdBrandMatch === null) {
  fail(
    "brandsService.ts",
    "could not locate softDeleteBrand function body",
  );
} else {
  const body = sdBrandMatch[0];

  // Find the Step 1 count query — anchored on `.from("events")` + `count: "exact"`.
  const step1Match = body.match(
    /from\("events"\)[\s\S]*?count:\s*"exact"[\s\S]*?\.is\("deleted_at",\s*null\)[^;]*;/,
  );
  if (step1Match === null) {
    fail(
      "brandsService.ts:softDeleteBrand",
      "could not locate Step 1 count query against events table",
    );
  } else {
    const step1 = step1Match[0];
    if (!step1.includes("event_dates!inner")) {
      fail(
        "brandsService.ts:softDeleteBrand Step 1",
        "missing `event_dates!inner` join in select — past-dated ghost events will wrongly block delete (DISCOVERY-7 regression)",
      );
    }
    if (!/\.gt\(\s*"event_dates\.end_at"\s*,/.test(step1)) {
      fail(
        "brandsService.ts:softDeleteBrand Step 1",
        'missing `.gt("event_dates.end_at", <nowIso>)` filter — past-dated ghost events will wrongly block delete (DISCOVERY-7 regression)',
      );
    }
  }
}

// ---- Check 2: useBrandCascadePreview -------------------------------------

const hookSrc = loadFile(HOOK_PATH);

const cascadeMatch = hookSrc.match(
  /export\s+const\s+useBrandCascadePreview[\s\S]*?queryFn\s*:[\s\S]*?(?=^\s*\}\s*\)\s*;\s*\}\s*;)/m,
);
if (cascadeMatch === null) {
  fail(
    "useBrands.ts",
    "could not locate useBrandCascadePreview queryFn",
  );
} else {
  const cascadeBody = cascadeMatch[0];

  // upcomingResult builder — chain off `.eq("status", "scheduled")`.
  const upcomingMatch = cascadeBody.match(
    /\.eq\(\s*"status"\s*,\s*"scheduled"\s*\)[\s\S]*?\.gt\([^)]*\)/,
  );
  if (upcomingMatch === null) {
    fail(
      "useBrands.ts:useBrandCascadePreview",
      'upcomingResult missing `.gt(...)` after `.eq("status","scheduled")` — past-dated scheduled events still count as upcoming, contradicting home screen lifecycle helper (DISCOVERY-7)',
    );
  } else if (
    !/\.gt\(\s*"event_dates\.end_at"\s*,/.test(upcomingMatch[0])
  ) {
    fail(
      "useBrands.ts:useBrandCascadePreview",
      'upcomingResult `.gt(...)` does not target `event_dates.end_at` — verify the date filter is on the correct column',
    );
  }
  if (!cascadeBody.includes("event_dates!inner")) {
    fail(
      "useBrands.ts:useBrandCascadePreview",
      "missing `event_dates!inner` join — required to surface event_dates.end_at for the .gt() filter",
    );
  }

  // liveResult builder — chain off `.eq("status", "live")`.
  const liveMatch = cascadeBody.match(
    /\.eq\(\s*"status"\s*,\s*"live"\s*\)[\s\S]*?\.gt\([^)]*\)/,
  );
  if (liveMatch === null) {
    fail(
      "useBrands.ts:useBrandCascadePreview",
      'liveResult missing `.gt(...)` after `.eq("status","live")` — past-dated live events still count as upcoming (DISCOVERY-7)',
    );
  } else if (!/\.gt\(\s*"event_dates\.end_at"\s*,/.test(liveMatch[0])) {
    fail(
      "useBrands.ts:useBrandCascadePreview",
      "liveResult `.gt(...)` does not target `event_dates.end_at`",
    );
  }
}

// ---- Verdict --------------------------------------------------------------

if (violations === 0) {
  console.log(
    "[i-brand-delete-blocking-date-aware] PASS — softDeleteBrand + useBrandCascadePreview both date-aware (ORCH-0862 / DISCOVERY-7).",
  );
  process.exit(0);
}

console.error(
  `[i-brand-delete-blocking-date-aware] FAIL — ${violations} violation(s):`,
);
for (const detail of violationDetails) {
  console.error(`  - ${detail}`);
}
console.error(
  "\nFix: align the blocking filter with the ORCH-0850 [End-not-start parity systemic] date-aware lifecycle helper. See SPEC_ORCH-0862_DESTRUCTIVE_ACTION_UI_TRUTH_DIVERGENCE.md §5 F-2.",
);
process.exit(1);
