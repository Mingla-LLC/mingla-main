#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — ORCH-1079 [Business-venue Google→Mapbox sweep]
 * INV-3 · I-MAPBOX-SUGGEST-NO-TYPES-FILTER
 *
 * The Mapbox Search Box /suggest call in mapbox-geocode MUST stay filter-free.
 * Adding a `types` parameter (e.g. types=address) would exclude POIs and regress
 * venue-name search — the whole point of the sweep is that a brand can search a
 * venue/business BY NAME. Default types = ALL (POI included):
 *   https://docs.mapbox.com/api/search/search-box/#get-suggestions
 *
 * Target: supabase/functions/mapbox-geocode/index.ts
 *
 * FORBID a `types` filter on the suggest request. Detectors (any → FAIL):
 *   - /\btypes\s*[=:]\s*["'`]?(address|poi|place|category)/
 *   - /searchParams\.(set|append)\(\s*["']types["']/
 *   - /[?&]types=/
 *
 * Pass condition: none of the above appear in the file.
 *
 * Exit codes: 0 pass · 1 fail · 2 fs error
 * Self-test mode (--self-test) validates the detectors against fixtures.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const TARGET = path.join(
  REPO_ROOT,
  "supabase",
  "functions",
  "mapbox-geocode",
  "index.ts",
);

const TYPES_FILTER_RES = [
  /\btypes\s*[=:]\s*["'`]?(address|poi|place|category)/,
  /searchParams\.(set|append)\(\s*["']types["']/,
  /[?&]types=/,
];

let failures = 0;
function fail(check, msg) {
  failures += 1;
  console.error(`FAIL [${check}] ${msg}`);
}
function ok(check, msg) {
  console.log(`OK   [${check}] ${msg}`);
}

function readSource(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (e) {
    console.error(`fs error reading ${filePath}: ${e.message}`);
    process.exit(2);
  }
}

function hasTypesFilter(src) {
  return TYPES_FILTER_RES.some((re) => re.test(src));
}

function runSelfTest() {
  let selfFail = 0;
  const goodCall =
    `\`\${MAPBOX_SEARCHBOX_BASE}/suggest?q=\${q}&session_token=\${t}&access_token=\${k}&limit=5\``;
  const badQuery = `const url = base + "/suggest?q=" + q + "&types=address&limit=5";`;
  const badSet = `url.searchParams.set("types", "poi");`;
  const badInline = `const u = "/suggest?types=poi&q=" + q;`;
  if (hasTypesFilter(goodCall)) {
    console.error("SELF-TEST FAIL: filter-free suggest call false-positive");
    selfFail++;
  }
  if (!hasTypesFilter(badQuery)) {
    console.error("SELF-TEST FAIL: &types=address not flagged");
    selfFail++;
  }
  if (!hasTypesFilter(badSet)) {
    console.error("SELF-TEST FAIL: searchParams.set('types') not flagged");
    selfFail++;
  }
  if (!hasTypesFilter(badInline)) {
    console.error("SELF-TEST FAIL: ?types=poi not flagged");
    selfFail++;
  }
  if (selfFail > 0) {
    console.error(`SELF-TEST: ${selfFail} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-MAPBOX-SUGGEST-NO-TYPES-FILTER detectors behave");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
}

if (!fs.existsSync(TARGET)) {
  fail("INV-3: target-present", `mapbox-geocode/index.ts missing at ${path.relative(REPO_ROOT, TARGET)}`);
  process.exit(failures > 0 ? 1 : 0);
}

const src = readSource(TARGET);
if (hasTypesFilter(src)) {
  fail(
    "INV-3: no-types-filter",
    "mapbox-geocode/index.ts adds a `types` filter to the suggest call — this excludes POIs and regresses venue-name search (ORCH-1079 §2.2)",
  );
} else {
  ok(
    "INV-3: no-types-filter",
    "mapbox-geocode suggest call is filter-free (POIs resolve by name)",
  );
}

process.exit(failures > 0 ? 1 : 0);
