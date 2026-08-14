#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — ORCH-1214 [business-prod-pk-live-validator]
 * I-ORCH-1214-BUSINESS-PK-LIVE-BUILD-ACCEPTS-LIVE (DRAFT until CLOSE)
 *
 * mingla-business/app.config.js resolves EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY via
 * an IIFE branching on process.env.VERCEL_ENV. Branch 4 (VERCEL_ENV undefined)
 * is the NATIVE EAS build + local-dev path. It previously HARDCODED a pk_test_
 * requirement:
 *
 *   if (!localValue.startsWith("pk_test_")) throw "...pk_test_ for local development.";
 *
 * On an EAS production build VERCEL_ENV is undefined, EAS injects a pk_live_
 * publishable key (correct for live Stripe mode), and the validator THREW —
 * `expo config --json` exited 1 and the build died. This blocked ALL business
 * production builds once the platform moved to live Stripe.
 *
 * ORCH-1214 changed branch 4 to accept the mode-appropriate prefix: pk_live_
 * only when MINGLA_STRIPE_MODE=live, pk_test_ otherwise. This gate asserts that
 * acceptance cannot be silently reverted — branch 4 of app.config.js MUST:
 *   (a) accept a pk_live_ value: a `localValue.startsWith("pk_live_")` branch
 *       that returns the value, AND
 *   (b) guard it on live mode: a `stripeMode !== "live"` throw inside that
 *       branch so a pk_live_ key under non-live mode is still rejected.
 *
 * If either disappears, the hardcoded-pk_test_ regression (build-killing) is
 * back, so this gate fails.
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

const APP_CONFIG = path.join(REPO_ROOT, "mingla-business/app.config.js");

// (a) Branch 4 accepts a pk_live_ value — `localValue.startsWith("pk_live_")`.
const PK_LIVE_ACCEPT_RE = /localValue\.startsWith\(\s*["']pk_live_["']\s*\)/;
// (b) The pk_live_ branch is guarded on live mode — a `stripeMode !== "live"`
// comparison gating the mode-mismatch throw.
const LIVE_MODE_GUARD_RE = /stripeMode\s*!==\s*["']live["']/;
// Regression sentinel — the OLD hardcoded branch-4 error message. If this exact
// message is present, branch 4 still hardcodes pk_test_ (the build-killer).
const OLD_HARDCODE_MSG_RE =
  /must be a pk_test_ value for local development\./;

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

// Strip // line comments and /* */ block comments so the detectors only inspect
// executable code — the ORCH-1214 protective comment intentionally names
// pk_test_/pk_live_ and must not satisfy (or trip) the assertions.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function runSelfTest() {
  let selfFail = 0;

  // The fixed (post-1214) branch 4 — accepts pk_live_ under live mode.
  const fixedBranch4 = `
    const localValue = fromEnv ?? sandboxFallback;
    if (localValue.startsWith("pk_live_")) {
      if (stripeMode !== "live") {
        throw new Error(
          \`...pk_live_ value but MINGLA_STRIPE_MODE=\${stripeMode}...\`,
        );
      }
      return localValue;
    }
    if (!localValue.startsWith("pk_test_")) {
      throw new Error(
        "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a pk_test_ (test/local) or pk_live_ (live) value.",
      );
    }
    return localValue;`;

  // The OLD (pre-1214) hardcoded branch 4 — the build-killing regression.
  const oldBranch4 = `
    const localValue = fromEnv ?? sandboxFallback;
    if (!localValue.startsWith("pk_test_")) {
      throw new Error(
        "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a pk_test_ value for local development.",
      );
    }
    return localValue;`;

  if (!PK_LIVE_ACCEPT_RE.test(fixedBranch4)) {
    console.error("SELF-TEST FAIL: pk_live_ acceptance not detected in fixed branch 4");
    selfFail++;
  }
  if (!LIVE_MODE_GUARD_RE.test(fixedBranch4)) {
    console.error("SELF-TEST FAIL: stripeMode !== 'live' guard not detected in fixed branch 4");
    selfFail++;
  }
  if (OLD_HARDCODE_MSG_RE.test(fixedBranch4)) {
    console.error("SELF-TEST FAIL: old-hardcode sentinel false-positives on the fixed branch 4");
    selfFail++;
  }
  if (PK_LIVE_ACCEPT_RE.test(oldBranch4)) {
    console.error("SELF-TEST FAIL: pk_live_ acceptance false-positives on the OLD hardcoded branch 4");
    selfFail++;
  }
  if (!OLD_HARDCODE_MSG_RE.test(oldBranch4)) {
    console.error("SELF-TEST FAIL: old-hardcode sentinel missed the OLD branch 4 regression");
    selfFail++;
  }

  if (selfFail > 0) {
    console.error(`SELF-TEST: ${selfFail} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-ORCH-1214-BUSINESS-PK-LIVE-BUILD-ACCEPTS-LIVE detectors behave");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
}

if (!fs.existsSync(APP_CONFIG)) {
  fail("INV-1: app-config-present", "mingla-business/app.config.js missing");
} else {
  const code = stripComments(readSource(APP_CONFIG));
  const acceptsPkLive = PK_LIVE_ACCEPT_RE.test(code);
  const guardsLiveMode = LIVE_MODE_GUARD_RE.test(code);
  const hasOldHardcode = OLD_HARDCODE_MSG_RE.test(code);

  if (acceptsPkLive && guardsLiveMode) {
    ok(
      "INV-1: pk-live-accepted-under-live-mode",
      "app.config.js branch 4 accepts a pk_live_ key (localValue.startsWith(\"pk_live_\")) and guards it on stripeMode !== \"live\"",
    );
  } else {
    fail(
      "INV-1: pk-live-accepted-under-live-mode",
      `app.config.js branch 4 must accept pk_live_ under live mode (acceptsPkLive=${acceptsPkLive}, guardsLiveMode=${guardsLiveMode}) — see IMPLEMENTATION_ORCH-1214. The native EAS production build injects a pk_live_ key; rejecting it kills every business production build.`,
    );
  }

  if (hasOldHardcode) {
    fail(
      "INV-2: no-hardcoded-pk-test-local-dev",
      "app.config.js still carries the OLD branch-4 message \"must be a pk_test_ value for local development.\" — the pk_test_-only hardcode (build-killing regression) is back.",
    );
  } else {
    ok(
      "INV-2: no-hardcoded-pk-test-local-dev",
      "app.config.js no longer hardcodes the pk_test_-only branch-4 requirement",
    );
  }
}

if (failures > 0) {
  console.error(`\nI-ORCH-1214-BUSINESS-PK-LIVE-BUILD-ACCEPTS-LIVE: ${failures} violation(s)`);
  process.exit(1);
}
console.log("\nI-ORCH-1214-BUSINESS-PK-LIVE-BUILD-ACCEPTS-LIVE: PASS · violations=0");
process.exit(0);
