#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — META-ORCH-1060 [Mapbox consumer migration]
 * INV-3 · I-DISCOVER-CITY-CODES-FROM-MAPBOX-CONTEXT
 *
 * The Discover city picker must source discover_city_state_code /
 * discover_city_country_code from the STRUCTURED Mapbox PlaceDetails fields
 * (`details.regionCode` / `details.countryCode`), never from a display-string
 * parse. The old display-string heuristics are deleted permanently.
 *
 * FORBID anywhere under app-mobile/src:
 *   - the identifier `parseStateCountry`
 *   - a `.split(",")[0]` (or single-quote variant) used to derive a city token
 *     INSIDE CityPickerSheet.tsx (the discover_city_name derivation).
 *
 * REQUIRE in app-mobile/src/components/discover/CityPickerSheet.tsx:
 *   - discover_city_state_code   sourced from a `.regionCode` field
 *   - discover_city_country_code sourced from a `.countryCode` field
 *
 * Pass condition: forbidden parse identifiers absent AND structured-field
 * assignment present.
 *
 * Exit codes: 0 pass · 1 fail · 2 fs error
 * Self-test mode (--self-test) validates the detector against fixtures.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const SCAN_ROOT = path.join(REPO_ROOT, "app-mobile", "src");
const CITY_PICKER = path.join(
  REPO_ROOT,
  "app-mobile",
  "src",
  "components",
  "discover",
  "CityPickerSheet.tsx",
);

const PARSE_IDENT_RE = /\bparseStateCountry\b/;
const SPLIT_CITY_RE = /\.split\(\s*["']\s*,\s*["']\s*\)\s*\[\s*0\s*\]/;
// REQUIRE: structured-field assignments in the write mapping.
const STATE_FROM_STRUCTURED_RE =
  /discover_city_state_code\s*:\s*[^,\n]*\.regionCode/;
const COUNTRY_FROM_STRUCTURED_RE =
  /discover_city_country_code\s*:\s*[^,\n]*\.countryCode/;

let failures = 0;
function fail(check, msg) {
  failures += 1;
  console.error(`FAIL [${check}] ${msg}`);
}
function ok(check, msg) {
  console.log(`OK   [${check}] ${msg}`);
}

function walk(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    console.error(`fs error reading ${dir}: ${e.message}`);
    process.exit(2);
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "__snapshots__") continue;
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(ent.name)) {
      acc.push(full);
    }
  }
}

function runSelfTest() {
  let selfFail = 0;
  const struct = `{ stateCode } = parseStateCountry(suggestion.fullAddress);`;
  const split = `const seg = suggestion.displayName.split(",")[0]?.trim();`;
  const good = `discover_city_state_code: city.stateCode,`;
  const goodWrite = `discover_city_state_code: details.regionCode,`;
  const goodCountry = `discover_city_country_code: details.countryCode,`;
  if (!PARSE_IDENT_RE.test(struct)) {
    console.error("SELF-TEST FAIL: parseStateCountry not flagged");
    selfFail++;
  }
  if (!SPLIT_CITY_RE.test(split)) {
    console.error("SELF-TEST FAIL: split(',')[0] not flagged");
    selfFail++;
  }
  if (PARSE_IDENT_RE.test(good) || SPLIT_CITY_RE.test(good)) {
    console.error("SELF-TEST FAIL: clean assignment wrongly flagged");
    selfFail++;
  }
  if (!STATE_FROM_STRUCTURED_RE.test(goodWrite)) {
    console.error("SELF-TEST FAIL: structured state assignment not detected");
    selfFail++;
  }
  if (!COUNTRY_FROM_STRUCTURED_RE.test(goodCountry)) {
    console.error("SELF-TEST FAIL: structured country assignment not detected");
    selfFail++;
  }
  if (selfFail > 0) {
    console.error(`SELF-TEST: ${selfFail} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-DISCOVER-CITY-CODES-FROM-MAPBOX-CONTEXT detector behaves");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
}

// 1. FORBID parseStateCountry anywhere under app-mobile/src.
const files = [];
walk(SCAN_ROOT, files);
let parseHits = 0;
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  if (PARSE_IDENT_RE.test(text)) {
    parseHits += 1;
    fail(
      "INV-3: parseStateCountry-deleted",
      `${path.relative(REPO_ROOT, file)} still references parseStateCountry`,
    );
  }
}
if (parseHits === 0) {
  ok("INV-3: parseStateCountry-deleted", "no parseStateCountry references under app-mobile/src");
}

// 2. CityPickerSheet: forbid split(",")[0] city derivation + require structured codes.
if (!fs.existsSync(CITY_PICKER)) {
  fail("INV-3: city-picker-present", `CityPickerSheet.tsx missing at ${path.relative(REPO_ROOT, CITY_PICKER)}`);
} else {
  const src = fs.readFileSync(CITY_PICKER, "utf8");
  if (SPLIT_CITY_RE.test(src)) {
    fail(
      "INV-3: no-split-city-derivation",
      "CityPickerSheet.tsx still derives a city token via split(',')[0]",
    );
  } else {
    ok("INV-3: no-split-city-derivation", "CityPickerSheet.tsx has no split(',')[0] city derivation");
  }
  if (STATE_FROM_STRUCTURED_RE.test(src)) {
    ok("INV-3: state-from-structured", "discover_city_state_code sourced from .regionCode");
  } else {
    fail(
      "INV-3: state-from-structured",
      "discover_city_state_code is NOT sourced from a .regionCode field",
    );
  }
  if (COUNTRY_FROM_STRUCTURED_RE.test(src)) {
    ok("INV-3: country-from-structured", "discover_city_country_code sourced from .countryCode");
  } else {
    fail(
      "INV-3: country-from-structured",
      "discover_city_country_code is NOT sourced from a .countryCode field",
    );
  }
}

process.exit(failures > 0 ? 1 : 0);
