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
 *   3. (ORCH-1127) BOTH giphy services read the key from
 *      `Constants.expoConfig.extra` FIRST (manifest-backed, build-safe) and do
 *      NOT regress to a dynamic-only `process.env[<var>]` / `globalThis.process
 *      ?.env?.[<var>]` read — which babel-preset-expo never inlines, leaving the
 *      key undefined in every Hermes standalone / OTA / production build.
 *
 * The build-time PRESENCE of the key in the EAS environment is enforced by the
 * config-eval guard itself (§4.B); this gate enforces the SOURCE wiring so the
 * guard + docs + extra-first read can't be reverted without CI catching it.
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
// ORCH-1127 — the two client-direct GIPHY services that read the public key.
const GIPHY_SERVICES = [
  "mingla-business/src/services/giphyEventCoverService.ts",
  "mingla-business/src/services/coverProviderBrowseService.ts",
];

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

// ORCH-1127 — each giphy service MUST read the manifest-backed extra first.
const EXTRA_READ_RE = /Constants\.expoConfig\??\.extra/;
// ...and MUST NOT regress to a dynamic-only process.env bracket read with a
// VARIABLE key (`process.env[name]` / `process.env?.[name]` / `.env?.[name]`).
// A STATIC member read (`process.env.EXPO_PUBLIC_GIPHY_API_KEY`) is fine — it is
// inlined by babel-preset-expo — so this only matches the bracket form whose
// subscript is NOT a quoted string literal.
const DYNAMIC_ENV_BRACKET_RE = /\.env\??\.?\[\s*(?!['"`])[^\]]+\]/;

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

// Strip // line comments and /* */ block comments so the dynamic-bracket
// detector only inspects executable code — the protective ORCH-1127 comments
// intentionally name `process.env[<var>]` and must not self-trip the gate.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
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

  // ORCH-1127 — extra-first read + no dynamic-bracket regression.
  const goodService = `
    import Constants from "expo-constants";
    const readExtra = (name) => {
      const extra = Constants.expoConfig?.extra;
      return extra?.[name];
    };
    const readStatic = (name) =>
      name === "EXPO_PUBLIC_GIPHY_API_KEY"
        ? process.env.EXPO_PUBLIC_GIPHY_API_KEY
        : process.env.EXPO_PUBLIC_GIPHY_KEY;
    const envValue = (name) => readExtra(name) ?? readStatic(name);
  `;
  const dynamicOnlyService = `
    const envValue = (name) => {
      const value = globalThis.process?.env?.[name];
      return value ?? null;
    };
  `;
  if (!EXTRA_READ_RE.test(goodService)) {
    console.error("SELF-TEST FAIL: extra-first read not detected in a correct service");
    selfFail++;
  }
  if (DYNAMIC_ENV_BRACKET_RE.test(goodService)) {
    console.error(
      "SELF-TEST FAIL: dynamic-bracket detector false-positives on a correct (static + extra) service",
    );
    selfFail++;
  }
  if (EXTRA_READ_RE.test(dynamicOnlyService)) {
    console.error(
      "SELF-TEST FAIL: extra-read detector false-positives on a dynamic-only service",
    );
    selfFail++;
  }
  if (!DYNAMIC_ENV_BRACKET_RE.test(dynamicOnlyService)) {
    console.error(
      "SELF-TEST FAIL: dynamic-bracket detector missed the regressed dynamic-only reader",
    );
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

// Check 3 — ORCH-1127: both giphy services read Constants.expoConfig.extra
// first and do NOT regress to a dynamic-only process.env bracket read.
for (const rel of GIPHY_SERVICES) {
  const abs = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(abs)) {
    fail("INV-3: giphy-service-present", `${rel} missing`);
    continue;
  }
  const src = readSource(abs);
  const code = stripComments(src);
  const hasExtraRead = EXTRA_READ_RE.test(code);
  const hasDynamicBracket = DYNAMIC_ENV_BRACKET_RE.test(code);
  if (hasExtraRead && !hasDynamicBracket) {
    ok(
      "INV-3: giphy-extra-first-read",
      `${rel} reads Constants.expoConfig.extra and has no dynamic process.env[<var>] read`,
    );
  } else {
    fail(
      "INV-3: giphy-extra-first-read",
      `${rel} must read Constants.expoConfig.extra (found=${hasExtraRead}) and must NOT use a dynamic process.env[<var>] read (foundDynamic=${hasDynamicBracket}) — see SPEC_AMENDMENT_ORCH-1127 §A2/§A3.4`,
    );
  }
}

if (failures > 0) {
  console.error(`\nI-GIPHY-KEY-WIRED: ${failures} violation(s)`);
  process.exit(1);
}
console.log("\nI-GIPHY-KEY-WIRED: PASS · violations=0");
process.exit(0);
