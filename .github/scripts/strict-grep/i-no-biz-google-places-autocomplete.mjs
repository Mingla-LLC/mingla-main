#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — ORCH-1079 [Business-venue Google→Mapbox sweep]
 * INV-2 · I-NO-BIZ-GOOGLE-PLACES-AUTOCOMPLETE
 *
 * The retired Google address-autocomplete plumbing must stay deleted AND
 * un-referenced, but GOOGLE_MAPS_API_KEY must NOT be removed (6 other edge fns
 * depend on it — deleting it is a P0).
 *
 * FORBID existence (each fs.existsSync === false):
 *   - mingla-business/src/components/event/AddressAutocompleteInput.tsx
 *   - mingla-business/src/services/googlePlacesService.ts
 *   - mingla-business/src/components/ui/GooglePlacesAutocomplete.tsx
 *   - supabase/functions/places-autocomplete/index.ts
 *
 * FORBID reference: zero matches for /places-autocomplete/ or /googlePlacesService/
 *   in NON-TEST source under mingla-business/src/ (.ts/.tsx) — so the edge fn
 *   can't be re-invoked and the service can't be re-imported. Test files
 *   (*.test.* / __tests__/) are EXEMPT: ORCH-1079's own gate-coverage tests
 *   legitimately reference these tokens inside `not.toContain(...)` assertions
 *   that PROVE the retirement (flagging them would be self-defeating).
 *
 * GUARD (NOT a deletion gate): GOOGLE_MAPS_API_KEY MUST still appear in at least
 *   one of the keep-list edge fns — if it vanishes everywhere, FAIL P0.
 *
 * Pass condition: the 4 files absent AND zero mingla-business/src references AND
 *   the key still present in the keep-list.
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

const MUST_NOT_EXIST = [
  "mingla-business/src/components/event/AddressAutocompleteInput.tsx",
  "mingla-business/src/services/googlePlacesService.ts",
  "mingla-business/src/components/ui/GooglePlacesAutocomplete.tsx",
  "supabase/functions/places-autocomplete/index.ts",
];

const BIZ_SRC = path.join(REPO_ROOT, "mingla-business", "src");
const FORBIDDEN_REF_RE = /(places-autocomplete|googlePlacesService)/;

// At least one of these must still reference the key (P0 guard).
const KEY_KEEP_LIST = [
  "supabase/functions/admin-seed-places/index.ts",
  "supabase/functions/admin-refresh-places/index.ts",
  "supabase/functions/admin-place-search/index.ts",
  "supabase/functions/backfill-place-photos/index.ts",
  "supabase/functions/get-companion-stops/index.ts",
  "supabase/functions/get-picnic-grocery/index.ts",
];
const KEY_RE = /GOOGLE_MAPS_API_KEY/;

let failures = 0;
function fail(check, msg) {
  failures += 1;
  console.error(`FAIL [${check}] ${msg}`);
}
function ok(check, msg) {
  console.log(`OK   [${check}] ${msg}`);
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    console.error(`fs error reading ${dir}: ${e.message}`);
    process.exit(2);
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      // Exempt test files — ORCH-1079's coverage tests assert on these tokens.
      if (/\.test\.[a-z]+$/.test(e.name) || full.includes(`${path.sep}__tests__${path.sep}`)) {
        continue;
      }
      out.push(full);
    }
  }
}

function runSelfTest() {
  let selfFail = 0;
  if (!FORBIDDEN_REF_RE.test(`supabase.functions.invoke("places-autocomplete")`)) {
    console.error("SELF-TEST FAIL: places-autocomplete ref not flagged");
    selfFail++;
  }
  if (!FORBIDDEN_REF_RE.test(`import x from "../services/googlePlacesService";`)) {
    console.error("SELF-TEST FAIL: googlePlacesService ref not flagged");
    selfFail++;
  }
  if (FORBIDDEN_REF_RE.test(`import { MapboxAddressInput } from "../location/MapboxAddressInput";`)) {
    console.error("SELF-TEST FAIL: forbidden-ref false-positive on mapbox import");
    selfFail++;
  }
  if (!KEY_RE.test(`const k = Deno.env.get("GOOGLE_MAPS_API_KEY");`)) {
    console.error("SELF-TEST FAIL: GOOGLE_MAPS_API_KEY guard not detecting the key");
    selfFail++;
  }
  if (selfFail > 0) {
    console.error(`SELF-TEST: ${selfFail} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-NO-BIZ-GOOGLE-PLACES-AUTOCOMPLETE detectors behave");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
}

// 1) The 4 dead files must be gone.
for (const rel of MUST_NOT_EXIST) {
  if (fs.existsSync(path.join(REPO_ROOT, rel))) {
    fail("INV-2: dead-file-removed", `${rel} still exists — must be deleted (ORCH-1079)`);
  } else {
    ok("INV-2: dead-file-removed", `${rel} absent`);
  }
}

// 2) No references under mingla-business/src.
if (fs.existsSync(BIZ_SRC)) {
  const files = [];
  walk(BIZ_SRC, files);
  let refHits = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    if (FORBIDDEN_REF_RE.test(src)) {
      refHits += 1;
      fail(
        "INV-2: no-biz-ref",
        `${path.relative(REPO_ROOT, f)} references places-autocomplete/googlePlacesService — retired (ORCH-1079)`,
      );
    }
  }
  if (refHits === 0) {
    ok("INV-2: no-biz-ref", `no places-autocomplete/googlePlacesService refs under mingla-business/src (${files.length} files scanned)`);
  }
} else {
  fail("INV-2: no-biz-ref", `mingla-business/src not found at ${BIZ_SRC}`);
}

// 3) GOOGLE_MAPS_API_KEY must still exist somewhere in the keep-list (P0 guard).
let keyPresent = false;
for (const rel of KEY_KEEP_LIST) {
  const full = path.join(REPO_ROOT, rel);
  if (fs.existsSync(full) && KEY_RE.test(fs.readFileSync(full, "utf8"))) {
    keyPresent = true;
    break;
  }
}
if (keyPresent) {
  ok("INV-2: google-key-retained", "GOOGLE_MAPS_API_KEY still present in a keep-list edge fn");
} else {
  fail(
    "INV-2: google-key-retained",
    "GOOGLE_MAPS_API_KEY removed — P0, 6 consumers depend on it (ORCH-1079 §3.D.3)",
  );
}

process.exit(failures > 0 ? 1 : 0);
