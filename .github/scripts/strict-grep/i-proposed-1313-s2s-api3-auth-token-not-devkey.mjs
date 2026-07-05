#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — ORCH-1313 [AppsFlyer attribution + OneLink · Phase 1]
 * I-PROPOSED-1313-S2S-API3-AUTH-TOKEN-NOT-DEVKEY (DRAFT)
 *
 * The AppsFlyer api3 `authentication` header in _shared/appsFlyerS2S.ts MUST carry
 * the V2 S2S token (APPSFLYER_S2S_TOKEN), read fail-closed, and MUST NEVER carry
 * the legacy dev key. The gate asserts the file:
 *   (a) reads Deno.env.get("APPSFLYER_S2S_TOKEN");
 *   (b) sets the `authentication` header to the s2sToken variable (not devKey);
 *   (c) does NOT read APPSFLYER_BUSINESS_DEV_KEY anywhere (the dead auth path).
 *
 * Fails-on-revert: reverting the header to the dev key (re-introducing
 * Deno.env.get("APPSFLYER_BUSINESS_DEV_KEY") / `"authentication": devKey`) fails.
 *
 * Exit codes: 0 pass · 1 fail · 2 fs error. `--self-test` validates detectors.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const S2S = path.join(REPO_ROOT, "supabase/functions/_shared/appsFlyerS2S.ts");

const READS_TOKEN_RE = /Deno\.env\.get\(\s*["']APPSFLYER_S2S_TOKEN["']\s*\)/;
const HEADER_TOKEN_RE = /["']authentication["']\s*:\s*s2sToken\b/;
const HEADER_DEVKEY_RE = /["']authentication["']\s*:\s*devKey\b/;
const READS_DEVKEY_RE = /Deno\.env\.get\(\s*["']APPSFLYER_BUSINESS_DEV_KEY["']\s*\)/;

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
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function runSelfTest() {
  let selfFail = 0;
  const good = `
    const s2sToken = Deno.env.get("APPSFLYER_S2S_TOKEN");
    headers: { "authentication": s2sToken, "Content-Type": "application/json" },
  `;
  const bad = `
    const devKey = Deno.env.get("APPSFLYER_BUSINESS_DEV_KEY");
    headers: { "authentication": devKey, "Content-Type": "application/json" },
  `;
  if (!(READS_TOKEN_RE.test(good) && HEADER_TOKEN_RE.test(good) && !HEADER_DEVKEY_RE.test(good) && !READS_DEVKEY_RE.test(good))) {
    console.error("SELF-TEST FAIL: correct S2S-token auth not recognized");
    selfFail++;
  }
  if (!(READS_DEVKEY_RE.test(bad) && HEADER_DEVKEY_RE.test(bad))) {
    console.error("SELF-TEST FAIL: reverted dev-key auth not caught");
    selfFail++;
  }
  if (selfFail > 0) {
    console.error(`SELF-TEST: ${selfFail} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-PROPOSED-1313-S2S-API3-AUTH-TOKEN-NOT-DEVKEY detectors behave");
  process.exit(0);
}

if (process.argv.includes("--self-test")) runSelfTest();

if (!fs.existsSync(S2S)) {
  fail("INV-0: s2s-present", "supabase/functions/_shared/appsFlyerS2S.ts missing");
} else {
  const code = stripComments(readSource(S2S));
  if (READS_TOKEN_RE.test(code)) {
    ok("INV-1: reads-token", "reads Deno.env.get(APPSFLYER_S2S_TOKEN)");
  } else {
    fail("INV-1: reads-token", "must read APPSFLYER_S2S_TOKEN (api3 V2 S2S token) — SPEC_ORCH-1313 §4.D-i");
  }
  if (HEADER_TOKEN_RE.test(code) && !HEADER_DEVKEY_RE.test(code)) {
    ok("INV-2: header-token", "authentication header value is the S2S token, not the dev key");
  } else {
    fail("INV-2: header-token", "authentication header must be s2sToken (never devKey) — SPEC_ORCH-1313 §4.D-i");
  }
  if (!READS_DEVKEY_RE.test(code)) {
    ok("INV-3: no-devkey-auth", "APPSFLYER_BUSINESS_DEV_KEY is no longer read as the auth credential");
  } else {
    fail("INV-3: no-devkey-auth", "APPSFLYER_BUSINESS_DEV_KEY must NOT feed the api3 auth path — SPEC_ORCH-1313 §4.D-i (fail-closed)");
  }
}

if (failures > 0) {
  console.error(`\nI-PROPOSED-1313-S2S-API3-AUTH-TOKEN-NOT-DEVKEY: ${failures} violation(s)`);
  process.exit(1);
}
console.log("\nI-PROPOSED-1313-S2S-API3-AUTH-TOKEN-NOT-DEVKEY: PASS · violations=0");
process.exit(0);
