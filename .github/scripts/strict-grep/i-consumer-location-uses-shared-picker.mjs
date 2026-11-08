#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — META-ORCH-1060 [Mapbox consumer migration]
 * INV-2 · I-CONSUMER-LOCATION-USES-SHARED-MAPBOX
 *
 * The consumer location entry points must go through the shared
 * @mingla/location-input package seam — never a hand-rolled or per-app
 * geocoder, and never a direct provider fetch.
 *
 * REQUIRE: both
 *   - app-mobile/src/services/geocodingService.ts
 *   - app-mobile/src/components/location/MapboxAddressInput.tsx (consumer wrapper)
 *   import from "@mingla/location-input".
 *
 * FORBID: a direct provider geocoding fetch (api.mapbox.com OR a Nominatim
 *   /search?/reverse? host) anywhere in those two consumer location files —
 *   consumer code must call the package/service, not a provider URL directly.
 *
 * Pass condition: required imports present AND no direct provider fetch in the
 * consumer location files.
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

const GEOCODING_SERVICE = path.join(
  REPO_ROOT,
  "app-mobile",
  "src",
  "services",
  "geocodingService.ts",
);
const CONSUMER_WRAPPER = path.join(
  REPO_ROOT,
  "app-mobile",
  "src",
  "components",
  "location",
  "MapboxAddressInput.tsx",
);

const SHARED_IMPORT_RE = /from\s+["']@mingla\/location-input["']/;
// Direct provider geocoding fetch the consumer must NOT make itself.
const DIRECT_PROVIDER_RE =
  /(api\.mapbox\.com|nominatim\.openstreetmap\.org|nominatim[^"']*\/(search|reverse))/i;

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

function runSelfTest() {
  let selfFail = 0;
  const goodImport = `import { forwardGeocodeMapbox } from "@mingla/location-input";`;
  const badNoImport = `import { supabase } from "./supabase";`;
  const badDirect = `const r = await fetch("https://api.mapbox.com/search/searchbox/v1/forward?q=" + q);`;
  if (!SHARED_IMPORT_RE.test(goodImport)) {
    console.error("SELF-TEST FAIL: shared import not detected");
    selfFail++;
  }
  if (SHARED_IMPORT_RE.test(badNoImport)) {
    console.error("SELF-TEST FAIL: shared import false-positive");
    selfFail++;
  }
  if (!DIRECT_PROVIDER_RE.test(badDirect)) {
    console.error("SELF-TEST FAIL: direct provider fetch not flagged");
    selfFail++;
  }
  if (DIRECT_PROVIDER_RE.test(goodImport)) {
    console.error("SELF-TEST FAIL: direct-provider false-positive on shared import");
    selfFail++;
  }
  if (selfFail > 0) {
    console.error(`SELF-TEST: ${selfFail} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-CONSUMER-LOCATION-USES-SHARED-MAPBOX detector behaves");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
}

for (const [label, file] of [
  ["geocodingService.ts", GEOCODING_SERVICE],
  ["consumer MapboxAddressInput wrapper", CONSUMER_WRAPPER],
]) {
  if (!fs.existsSync(file)) {
    fail("INV-2: shared-import-present", `${label} missing at ${path.relative(REPO_ROOT, file)}`);
    continue;
  }
  const src = readSource(file);
  if (SHARED_IMPORT_RE.test(src)) {
    ok("INV-2: shared-import-present", `${label} imports @mingla/location-input`);
  } else {
    fail(
      "INV-2: shared-import-present",
      `${label} does NOT import from @mingla/location-input`,
    );
  }
  if (DIRECT_PROVIDER_RE.test(src)) {
    fail(
      "INV-2: no-direct-provider-fetch",
      `${label} contains a direct provider geocoding URL — must go through the package seam`,
    );
  } else {
    ok("INV-2: no-direct-provider-fetch", `${label} has no direct provider fetch`);
  }
}

process.exit(failures > 0 ? 1 : 0);
