#!/usr/bin/env node
/**
 * ORCH-1385 [main CI RED — @mingla/phone-input unresolvable in the
 * mingla-business web-build check after Dependabot PR #925 merged red] —
 * I-PROPOSED-1385-WORKSPACE-DEPS-DECLARED.
 *
 * WHY: the monorepo's `packages/*` workspace packages (`@mingla/*`) were
 * consumed by `mingla-business` and `app-mobile` WITHOUT being declared in
 * either app's package.json — resolution leaned entirely on each app's
 * metro.config.js `extraNodeModules` aliases. That worked until Dependabot
 * PR #925 (a disguised expo 54→57 major bump inside a "security group"
 * batch) changed Expo's resolver behaviour and `@mingla/phone-input`
 * stopped resolving on web (`app-mobile`'s native bundle likewise broke on
 * `@mingla/payments-native`). Because the web-build check builds PR+main
 * MERGED, every PR in the repo went red. The durable fix is structural:
 * every `@mingla/*` package an app imports MUST be declared in that app's
 * own package.json (as a `file:../packages/<name>` dependency), so npm
 * materialises a real `node_modules/@mingla/<name>` link and resolution
 * never depends on bundler-alias behaviour that a dependency bump can
 * silently change.
 *
 * ASSERTS, for EACH app in [mingla-business, app-mobile]:
 *  A. Every `@mingla/<pkg>` referenced from the app's source tree
 *     (static import/export-from, side-effect import, require(), dynamic
 *     import(), including subpath specifiers) appears in that app's
 *     package.json `dependencies` (or `devDependencies`).
 *  B. Every declared `@mingla/*` dependency uses the `file:` protocol and
 *     points at an existing `packages/<name>` directory (no phantom or
 *     registry-resolved workspace deps).
 *
 * Writer-independent: ANY future file that imports a new `@mingla/*`
 * package without declaring it fails this gate, regardless of who writes
 * it or which bundler config it happens to work under today.
 *
 * A revert that removes e.g. the `"@mingla/phone-input"` line from
 * mingla-business/package.json must FAIL CI.
 *
 * `--self-test` proves PASS-on-declared + FAIL-on-undeclared for each
 * reference form.
 *
 * Exit codes: 0 clean, 1 violation, 2 script error / inconclusive.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the repo root from THIS script's location
// (.github/scripts/strict-grep/ → up three levels), so the gate runs
// identically from CI (repo-root cwd) and from any nested cwd.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, "..", "..", "..");

/** Apps covered by the gate and the source dirs scanned inside each. */
const APPS = [
  { name: "mingla-business", srcDirs: ["app", "src"] },
  { name: "app-mobile", srcDirs: ["app", "src", "components"] },
];

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", ".expo", "dist", "build", ".git"]);

/**
 * Extract the set of `@mingla/<pkg>` package names referenced by a source
 * string. Subpath specifiers (`@mingla/x/sub`) count as the base package.
 * Covers: import/export ... from "spec", side-effect import "spec",
 * require("spec"), dynamic import("spec").
 */
