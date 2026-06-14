#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — ORCH-1137 [biz-web lucide icon systemic fix]
 * I-PROPOSED-1137-BIZ-WEB-LUCIDE-REAL (DRAFT → ACTIVE on CLOSE)
 *
 * The business app imports icons from `lucide-react-native`. On WEB,
 * mingla-business/metro.config.js aliases `lucide-react-native` -> the web shim
 * (`src/shims/lucideReactNativeWebStub.js`) for `platform === "web"` only.
 *
 * ROOT CAUSE this ORCH fixes: that shim used to export 12 named icons each
 * `const IconStub = () => null` — every lucide glyph rendered BLANK on biz web,
 * and any icon name outside the 12-entry list resolved to `undefined` → a React
 * "type is invalid" crash on any web Ari conversation that mounted such a card.
 *
 * This gate enforces that the fix cannot be silently reverted:
 *
 *   INV-1 (shim renders real icons + never undefined):
 *     - the web shim `require`s/imports `lucide-react` (the real DOM-SVG lib),
 *     - exports a `Proxy` (the total resolver), AND
 *     - contains NO `IconStub = () => null` null-stub pattern.
 *   INV-2 (metro alias intact, web-gated):
 *     - metro.config.js still aliases `lucide-react-native` -> the shim path AND
 *       still gates the web overrides behind `platform === "web"` (native
 *       resolution untouched).
 *
 * Comments are stripped before scanning so the protective header references to
 * `() => null` do not self-trip the gate.
 *
 * Exit codes: 0 pass · 1 fail · 2 fs error
 * Self-test mode (--self-test) validates the detectors against fixtures.
 *
 * Per SPEC_ORCH-1137 §6 / §9.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const SHIM = path.join(
  REPO_ROOT,
  "mingla-business/src/shims/lucideReactNativeWebStub.js",
);
const METRO = path.join(REPO_ROOT, "mingla-business/metro.config.js");

