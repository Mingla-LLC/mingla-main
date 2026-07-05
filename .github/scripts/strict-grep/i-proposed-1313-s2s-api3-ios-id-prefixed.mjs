#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — ORCH-1313 [AppsFlyer attribution + OneLink · Phase 1]
 * I-PROPOSED-1313-S2S-API3-IOS-ID-PREFIXED (DRAFT)
 *
 * AppsFlyer api3 requires the iOS app id in the `id`-prefixed form; the bare
 * number returns 200 OK but silently drops the event. _shared/appsFlyerS2S.ts MUST
 * define an idempotent `ensureIdPrefix` normalizer and apply it on the iOS branch.
 * Android stays the bare package name.
 *
 * The idempotency BEHAVIOUR is proven by the Deno unit test
 * (appsFlyerS2S.orch1313.test.ts); this gate is the SOURCE fails-on-revert: removing
 * the normalizer or its iOS application fails here.
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

const DEFINES_RE = /export\s+function\s+ensureIdPrefix\s*\(/;
const APPLIES_IOS_RE = /device\.platform\s*===\s*["']ios["'][\s\S]{0,80}ensureIdPrefix\s*\(\s*iosAppId\s*\)/;

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
    export function ensureIdPrefix(appleId: string): string {
      return appleId.startsWith("id") ? appleId : \`id\${appleId}\`;
    }
    const appId = device.platform === "ios" ? ensureIdPrefix(iosAppId) : androidAppId;
  `;
  const bad = `
    const appId = device.platform === "ios" ? iosAppId : androidAppId;
  `;
  if (!(DEFINES_RE.test(good) && APPLIES_IOS_RE.test(good))) {
    console.error("SELF-TEST FAIL: correct ensureIdPrefix definition+application not recognized");
    selfFail++;
  }
  if (DEFINES_RE.test(bad) || APPLIES_IOS_RE.test(bad)) {
    console.error("SELF-TEST FAIL: reverted (no-normalizer) iOS branch not caught");
    selfFail++;
  }
  if (selfFail > 0) {
    console.error(`SELF-TEST: ${selfFail} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-PROPOSED-1313-S2S-API3-IOS-ID-PREFIXED detectors behave");
  process.exit(0);
}

if (process.argv.includes("--self-test")) runSelfTest();

if (!fs.existsSync(S2S)) {
  fail("INV-0: s2s-present", "supabase/functions/_shared/appsFlyerS2S.ts missing");
} else {
  const code = stripComments(readSource(S2S));
  if (DEFINES_RE.test(code)) {
    ok("INV-1: defines-normalizer", "exports ensureIdPrefix()");
  } else {
    fail("INV-1: defines-normalizer", "must export the idempotent ensureIdPrefix normalizer — SPEC_ORCH-1313 §4.D-ii");
  }
  if (APPLIES_IOS_RE.test(code)) {
    ok("INV-2: applies-on-ios", "the iOS branch applies ensureIdPrefix(iosAppId)");
  } else {
    fail("INV-2: applies-on-ios", "the iOS app id must be normalized via ensureIdPrefix(iosAppId) — SPEC_ORCH-1313 §4.D-ii");
  }
}

if (failures > 0) {
  console.error(`\nI-PROPOSED-1313-S2S-API3-IOS-ID-PREFIXED: ${failures} violation(s)`);
  process.exit(1);
}
console.log("\nI-PROPOSED-1313-S2S-API3-IOS-ID-PREFIXED: PASS · violations=0");
process.exit(0);
