#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — ORCH-1313 [AppsFlyer attribution + OneLink · Phase 1] §4.C
 * (secret hygiene / config parity — the fails-on-revert for the build-time guard)
 *
 * The AppsFlyer dev key + app IDs are env-driven with a RELEASE-BOUND fail-loud
 * guard so a release build can never silently ship AppsFlyer dark. This gate
 * asserts the SOURCE wiring cannot be reverted without CI catching it:
 *   1. app-mobile/app.config.js — release-bound throw guard (throws on a missing
 *      key on a release EAS_BUILD_PROFILE) that references EXPO_PUBLIC_APPSFLYER_DEV_KEY.
 *   2. mingla-business/app.config.js — symmetric release-bound throw guard tied to
 *      hasAppsFlyerEnv() + EAS_BUILD_PROFILE.
 *   3. app-mobile/src/services/appsFlyerService.ts — reads the key from
 *      Constants.expoConfig.extra FIRST (build-safe) and carries a hasAppsFlyerEnv guard.
 *
 * The build-time PRESENCE of the key in the EAS env is enforced by the guard itself
 * (proven with a local `expo config` run); this gate protects the source wiring.
 *
 * Exit codes: 0 pass · 1 fail · 2 fs error. `--self-test` validates detectors.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const CONSUMER_CONFIG = path.join(REPO_ROOT, "app-mobile/app.config.js");
const BUSINESS_CONFIG = path.join(REPO_ROOT, "mingla-business/app.config.js");
const CONSUMER_SERVICE = path.join(REPO_ROOT, "app-mobile/src/services/appsFlyerService.ts");