// Detectors (run against comment-stripped source).
// The shim must pull in the real lucide-react lib (require or import form).
const REQUIRES_LUCIDE_REACT_RE =
  /(?:require\(\s*["']lucide-react["']\s*\)|from\s+["']lucide-react["'])/;
// ...and expose a Proxy as the total resolver.
const EXPORTS_PROXY_RE = /new\s+Proxy\s*\(/;
// ...and MUST NOT carry the null-stub pattern (`<Ident> = () => null`), the
// exact shape of the reverted bug.
const NULL_STUB_RE = /\b[A-Za-z_$][\w$]*\s*=\s*\(\s*\)\s*=>\s*null\b/;

// metro.config.js must still alias lucide-react-native -> the shim on web.
const METRO_ALIAS_RE = /moduleName\s*===\s*["']lucide-react-native["']/;
const METRO_STUB_CONST_RE = /LUCIDE_REACT_NATIVE_WEB_STUB/;
const METRO_WEB_GATE_RE = /platform\s*===\s*["']web["']/;

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

  // GOOD shim: real lucide-react Proxy resolver, no null-stub.
  const goodShim = stripComments(`
    const React = require("react");
    const Lucide = require("lucide-react");
    const Fallback = Lucide.HelpCircle;
    const proxy = new Proxy({}, { get: (_t, k) => Lucide[k] ?? Fallback });
    module.exports = proxy;
    module.exports.default = proxy;
  `);
  // BAD shim: the reverted null-stub.
  const badShim = stripComments(`
    const React = require("react");
    const IconStub = () => null;
    module.exports = { Plus: IconStub, ArrowUp: IconStub, X: IconStub };
  `);

  if (
    !(
      REQUIRES_LUCIDE_REACT_RE.test(goodShim) &&
      EXPORTS_PROXY_RE.test(goodShim) &&
      !NULL_STUB_RE.test(goodShim)
    )
  ) {
    console.error("SELF-TEST FAIL: real-icon shim not accepted");
    selfFail++;
  }
  if (REQUIRES_LUCIDE_REACT_RE.test(badShim)) {
    console.error("SELF-TEST FAIL: null-stub falsely matched lucide-react require");
    selfFail++;
  }
  if (EXPORTS_PROXY_RE.test(badShim)) {
    console.error("SELF-TEST FAIL: null-stub falsely matched Proxy export");
    selfFail++;
  }
  if (!NULL_STUB_RE.test(badShim)) {
    console.error("SELF-TEST FAIL: null-stub `() => null` pattern not detected");
    selfFail++;
  }

  // metro fixtures.
  const goodMetro = stripComments(`
    const LUCIDE_REACT_NATIVE_WEB_STUB = path.join(__dirname, "src", "shims", "lucideReactNativeWebStub.js");
    if (platform === "web") {
      if (moduleName === "lucide-react-native") {
        return { filePath: LUCIDE_REACT_NATIVE_WEB_STUB, type: "sourceFile" };
      }
    }
  `);
  const badMetro = stripComments(`
    if (platform === "web") {
      if (moduleName === "react-native-reanimated") { return {}; }
    }
  `);
  if (
    !(
      METRO_ALIAS_RE.test(goodMetro) &&
      METRO_STUB_CONST_RE.test(goodMetro) &&
      METRO_WEB_GATE_RE.test(goodMetro)
    )
  ) {
    console.error("SELF-TEST FAIL: valid metro alias not accepted");
    selfFail++;
  }
  if (METRO_ALIAS_RE.test(badMetro)) {
    console.error("SELF-TEST FAIL: metro without lucide alias falsely matched");
    selfFail++;
  }

  if (selfFail > 0) {
    console.error(`SELF-TEST: ${selfFail} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-PROPOSED-1137-BIZ-WEB-LUCIDE-REAL detectors behave");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
}

// INV-1 — the web shim renders real lucide-react icons via a Proxy, no null-stub.
if (!fs.existsSync(SHIM)) {
  fail("INV-1: shim-present", `${SHIM} missing`);
} else {
  const code = stripComments(readSource(SHIM));
  const hasLucideReact = REQUIRES_LUCIDE_REACT_RE.test(code);
  const hasProxy = EXPORTS_PROXY_RE.test(code);
  const hasNullStub = NULL_STUB_RE.test(code);
  if (hasLucideReact && hasProxy && !hasNullStub) {
    ok(
      "INV-1: shim-renders-real-icons",
      "lucideReactNativeWebStub.js requires lucide-react, exports a Proxy, and has no `() => null` null-stub",
    );
  } else {
    fail(
      "INV-1: shim-renders-real-icons",
      `lucideReactNativeWebStub.js must require lucide-react (found=${hasLucideReact}), export a Proxy (found=${hasProxy}), and contain NO null-stub (foundNullStub=${hasNullStub}) — see SPEC_ORCH-1137 §4.2. Do NOT restore the () => null stub.`,
    );
  }
}

// INV-2 — metro still aliases lucide-react-native -> the shim on web only.
if (!fs.existsSync(METRO)) {
  fail("INV-2: metro-present", `${METRO} missing`);
} else {
  const code = stripComments(readSource(METRO));
  const hasAlias = METRO_ALIAS_RE.test(code);
  const hasStubConst = METRO_STUB_CONST_RE.test(code);
  const hasWebGate = METRO_WEB_GATE_RE.test(code);
  if (hasAlias && hasStubConst && hasWebGate) {
    ok(
      "INV-2: metro-alias-web-gated",
      "metro.config.js still aliases lucide-react-native -> the web shim behind `platform === \"web\"`",
    );
  } else {
    fail(
      "INV-2: metro-alias-web-gated",
      `metro.config.js must alias lucide-react-native (found=${hasAlias}) to LUCIDE_REACT_NATIVE_WEB_STUB (found=${hasStubConst}) behind a platform === "web" gate (found=${hasWebGate}) — see SPEC_ORCH-1137 §4.3`,
    );
  }
}

if (failures > 0) {
  console.error(`\nI-PROPOSED-1137-BIZ-WEB-LUCIDE-REAL: ${failures} violation(s)`);
  process.exit(1);
}
console.log("\nI-PROPOSED-1137-BIZ-WEB-LUCIDE-REAL: PASS · violations=0");
process.exit(0);
