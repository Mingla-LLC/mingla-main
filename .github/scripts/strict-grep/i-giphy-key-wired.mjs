#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — ORCH-1116 [Cover picker GIF tab "This source is taking a break"]
 * I-PROPOSED-GIPHY-KEY-WIRED + I-PROPOSED-GIPHY-KEY-FAIL-LOUD (DRAFT)
 *
 * The client-direct GIPHY public key (EXPO_PUBLIC_GIPHY_API_KEY) cannot be
 * edge-proxied (GIPHY ToS), so a missing key silently breaks the cover-picker
 * GIF tab on the affected build. This gate asserts the repo-side wiring that
 * prevents that recurrence cannot be silently removed:
 *
 *   1. mingla-business/app.config.ts carries the GIPHY fail-loud config-eval
 *      guard — it references EXPO_PUBLIC_GIPHY_API_KEY AND throws when the key
 *      is absent on a release-bound profile.
 *   2. mingla-business/.env.example documents EXPO_PUBLIC_GIPHY_API_KEY.
 *
 * The build-time PRESENCE of the key in the EAS environment is enforced by the
 * config-eval guard itself (§4.B); this gate enforces the SOURCE wiring so the
 * guard + docs can't be reverted without CI catching it.
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

const APP_CONFIG = path.join(REPO_ROOT, "mingla-business/app.config.ts");
const ENV_EXAMPLE = path.join(REPO_ROOT, "mingla-business/.env.example");

// The guard must (a) reference the key name and (b) throw referencing the same
// key — a `throw new Error("...EXPO_PUBLIC_GIPHY_API_KEY...required...")`. We
// match a throw whose message names the key, which is the structural shape of
// the §4.B fail-loud guard. A simple read/passthrough of the key without a
// throw is NOT enough (that would not fail a mis-provisioned release build).
const GUARD_THROW_RE =
  /throw new Error\(\s*[`"'][^`"']*EXPO_PUBLIC_GIPHY_API_KEY[^`"']*required[^`"']*[`"']/i;
const KEY_REF_RE = /EXPO_PUBLIC_GIPHY_API_KEY/;
// .env.example documents the key as a top-level entry (`EXPO_PUBLIC_GIPHY_API_KEY=`).
const ENV_EXAMPLE_RE = /^EXPO_PUBLIC_GIPHY_API_KEY=/m;

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
  const goodGuard = `
    EXPO_PUBLIC_GIPHY_API_KEY: (() => {
      const fromEnv = process.env.EXPO_PUBLIC_GIPHY_API_KEY ?? null;
      if (isReleaseBound && (fromEnv === null || fromEnv.length === 0)) {
        throw new Error(
          \`EXPO_PUBLIC_GIPHY_API_KEY is required for the \${profileLabel} build (cover-picker GIF tab). Provision it in the matching EAS environment.\`,
        );
      }
      return fromEnv;
    })(),`;
  const passthroughOnly = `
    EXPO_PUBLIC_GIPHY_API_KEY: process.env.EXPO_PUBLIC_GIPHY_API_KEY ?? null,`;
  const goodEnv = `EXPO_PUBLIC_OPENWEATHER_API_KEY=foo\nEXPO_PUBLIC_GIPHY_API_KEY=\n`;
  const badEnv = `EXPO_PUBLIC_OPENWEATHER_API_KEY=foo\n`;

  if (!(KEY_REF_RE.test(goodGuard) && GUARD_THROW_RE.test(goodGuard))) {
    console.error("SELF-TEST FAIL: valid GIPHY fail-loud guard not detected");
    selfFail++;
  }
  if (GUARD_THROW_RE.test(passthroughOnly)) {
    console.error(
      "SELF-TEST FAIL: passthrough-without-throw false-positive as a fail-loud guard",
    );
    selfFail++;
  }
  if (!ENV_EXAMPLE_RE.test(goodEnv)) {
    console.error("SELF-TEST FAIL: documented .env.example entry not detected");
    selfFail++;
  }
  if (ENV_EXAMPLE_RE.test(badEnv)) {
    console.error("SELF-TEST FAIL: .env.example false-positive on missing entry");
    selfFail++;
  }
  if (selfFail > 0) {
    console.error(`SELF-TEST: ${selfFail} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-GIPHY-KEY-WIRED detectors behave");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
}

// Check 1 — app.config.ts fail-loud guard present
if (!fs.existsSync(APP_CONFIG)) {
  fail("INV-1: app-config-present", "mingla-business/app.config.ts missing");
} else {
  const src = readSource(APP_CONFIG);
  const hasKeyRef = KEY_REF_RE.test(src);
  const hasGuardThrow = GUARD_THROW_RE.test(src);
  if (hasKeyRef && hasGuardThrow) {
    ok(
      "INV-1: giphy-fail-loud-guard",
      "app.config.ts references EXPO_PUBLIC_GIPHY_API_KEY and throws when it is absent on a release-bound profile",
    );
  } else {
    fail(
      "INV-1: giphy-fail-loud-guard",
      `app.config.ts is missing the GIPHY fail-loud guard (keyRef=${hasKeyRef}, guardThrow=${hasGuardThrow}) — see SPEC_ORCH-1116 §4.B`,
    );
  }
}

// Check 2 — .env.example documents the key
if (!fs.existsSync(ENV_EXAMPLE)) {
  fail("INV-2: env-example-present", "mingla-business/.env.example missing");
} else {
  const env = readSource(ENV_EXAMPLE);
  if (ENV_EXAMPLE_RE.test(env)) {
    ok("INV-2: env-example-documents-key", ".env.example documents EXPO_PUBLIC_GIPHY_API_KEY");
  } else {
    fail(
      "INV-2: env-example-documents-key",
      ".env.example does NOT document EXPO_PUBLIC_GIPHY_API_KEY — see SPEC_ORCH-1116 §4.A2",
    );
  }
}

if (failures > 0) {
  console.error(`\nI-GIPHY-KEY-WIRED: ${failures} violation(s)`);
  process.exit(1);
}
console.log("\nI-GIPHY-KEY-WIRED: PASS · violations=0");
process.exit(0);