const KEY_REF_RE = /EXPO_PUBLIC_APPSFLYER_DEV_KEY/;
const EAS_PROFILE_RE = /EAS_BUILD_PROFILE/;
// A release-bound throw naming the ORCH — the structural shape of the §4.C guard.
const GUARD_THROW_RE = /throw new Error\(\s*`[^`]*ORCH-1313[^`]*`/;
const HAS_ENV_RE = /hasAppsFlyerEnv/;
// Consumer service must read the manifest-backed extra first (build-safe path).
const EXTRA_FIRST_RE =
  /Constants\.expoConfig\??\.extra\??\.EXPO_PUBLIC_APPSFLYER_DEV_KEY/;

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
  const goodConsumerConfig = `
    const easProfile = process.env.EAS_BUILD_PROFILE;
    if (isReleaseBound && !fromEnv) {
      throw new Error(\`\${envName} is required for the \${easProfile} EAS_BUILD_PROFILE build — AppsFlyer attribution would ship dark. [ORCH-1313]\`);
    }
    EXPO_PUBLIC_APPSFLYER_DEV_KEY: appsFlyerConfigValue("EXPO_PUBLIC_APPSFLYER_DEV_KEY", "x"),
  `;
  const passthroughOnly = `
    EXPO_PUBLIC_APPSFLYER_DEV_KEY: process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY ?? null,
  `;
  const goodBusiness = `
    const easBuildProfile = process.env.EAS_BUILD_PROFILE;
    if (easBuildProfile !== undefined && list.includes(easBuildProfile) && !hasAppsFlyerEnv()) {
      throw new Error(\`EXPO_PUBLIC_APPSFLYER_DEV_KEY required for \${easBuildProfile} EAS_BUILD_PROFILE build — silent-dark. [ORCH-1313]\`);
    }
  `;
  const goodService = `
    const AF_DEV_KEY = (Constants.expoConfig?.extra?.EXPO_PUBLIC_APPSFLYER_DEV_KEY as string | undefined) ?? process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY;
    const hasAppsFlyerEnv = Boolean(AF_DEV_KEY);
  `;

  if (!(KEY_REF_RE.test(goodConsumerConfig) && GUARD_THROW_RE.test(goodConsumerConfig) && EAS_PROFILE_RE.test(goodConsumerConfig))) {
    console.error("SELF-TEST FAIL: valid consumer config guard not detected");
    selfFail++;
  }
  if (GUARD_THROW_RE.test(passthroughOnly)) {
    console.error("SELF-TEST FAIL: passthrough-without-guard false-positives as a fail-loud guard");
    selfFail++;
  }
  if (!(GUARD_THROW_RE.test(goodBusiness) && HAS_ENV_RE.test(goodBusiness) && EAS_PROFILE_RE.test(goodBusiness))) {
    console.error("SELF-TEST FAIL: valid business config guard not detected");
    selfFail++;
  }
  if (!(EXTRA_FIRST_RE.test(goodService) && HAS_ENV_RE.test(goodService))) {
    console.error("SELF-TEST FAIL: valid extra-first service read not detected");
    selfFail++;
  }
  if (selfFail > 0) {
    console.error(`SELF-TEST: ${selfFail} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-PROPOSED-1313-APPSFLYER-KEY-FAIL-LOUD detectors behave");
  process.exit(0);
}

if (process.argv.includes("--self-test")) runSelfTest();

// Check 1 — consumer app.config.js release-bound fail-loud guard
if (!fs.existsSync(CONSUMER_CONFIG)) {
  fail("INV-1: consumer-config-present", "app-mobile/app.config.js missing");
} else {
  const src = readSource(CONSUMER_CONFIG);
  if (KEY_REF_RE.test(src) && GUARD_THROW_RE.test(src) && EAS_PROFILE_RE.test(src)) {
    ok("INV-1: consumer-fail-loud", "app-mobile/app.config.js throws ORCH-1313 on a missing key for a release EAS_BUILD_PROFILE");
  } else {
    fail("INV-1: consumer-fail-loud", "app-mobile/app.config.js is missing the release-bound AppsFlyer fail-loud guard — SPEC_ORCH-1313 §4.C File 1");
  }
}

// Check 2 — business app.config.js symmetric guard
if (!fs.existsSync(BUSINESS_CONFIG)) {
  fail("INV-2: business-config-present", "mingla-business/app.config.js missing");
} else {
  const src = readSource(BUSINESS_CONFIG);
  if (GUARD_THROW_RE.test(src) && HAS_ENV_RE.test(src) && EAS_PROFILE_RE.test(src)) {
    ok("INV-2: business-fail-loud", "mingla-business/app.config.js throws ORCH-1313 when hasAppsFlyerEnv() is false on a release EAS_BUILD_PROFILE");
  } else {
    fail("INV-2: business-fail-loud", "mingla-business/app.config.js is missing the symmetric release-bound AppsFlyer fail-loud guard — SPEC_ORCH-1313 §4.C File 3");
  }
}

// Check 3 — consumer service reads extra first + hasAppsFlyerEnv guard
if (!fs.existsSync(CONSUMER_SERVICE)) {
  fail("INV-3: consumer-service-present", "app-mobile/src/services/appsFlyerService.ts missing");
} else {
  const src = readSource(CONSUMER_SERVICE);
  if (EXTRA_FIRST_RE.test(src) && HAS_ENV_RE.test(src)) {
    ok("INV-3: extra-first-read", "consumer service reads the dev key from Constants.expoConfig.extra first and carries hasAppsFlyerEnv");
  } else {
    fail("INV-3: extra-first-read", "consumer service must read EXPO_PUBLIC_APPSFLYER_DEV_KEY from Constants.expoConfig.extra first + carry hasAppsFlyerEnv — SPEC_ORCH-1313 §4.C File 2");
  }
}

if (failures > 0) {
  console.error(`\nI-PROPOSED-1313-APPSFLYER-KEY-FAIL-LOUD: ${failures} violation(s)`);
  process.exit(1);
}
console.log("\nI-PROPOSED-1313-APPSFLYER-KEY-FAIL-LOUD: PASS · violations=0");
process.exit(0);
