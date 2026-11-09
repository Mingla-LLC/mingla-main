#!/usr/bin/env node
/* eslint-disable no-console */
// MINGLA-INVARIANT: I-BIZ-ADDRESS-INPUT-USES-SHARED-PICKER | issue #4334 | The Host venue, brand and trip address fields import the shared AddressInput wrapper and never the removed direct-autocomplete path.
/**
 * Strict-grep gate — ORCH-1079 / #4334
 * INV-1 · I-BIZ-ADDRESS-INPUT-USES-SHARED-PICKER
 *
 * The three business address-autocomplete surfaces must use the shared address
 * picker (Google behind the proxy since #4334) — never the retired Google AddressAutocompleteInput / googlePlacesService
 * / parseGooglePlaceResult.
 *
 * REQUIRE: each of
 *   - mingla-business/src/components/venue/VenueStep1Address.tsx
 *   - mingla-business/src/components/brand/BrandCreationFlow.tsx
 *   - mingla-business/src/components/trip/TripCreatorStep1Basics.tsx
 *   imports `AddressInput` from a `components/location/AddressInput` path.
 *
 * FORBID (in those 3 files): any reference to AddressAutocompleteInput,
 *   googlePlacesService, or parseGooglePlaceResult (import OR identifier OR even
 *   a comment — the tokens must be fully gone so the Google path can't sneak back).
 *
 * Pass condition: all 3 require-imports present AND zero forbidden tokens.
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

const TARGETS = [
  path.join(
    REPO_ROOT,
    "mingla-business/src/components/venue/VenueStep1Address.tsx",
  ),
  path.join(
    REPO_ROOT,
    "mingla-business/src/components/brand/BrandCreationFlow.tsx",
  ),
  path.join(
    REPO_ROOT,
    "mingla-business/src/components/trip/TripCreatorStep1Basics.tsx",
  ),
];

const REQUIRE_SHARED_IMPORT_RE =
  /import\s*\{[^}]*\bAddressInput\b[^}]*\}\s*from\s*["'][^"']*location\/AddressInput["']/;
const FORBID_RES = [
  [/\bAddressAutocompleteInput\b/, "AddressAutocompleteInput"],
  [/googlePlacesService/, "googlePlacesService"],
  [/parseGooglePlaceResult/, "parseGooglePlaceResult"],
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

function runSelfTest() {
  let selfFail = 0;
  const goodImport = `import { AddressInput } from "../location/AddressInput";`;
  const badImport = `import { AddressAutocompleteInput } from "../event/AddressAutocompleteInput";`;
  if (!REQUIRE_SHARED_IMPORT_RE.test(goodImport)) {
    console.error("SELF-TEST FAIL: shared import not detected");
    selfFail++;
  }
  if (REQUIRE_SHARED_IMPORT_RE.test(badImport)) {
    console.error("SELF-TEST FAIL: shared import false-positive on google import");
    selfFail++;
  }
  if (!FORBID_RES[0][0].test(badImport)) {
    console.error("SELF-TEST FAIL: AddressAutocompleteInput not flagged");
    selfFail++;
  }
  if (FORBID_RES[1][0].test(goodImport)) {
    console.error("SELF-TEST FAIL: googlePlacesService false-positive");
    selfFail++;
  }
  if (!FORBID_RES[2][0].test(`const p = parseGooglePlaceResult(d);`)) {
    console.error("SELF-TEST FAIL: parseGooglePlaceResult not flagged");
    selfFail++;
  }
  if (selfFail > 0) {
    console.error(`SELF-TEST: ${selfFail} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-BIZ-ADDRESS-INPUT-USES-SHARED-PICKER detectors behave");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
}

for (const file of TARGETS) {
  const rel = path.relative(REPO_ROOT, file);
  if (!fs.existsSync(file)) {
    fail("INV-1: target-present", `${rel} missing`);
    continue;
  }
  const src = readSource(file);
  if (REQUIRE_SHARED_IMPORT_RE.test(src)) {
    ok("INV-1: shared-import-present", `${rel} imports AddressInput`);
  } else {
    fail(
      "INV-1: shared-import-present",
      `${rel} does NOT import AddressInput from components/location/AddressInput`,
    );
  }
  for (const [re, token] of FORBID_RES) {
    if (re.test(src)) {
      fail(
        "INV-1: no-google-path",
        `${rel} still references "${token}" — the Google path must be fully removed (ORCH-1079)`,
      );
    } else {
      ok("INV-1: no-google-path", `${rel} free of "${token}"`);
    }
  }
}

process.exit(failures > 0 ? 1 : 0);
