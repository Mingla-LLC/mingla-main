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
 *   INV-3 (tree-shakeable — no barrel import / bloat regression):
 *     - the web shim MUST require lucide icons from their DEEP per-icon module
 *       paths (`lucide-react/dist/esm/icons/<kebab>.js`); it MUST NOT import the
 *       `"lucide-react"` barrel entry in ANY form (`import * as X from
 *       "lucide-react"`, `import {…} from "lucide-react"`, or
 *       `require("lucide-react")`). The barrel statically references all
 *       ~1700 icons; Metro cannot tree-shake it, so the whole library lands in
 *       the eager __common boot chunk and blows the ORCH-1083 bundle budget (the
 *       regression this rework fixes).
 *   INV-4 (used-set drift guard):
 *     - EVERY icon name imported from `lucide-react-native` anywhere under
 *       mingla-business/{src,app} MUST be present in the shim's USED_ICONS map.
 *       If a component starts importing a new icon, this fails CI and tells the
 *       dev to add the name to the shim (so it ships a REAL glyph on web instead
 *       of silently falling back to the HelpCircle placeholder).
 *
 * Comments are stripped before scanning so the protective header references to
 * `() => null` / `import *` do not self-trip the gate.
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
// The shim must pull in the real lucide-react lib. Accept the deep per-icon
// module form (`require("lucide-react/dist/esm/icons/plus.js")`) AND the bare
// entry form — either way it references the real lucide-react package, never the
// `() => null` null-stub.
const REQUIRES_LUCIDE_REACT_RE =
  /(?:require\(\s*["']lucide-react(?:\/[^"']*)?["']\s*\)|from\s+["']lucide-react(?:\/[^"']*)?["'])/;
