#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — ORCH-1313 [AppsFlyer attribution + OneLink · Phase 1]
 * I-PROPOSED-1313-LOGOUT-CLEARS-APPSFLYER-IDENTITY (DRAFT)
 *
 * Constitution #6 — logout clears everything. The consumer
 * performPrivateAuthCleanup integrations block MUST call BOTH
 * clearAppsFlyerUserId() and resetAppsFlyerDeviceCache() (imported from the
 * appsFlyerService), alongside the OneSignal / RevenueCat / Mixpanel resets, so a
 * subsequent different sign-in registers fresh and does not inherit the prior
 * user's customer_user_id.
 *
 * Fails-on-revert: removing either call (or the import) fails this gate.
 *
 * Exit codes: 0 pass · 1 fail · 2 fs error. `--self-test` validates detectors.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const CLEANUP = path.join(REPO_ROOT, "app-mobile/src/utils/authCleanup.ts");

const IMPORT_RE =
  /import\s*\{[^}]*\bclearAppsFlyerUserId\b[^}]*\bresetAppsFlyerDeviceCache\b[^}]*\}\s*from\s*["'][^"']*appsFlyerService["']/s;

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

// Extract the `if (includeIntegrations) { ... }` block via brace matching.
function extractIntegrationsBlock(code) {
  const marker = code.search(/if\s*\(\s*includeIntegrations\s*\)\s*\{/);
  if (marker === -1) return null;
  const open = code.indexOf("{", marker);
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") {
      depth--;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  return null;
}

function bothCalledInBlock(code) {
  const block = extractIntegrationsBlock(code);
  if (!block) return { found: false, clear: false, reset: false };
  return {
    found: true,
    clear: /\bclearAppsFlyerUserId\s*\(\s*\)/.test(block),
    reset: /\bresetAppsFlyerDeviceCache\s*\(\s*\)/.test(block),
  };
}

function runSelfTest() {
  let selfFail = 0;
  const goodImport = `import { clearAppsFlyerUserId, resetAppsFlyerDeviceCache } from "../services/appsFlyerService";`;
  if (!IMPORT_RE.test(goodImport)) {
    console.error("SELF-TEST FAIL: valid AF-clear import not detected");
    selfFail++;
  }
  const good = `if (includeIntegrations) {
    logoutOneSignal();
    try { clearAppsFlyerUserId(); resetAppsFlyerDeviceCache(); } catch (e) {}
  }`;
  const missingReset = `if (includeIntegrations) {
    clearAppsFlyerUserId();
  }`;
  const gg = bothCalledInBlock(stripComments(good));
  if (!(gg.found && gg.clear && gg.reset)) {
    console.error("SELF-TEST FAIL: both AF-clear calls not detected in a correct block");
    selfFail++;
  }
  const mm = bothCalledInBlock(stripComments(missingReset));
  if (mm.reset) {
    console.error("SELF-TEST FAIL: missing resetAppsFlyerDeviceCache not caught");
    selfFail++;
  }
  if (selfFail > 0) {
    console.error(`SELF-TEST: ${selfFail} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-PROPOSED-1313-LOGOUT-CLEARS-APPSFLYER-IDENTITY detectors behave");
  process.exit(0);
}

if (process.argv.includes("--self-test")) runSelfTest();

if (!fs.existsSync(CLEANUP)) {
  fail("INV-0: cleanup-present", "app-mobile/src/utils/authCleanup.ts missing");
} else {
  const raw = readSource(CLEANUP);
  if (IMPORT_RE.test(raw)) {
    ok("INV-1: import", "authCleanup imports clearAppsFlyerUserId + resetAppsFlyerDeviceCache from appsFlyerService");
  } else {
    fail("INV-1: import", "authCleanup must statically import both AppsFlyer-clear functions — SPEC_ORCH-1313 §4.B");
  }
  const r = bothCalledInBlock(stripComments(raw));
  if (!r.found) {
    fail("INV-2: integrations-block", "could not locate the `if (includeIntegrations)` block");
  } else if (r.clear && r.reset) {
    ok("INV-2: both-called", "both AppsFlyer-clear functions are called inside the integrations block");
  } else {
    fail("INV-2: both-called", `integrations block must call BOTH clears (clear=${r.clear}, reset=${r.reset}) — Constitution #6 / SPEC_ORCH-1313 §4.B`);
  }
}

if (failures > 0) {
  console.error(`\nI-PROPOSED-1313-LOGOUT-CLEARS-APPSFLYER-IDENTITY: ${failures} violation(s)`);
  process.exit(1);
}
console.log("\nI-PROPOSED-1313-LOGOUT-CLEARS-APPSFLYER-IDENTITY: PASS · violations=0");
process.exit(0);