export function referencedMinglaPackages(src) {
  const found = new Set();
  const patterns = [
    /\bfrom\s+["'](@mingla\/[A-Za-z0-9._-]+)/g, // import|export ... from
    /\bimport\s+["'](@mingla\/[A-Za-z0-9._-]+)/g, // side-effect import
    /\brequire\(\s*["'](@mingla\/[A-Za-z0-9._-]+)/g, // CJS require
    /\bimport\(\s*["'](@mingla\/[A-Za-z0-9._-]+)/g, // dynamic import()
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) {
      const segments = m[1].split("/");
      found.add(segments.slice(0, 2).join("/")); // @mingla/<pkg>
    }
  }
  return found;
}

/**
 * Core check for one app: given a map of {relativeFilePath: source} and the
 * parsed package.json, push human-readable failures for (A) undeclared
 * imports and (B) malformed declarations.
 */
export function checkApp(appName, sources, pkgJson, failures, packagesDirExists) {
  const deps = {
    ...(pkgJson.dependencies ?? {}),
    ...(pkgJson.devDependencies ?? {}),
  };

  // A. every referenced @mingla package is declared.
  const referencedBy = new Map(); // pkg -> first file seen
  for (const [file, src] of Object.entries(sources)) {
    for (const pkg of referencedMinglaPackages(src)) {
      if (!referencedBy.has(pkg)) referencedBy.set(pkg, file);
    }
  }
  for (const [pkg, file] of [...referencedBy.entries()].sort()) {
    if (!(pkg in deps)) {
      failures.push(
        `${appName} imports ${pkg} (first seen in ${file}) but does not ` +
          `declare it in ${appName}/package.json. Workspace packages must be ` +
          `declared as "${pkg}": "file:../packages/${pkg.split("/")[1]}" — ` +
          `resolution must never depend on metro extraNodeModules aliasing ` +
          `alone (that is exactly what Dependabot #925 broke).`,
      );
    }
  }

  // B. every declared @mingla dep is file:-protocol onto an existing package.
  for (const [pkg, spec] of Object.entries(deps)) {
    if (!pkg.startsWith("@mingla/")) continue;
    const short = pkg.split("/")[1];
    if (spec !== `file:../packages/${short}`) {
      failures.push(
        `${appName}/package.json declares ${pkg} as "${spec}" — workspace ` +
          `packages must use the exact spec "file:../packages/${short}".`,
      );
      continue;
    }
    if (!packagesDirExists(short)) {
      failures.push(
        `${appName}/package.json declares ${pkg} but packages/${short} does ` +
          `not exist in the repo.`,
      );
    }
  }
}

/** Recursively collect {relPath: source} for an app's source dirs. */
function collectSources(appName, srcDirs) {
  const sources = {};
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name), `${rel}/${e.name}`);
      } else if (SOURCE_EXTS.has(path.extname(e.name))) {
        sources[`${rel}/${e.name}`] = fs.readFileSync(
          path.join(dir, e.name),
          "utf8",
        );
      }
    }
  };
  for (const d of srcDirs) {
    walk(path.join(root, appName, d), `${appName}/${d}`);
  }
  return sources;
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const pkgExists = (name) =>
    ["phone-input", "offering-rendering"].includes(name);
  const pkg = (deps) => ({ dependencies: deps });

  // 1. Declared static import → clean.
  let f = [];
  checkApp(
    "fixture-app",
    { "fixture-app/src/a.tsx": 'import { X } from "@mingla/phone-input";' },
    pkg({ "@mingla/phone-input": "file:../packages/phone-input" }),
    f,
    pkgExists,
  );
  if (f.length) self.push("declared import wrongly flagged: " + f.join("; "));

  // 2. Undeclared static import → must fire.
  f = [];
  checkApp(
    "fixture-app",
    { "fixture-app/src/a.tsx": 'import { X } from "@mingla/phone-input";' },
    pkg({}),
    f,
    pkgExists,
  );
  if (f.length === 0) self.push("undeclared static import not flagged");

  // 3. Undeclared subpath import → must fire (base package attribution).
  f = [];
  checkApp(
    "fixture-app",
    { "fixture-app/src/b.ts": 'import t from "@mingla/offering-rendering/tokens";' },
    pkg({}),
    f,
    pkgExists,
  );
  if (f.length === 0) self.push("undeclared subpath import not flagged");

  // 4. Undeclared require() → must fire.
  f = [];
  checkApp(
    "fixture-app",
    { "fixture-app/src/c.js": 'const m = require("@mingla/phone-input");' },
    pkg({}),
    f,
    pkgExists,
  );
  if (f.length === 0) self.push("undeclared require() not flagged");

  // 5. Undeclared dynamic import() → must fire.
  f = [];
  checkApp(
    "fixture-app",
    { "fixture-app/src/d.ts": 'const m = await import("@mingla/phone-input");' },
    pkg({}),
    f,
    pkgExists,
  );
  if (f.length === 0) self.push("undeclared dynamic import() not flagged");

  // 6. Registry-style (non-file:) declaration → must fire.
  f = [];
  checkApp(
    "fixture-app",
    { "fixture-app/src/a.tsx": 'import { X } from "@mingla/phone-input";' },
    pkg({ "@mingla/phone-input": "0.0.0" }),
    f,
    pkgExists,
  );
  if (f.length === 0) self.push("non-file: declaration not flagged");

  // 7. Declaration onto a nonexistent package dir → must fire.
  f = [];
  checkApp(
    "fixture-app",
    {},
    pkg({ "@mingla/ghost-pkg": "file:../packages/ghost-pkg" }),
    f,
    pkgExists,
  );
  if (f.length === 0) self.push("phantom package declaration not flagged");

  // 8. Side-effect import form → must fire when undeclared.
  f = [];
  checkApp(
    "fixture-app",
    { "fixture-app/src/e.ts": 'import "@mingla/phone-input";' },
    pkg({}),
    f,
    pkgExists,
  );
  if (f.length === 0) self.push("undeclared side-effect import not flagged");

  if (self.length) {
    console.error("ORCH-1385 workspace-deps-declared self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1385 workspace-deps-declared self-test PASS (8/8 cases).");
  process.exit(0);
}

const failures = [];
const packagesDirExists = (name) =>
  fs.existsSync(path.join(root, "packages", name));

for (const { name, srcDirs } of APPS) {
  const pkgJsonPath = path.join(root, name, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    console.error(
      `ORCH-1385 workspace-deps-declared script error: ${name}/package.json ` +
        `not found at ${pkgJsonPath}.`,
    );
    process.exit(2);
  }
  let pkgJson;
  try {
    pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  } catch (e) {
    console.error(
      `ORCH-1385 workspace-deps-declared script error: ${name}/package.json ` +
        `is not valid JSON: ${e.message}`,
    );
    process.exit(2);
  }
  const sources = collectSources(name, srcDirs);
  if (Object.keys(sources).length === 0) {
    console.error(
      `ORCH-1385 workspace-deps-declared script error: no source files ` +
        `found under ${name}/{${srcDirs.join(",")}} — scan misconfigured.`,
    );
    process.exit(2);
  }
  checkApp(name, sources, pkgJson, failures, packagesDirExists);
}

if (failures.length > 0) {
  console.error(
    "ORCH-1385 I-PROPOSED-1385-WORKSPACE-DEPS-DECLARED FAIL:\n  " +
      failures.join("\n  ") +
      "\n\nSee .github/scripts/strict-grep/orch-1385-workspace-deps-declared.mjs " +
      "header for the #925 incident this guards against.",
  );
  process.exit(1);
}

console.log(
  "ORCH-1385 I-PROPOSED-1385-WORKSPACE-DEPS-DECLARED PASS — every @mingla/* " +
    "package imported by mingla-business and app-mobile is declared as a " +
    "file:../packages/* dependency in that app's package.json.",
);
