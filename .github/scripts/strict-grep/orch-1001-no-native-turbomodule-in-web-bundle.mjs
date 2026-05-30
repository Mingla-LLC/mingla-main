#!/usr/bin/env node
/**
 * ORCH-1001 [Business web white-page crash] — native TurboModule web-bundle gate.
 *
 * WHY: `react-native-video-trim` (and peers) ship a TurboModule whose module
 * body runs `TurboModuleRegistry.getEnforcing('<Name>')` at IMPORT-EVAL time.
 * An eager top-level `import` of such a package in a web-reachable file gets
 * evaluated the instant the web bundle loads, `getEnforcing` throws (no native
 * runtime on web), and the entire app crashes to a blank #root (white page).
 * That is exactly what shipped with ORCH-0989 and blanked business.usemingla.com.
 *
 * RULE: a native-only package on the denylist may be EAGERLY imported only from
 *   (a) a `*.native.ts|tsx|js|jsx` file (Metro never bundles it on web), or
 *   (b) a base `foo.ts|tsx` file that HAS a sibling `foo.web.ts|tsx` stub
 *       (Metro resolves the web stub on web, so the native pkg is excluded).
 * Any other eager import is a FAIL — it would land in, and crash, the web bundle.
 *
 * Lazy, runtime-gated `require("pkg")` (e.g. react-native-compressor behind a
 * `Platform.OS === "web"` early-return) is NOT flagged: Metro registers the
 * factory but never executes its body on web, so `getEnforcing` never runs.
 * This gate targets EAGER `import` / top-level `import()` only.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const checkedRoots = ["mingla-business/app", "mingla-business/src"];

// Native-only packages whose module body calls TurboModuleRegistry.getEnforcing
// at import-eval time. Add a package here the moment it enters the dep tree.
const nativeOnlyPackages = ["react-native-video-trim", "react-native-compressor"];

const eagerImportPattern = (pkg) => {
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // eager: `import ... from "pkg"`, side-effect `import "pkg"`, or top-level `import("pkg")`.
  // NOT matched: `require("pkg")` (lazy factory — safe when runtime-gated).
  return new RegExp(
    `(?:^|\\n)\\s*import\\s+(?:[^;\\n]*?\\s+from\\s+)?["']${escaped}["']` +
      `|(?:^|\\n)\\s*import\\(\\s*["']${escaped}["']\\s*\\)`,
  );
};

const hasWebSibling = (absolutePath) => {
  const dir = path.dirname(absolutePath);
  const base = path.basename(absolutePath).replace(/\.(ts|tsx|js|jsx)$/, "");
  return [".web.ts", ".web.tsx", ".web.js", ".web.jsx"].some((ext) =>
    fs.existsSync(path.join(dir, `${base}${ext}`)),
  );
};

const isNativeSuffixed = (absolutePath) =>
  /\.native\.(ts|tsx|js|jsx)$/.test(absolutePath);

const failures = [];

const walk = (directory) => {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
    const relativePath = path.relative(root, absolutePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    for (const pkg of nativeOnlyPackages) {
      if (!eagerImportPattern(pkg).test(source)) continue;
      if (isNativeSuffixed(absolutePath)) continue; // .native.* — web-excluded
      if (hasWebSibling(absolutePath)) continue; // platform split — web gets stub
      failures.push(
        `${relativePath}: eager top-level import of native-only "${pkg}" in a web-reachable file. ` +
          `Move it behind a Metro platform split — a "${path.basename(relativePath).replace(/\.(ts|tsx|js|jsx)$/, "")}.web.ts" stub sibling, ` +
          `or a ".native.ts" file. An eager import here runs getEnforcing() at web-eval time and white-pages the app.`,
      );
    }
  }
};

// ---- Self-test (run with --self-test): proves the gate actually catches the bug.
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const probe = (label, source, file, expectFail) => {
    const fakeRoot = "/tmp/orch1001-selftest";
    const abs = path.join(fakeRoot, file);
    const pat = eagerImportPattern("react-native-video-trim");
    const matched = pat.test(source);
    const wouldFail =
      matched && !isNativeSuffixed(abs) && !(file.includes("HASWEB"));
    if (wouldFail !== expectFail) {
      selfFailures.push(`SELF-TEST "${label}": expected fail=${expectFail}, got ${wouldFail}`);
    }
  };
  probe("eager import in plain file", 'import Foo from "react-native-video-trim";', "Bad.ts", true);
  probe("side-effect import", 'import "react-native-video-trim";', "Bad.ts", true);
  probe(".native suffixed", 'import Foo from "react-native-video-trim";', "Ok.native.ts", false);
  probe("lazy require (not eager)", 'const x = require("react-native-video-trim");', "Ok.ts", false);
  probe("unrelated file", 'import { View } from "react-native";', "Ok.ts", false);
  if (selfFailures.length) {
    console.error("ORCH-1001 gate SELF-TEST FAILED:");
    selfFailures.forEach((f) => console.error("  - " + f));
    process.exit(1);
  }
  console.log("ORCH-1001 gate self-test PASS (5/5 cases).");
  process.exit(0);
}

// ---- npm wiring check: the gate must be wired into package.json.
const checkNpmWiring = () => {
  const packageJsonPath = path.join(root, "mingla-business/package.json");
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch (error) {
    failures.push(`ORCH-1001 wiring: mingla-business/package.json parse failed: ${error.message}`);
    return;
  }
  const script = packageJson.scripts?.["test:orch-1001"];
  if (
    typeof script !== "string" ||
    !script.includes("orch-1001-no-native-turbomodule-in-web-bundle.mjs")
  ) {
    failures.push(
      `ORCH-1001 wiring: mingla-business/package.json missing scripts["test:orch-1001"] pointing at the gate script.`,
    );
  }
};

checkedRoots.forEach((relativeRoot) => walk(path.join(root, relativeRoot)));
checkNpmWiring();

if (failures.length) {
  console.error("ORCH-1001 native-TurboModule web-bundle gate FAILED:");
  failures.forEach((failure) => console.error("  - " + failure));
  process.exit(1);
}
console.log(
  `ORCH-1001 gate PASS: no eager native-only TurboModule imports in web-reachable mingla-business code (${nativeOnlyPackages.join(", ")}).`,
);