// ...and expose a Proxy as the total resolver.
const EXPORTS_PROXY_RE = /new\s+Proxy\s*\(/;
// ...and MUST NOT carry the null-stub pattern (`<Ident> = () => null`), the
// exact shape of the reverted bug.
const NULL_STUB_RE = /\b[A-Za-z_$][\w$]*\s*=\s*\(\s*\)\s*=>\s*null\b/;
// INV-3 — the shim MUST NOT pull the lucide-react BARREL entry (the bloat
// regression). The package entry `"lucide-react"` is a barrel that statically
// references all ~1700 icons; Metro's minifier can't tree-shake the unused ones
// out of it, so the whole roster re-enters __common. The fix requires each icon
// from its OWN deep module path (`lucide-react/dist/esm/icons/<kebab>.js`), which
// these detectors do NOT match.
//
//   - `import * as X from "lucide-react"`           (ESM namespace off the barrel)
//   - `import X from "lucide-react"` / `import { } from "lucide-react"` (ESM barrel)
//   - `require("lucide-react")`                     (CJS barrel, any binding)
// All target the BARE entry only — the trailing `["']` (no `/...`) is the guard
// that distinguishes the barrel from a deep per-icon path.
const NAMESPACE_IMPORT_STAR_RE =
  /import\s*\*\s*as\s+[A-Za-z_$][\w$]*\s*from\s*["']lucide-react["']/;
// Any ESM `import ... from "lucide-react"` (barrel entry, no deep path).
const BARREL_ESM_IMPORT_RE = /import\b[^;]*?from\s*["']lucide-react["']/;
// Any `require("lucide-react")` of the bare barrel entry (no deep path).
const BARREL_REQUIRE_RE = /require\(\s*["']lucide-react["']\s*\)/;

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

  // GOOD shim: real lucide-react DEEP per-icon requires, no null-stub, no barrel
  // import (the tree-shakeable fix shape).
  const goodShim = stripComments(`
    const React = require("react");
    const USED = {
      Plus: require("lucide-react/dist/esm/icons/plus.js").default,
      ArrowUp: require("lucide-react/dist/esm/icons/arrow-up.js").default,
      HelpCircle: require("lucide-react/dist/esm/icons/help-circle.js").default,
    };
    const proxy = new Proxy({}, { get: (_t, k) => USED[k] ?? USED.HelpCircle });
    module.exports = proxy;
    module.exports.default = proxy;
  `);
  // BAD shim: the reverted null-stub.
  const badShim = stripComments(`
    const React = require("react");
    const IconStub = () => null;
    module.exports = { Plus: IconStub, ArrowUp: IconStub, X: IconStub };
  `);
  // BAD shim: the barrel require (the bloat regression — destructured off entry).
  const barrelRequireShim = stripComments(`
    const React = require("react");
    const { Plus, ArrowUp } = require("lucide-react");
    const proxy = new Proxy({}, { get: (_t, k) => ({ Plus, ArrowUp })[k] });
    module.exports = proxy;
  `);
  // BAD shim: the ESM namespace import off the barrel.
  const namespaceStarShim = stripComments(`
    import * as Lucide from "lucide-react";
    export default new Proxy({}, { get: (_t, k) => Lucide[k] });
  `);
  // BAD shim: a plain ESM barrel import.
  const barrelEsmShim = stripComments(`
    import { Plus, ArrowUp } from "lucide-react";
    export default new Proxy({}, { get: (_t, k) => ({ Plus, ArrowUp })[k] });
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
  // INV-3 detectors: the GOOD deep-require shim must NOT trip any barrel
  // detector; every barrel shim MUST trip at least one.
  const tripsBarrel = (s) =>
    NAMESPACE_IMPORT_STAR_RE.test(s) ||
    BARREL_ESM_IMPORT_RE.test(s) ||
    BARREL_REQUIRE_RE.test(s);
  if (tripsBarrel(goodShim)) {
    console.error("SELF-TEST FAIL: deep-require shim falsely flagged as a barrel import");
    selfFail++;
  }
  if (!REQUIRES_LUCIDE_REACT_RE.test(goodShim)) {
    console.error("SELF-TEST FAIL: deep-require shim not recognized as referencing lucide-react");
    selfFail++;
  }
  if (!tripsBarrel(barrelRequireShim)) {
    console.error("SELF-TEST FAIL: barrel require('lucide-react') not detected");
    selfFail++;
  }
  if (!tripsBarrel(namespaceStarShim)) {
    console.error("SELF-TEST FAIL: `import * as` barrel import not detected");
    selfFail++;
  }
  if (!tripsBarrel(barrelEsmShim)) {
    console.error("SELF-TEST FAIL: plain ESM barrel import not detected");
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

// INV-3 + INV-4 operate on the shim again (re-read for an isolated scope).
if (fs.existsSync(SHIM)) {
  const shimRaw = readSource(SHIM);
  const shimCode = stripComments(shimRaw);

  // INV-3 — tree-shakeable: NO barrel ("lucide-react" entry) import; deep
  // per-icon module paths only.
  const hasStarImport = NAMESPACE_IMPORT_STAR_RE.test(shimCode);
  const hasBarrelEsm = BARREL_ESM_IMPORT_RE.test(shimCode);
  const hasBarrelRequire = BARREL_REQUIRE_RE.test(shimCode);
  if (!hasStarImport && !hasBarrelEsm && !hasBarrelRequire) {
    ok(
      "INV-3: tree-shakeable-deep-imports",
      'lucideReactNativeWebStub.js imports lucide icons from deep per-icon module paths (no "lucide-react" barrel / "import * as")',
    );
  } else {
    fail(
      "INV-3: tree-shakeable-deep-imports",
      `lucideReactNativeWebStub.js must require icons from their DEEP module paths (lucide-react/dist/esm/icons/<kebab>.js) — found "import * as"=${hasStarImport}, ESM barrel import=${hasBarrelEsm}, barrel require=${hasBarrelRequire}. The "lucide-react" barrel entry statically references all ~1700 icons; Metro cannot tree-shake it, so the whole roster re-enters the eager __common boot chunk and blows the ORCH-1083 bundle budget. See SPEC_ORCH-1137 §4.2 / the ORCH-1137 rework.`,
    );
  }

  // INV-4 — used-set drift guard: every icon imported from lucide-react-native
  // across mingla-business/{src,app} MUST be present in the shim's named-import
  // used-set.
  //
  // Parse the shim's used-set from the USED_ICONS map: each entry is
  // `<IconName>: iconOf(require("lucide-react/dist/esm/icons/<kebab>.js"))`.
  // We collect the LHS icon-name keys that are bound to a deep lucide-react
  // require.
  const shimNames = new Set();
  // Each map entry binds an icon-name key to a deep per-icon lucide-react
  // require, e.g. `IconName: iconOf(require("lucide-react/dist/esm/icons/x.js"))`
  // or `IconName: require("lucide-react/dist/esm/icons/x.js").default`. The
  // `[^,:{}]*` between the key and the require forbids crossing another `:`/`,`
  // so the ternary in the `iconOf` helper cannot bleed into the capture.
  const USED_ENTRY_RE =
    /([A-Za-z_$][\w$]*)\s*:\s*[^,:{}]*require\(\s*["']lucide-react\/[^"']*["']\s*\)/g;
  let entryMatch;
  while ((entryMatch = USED_ENTRY_RE.exec(shimCode)) !== null) {
    shimNames.add(entryMatch[1]);
  }

  // Collect every icon name imported from lucide-react-native across the app.
  const BIZ_ROOTS = [
    path.join(REPO_ROOT, "mingla-business", "src"),
    path.join(REPO_ROOT, "mingla-business", "app"),
  ];
  const importedNames = new Set();
  const IMPORT_RE =
    /import\s*\{([^}]*)\}\s*from\s*["']lucide-react-native["']/g;
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
      } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
        const src = readSource(full);
        let m;
        while ((m = IMPORT_RE.exec(src)) !== null) {
          for (const raw of m[1].split(",")) {
            // Handle `Foo as Bar` — the imported (source) name is `Foo`.
            const name = raw.trim().split(/\s+as\s+/)[0].trim();
            if (name) importedNames.add(name);
          }
        }
      }
    }
  }
  for (const root of BIZ_ROOTS) walk(root);

  const missing = [...importedNames].filter((n) => !shimNames.has(n)).sort();
  if (shimNames.size === 0) {
    fail(
      "INV-4: used-set-drift-guard",
      'could not parse the shim USED_ICONS map — each entry must be `<IconName>: iconOf(require("lucide-react/dist/esm/icons/<kebab>.js"))`.',
    );
  } else if (missing.length === 0) {
    ok(
      "INV-4: used-set-drift-guard",
      `all ${importedNames.size} lucide-react-native icon name(s) used across mingla-business are present in the shim used-set (${shimNames.size} names)`,
    );
  } else {
    fail(
      "INV-4: used-set-drift-guard",
      `these icon name(s) are imported from lucide-react-native in mingla-business but are MISSING from the web shim's named-import used-set:\n  ${missing.join(
        "\n  ",
      )}\nAdd each to the USED_ICONS map in mingla-business/src/shims/lucideReactNativeWebStub.js as <IconName>: iconOf(require("lucide-react/dist/esm/icons/<kebab>.js")) so it renders a REAL glyph on web (otherwise it silently falls back to the HelpCircle placeholder).`,
    );
  }
}

if (failures > 0) {
  console.error(`\nI-PROPOSED-1137-BIZ-WEB-LUCIDE-REAL: ${failures} violation(s)`);
  process.exit(1);
}
console.log("\nI-PROPOSED-1137-BIZ-WEB-LUCIDE-REAL: PASS · violations=0");
process.exit(0);
