#!/usr/bin/env node
// #890 — the web Sentry SDK (@sentry/browser) may appear in the web graph ONLY
// as a LAZY dynamic import() inside mingla-business/src/diagnostics/sentry.ts,
// guarded by a `typeof window` check. Two failure modes are guarded:
//
//   1. A STATIC import (`import ... from "@sentry/browser"`, side-effect
//      `import "@sentry/browser"`, or `require("@sentry/browser")`) ANYWHERE in
//      mingla-business/app + mingla-business/src re-breaks the Expo Router web
//      export — its deep integrations touch `window` at module-load and the
//      static-render pass runs in Node (ORCH-0886 crash `window is not defined`).
//   2. Reverting src/diagnostics/sentry.ts to the old no-op stub silently
//      re-darkens web crash reporting (#890). The positive assertion below
//      requires the real lazy loader to be present, so a stub revert fails RED.
//
// Modeled on orch-0778-web-stripe-native-import-gate.mjs (ORCH-0778). The pure
// `check(fileEntries, failures)` is exercised by `--self-test` with 1 GOOD + 2
// DISTINCT BAD fixtures; the disk-walking main path feeds the SAME `check(...)`
// the walked entries. This gate runs as a job:* carve-out, so its self-test is
// wired via an explicit workflow step (see strict-grep-mingla-business.yml).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const checkedRoots = ["mingla-business/app", "mingla-business/src"];
// The ONE file allowed to reference @sentry/browser, and only via dynamic import().
const WEB_SENTRY_MODULE = "mingla-business/src/diagnostics/sentry.ts";

const failures = [];

// STATIC-import forms (forbidden). A dynamic `import("@sentry/browser")` has
// `import(` with no whitespace before the paren, so `import\s+` never matches
// it; `from "..."` / side-effect `import "..."` / `require("...")` are the only
// static shapes and none of them appear in a dynamic import expression.
const staticImportPattern =
  /import\s+["']@sentry\/browser["']|from\s+["']@sentry\/browser["']|require\(\s*["']@sentry\/browser["']\s*\)/;
// The allowed lazy form + its mandatory browser guard (positive assertions).
const dynamicImportPattern = /import\(\s*["']@sentry\/browser["']\s*\)/;
const windowGuardPattern = /typeof\s+window/;

// Strip block + line comments before the import scan so a PROSE mention of a
// static import (e.g. the `sentry.ts` header's "NEVER add `import … from
// \"@sentry/browser\"`" warning) is not mistaken for a real static import. The
// positive assertions run on the ORIGINAL source, where the real dynamic
// `import()` + `typeof window` guard live in code, not comments.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ") // /* … */ and /** … */ blocks
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1"); // // line comments (keep `://` in URLs)
}

// Pure verdict. `fileEntries` = [{ relativePath, source }]. Returns whether the
// web Sentry module was seen (so the main disk-walk can assert it exists).
function check(fileEntries, failures) {
  let sawWebModule = false;
  for (const { relativePath, source } of fileEntries) {
    if (staticImportPattern.test(stripComments(source))) {
      failures.push(
        `${relativePath}: static import of @sentry/browser is forbidden in the web graph. ` +
          `Load it ONLY via a lazy dynamic import("@sentry/browser") inside ${WEB_SENTRY_MODULE} ` +
          `(#890 — a static import re-breaks the Expo Router web export, ORCH-0886).`,
      );
    }
    if (relativePath === WEB_SENTRY_MODULE) {
      sawWebModule = true;
      if (!dynamicImportPattern.test(source)) {
        failures.push(
          `${WEB_SENTRY_MODULE}: must lazy-load the real SDK via a dynamic import("@sentry/browser"). ` +
            `Reverting to the no-op stub removes it → web crash reporting goes dark again (#890).`,
        );
      }
      if (!windowGuardPattern.test(source)) {
        failures.push(
          `${WEB_SENTRY_MODULE}: the dynamic import must be guarded by a \`typeof window\` browser ` +
            `check (#890 — preserves the ORCH-0886 module-load window-safety invariant).`,
        );
      }
    }
  }
  return sawWebModule;
}

const walk = (directory, fileEntries) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath, fileEntries);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
    const relativePath = path.relative(root, absolutePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    fileEntries.push({ relativePath, source });
  }
};

const checkNpmWiring = () => {
  const packageJsonPath = path.join(root, "mingla-business/package.json");
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch (error) {
    failures.push(`issue-890 wiring: mingla-business/package.json parse failed: ${error.message} (npm wiring)`);
    return;
  }
  const script = packageJson.scripts?.["test:issue-890"];
  if (typeof script !== "string" || !script.includes("issue-890-web-sentry-lazy-only.mjs")) {
    failures.push(
      `issue-890 wiring: mingla-business/package.json missing scripts["test:issue-890"] or the expected gate ` +
        `script path (npm wiring)`,
    );
  }
};

const checkWorkflowWiring = () => {
  const workflowRelativePath = ".github/workflows/strict-grep-mingla-business.yml";
  const workflowPath = path.join(root, workflowRelativePath);
  let workflowSource;
  try {
    workflowSource = fs.readFileSync(workflowPath, "utf8");
  } catch (error) {
    failures.push(`issue-890 wiring: ${workflowRelativePath} read failed: ${error.message} (CI wiring)`);
    return;
  }
  if (!/^\s{2}issue-890-web-sentry-lazy-only:\s*$/m.test(workflowSource)) {
    failures.push(
      `issue-890 wiring: ${workflowRelativePath} missing carve-out job issue-890-web-sentry-lazy-only (CI wiring)`,
    );
  }
  if (!/issue-890-web-sentry-lazy-only\.mjs\s+--self-test/.test(workflowSource)) {
    failures.push(
      `issue-890 wiring: ${workflowRelativePath} does not run the gate with --self-test (CI wiring)`,
    );
  }
};

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];

  // GOOD: the web module lazy-loads the real SDK behind a `typeof window` guard;
  // a caller imports the platform shim (NOT @sentry/browser) → silent.
  let f = [];
  check(
    [
      {
        relativePath: WEB_SENTRY_MODULE,
        source:
          'type B = typeof import("@sentry/browser");\n' +
          'export function init(o){ if (typeof window === "undefined") return; void import("@sentry/browser").then((m)=>m.init(o)); }\n',
      },
      {
        relativePath: "mingla-business/app/_layout.tsx",
        source: 'import * as Sentry from "../src/diagnostics/sentry";\nSentry.init({ dsn });\n',
      },
    ],
    f,
  );
  if (f.length) self.push("GOOD (lazy, browser-guarded web module) wrongly flagged: " + f.join("; "));

  // BAD1 (static import): a non-diagnostics file statically imports @sentry/browser → fires.
  f = [];
  check([{ relativePath: "mingla-business/src/foo.ts", source: 'import * as S from "@sentry/browser";\n' }], f);
  if (f.length === 0) self.push("BAD1 (static @sentry/browser import in a web-graph file) not flagged");

  // BAD2 (stub revert, different angle): the web module is the old no-op stub —
  // no dynamic import, no `typeof window` guard → fires on BOTH positive asserts.
  f = [];
  check(
    [
      {
        relativePath: WEB_SENTRY_MODULE,
        source: 'export function init(){ /* no-op on web */ }\nexport function captureException(){ return ""; }\n',
      },
    ],
    f,
  );
  if (f.length === 0) self.push("BAD2 (stub-shaped sentry.ts with no dynamic import) not flagged");

  if (self.length) {
    console.error("issue-890 self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("issue-890 self-test PASS (3/3 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
const fileEntries = [];
for (const checkedRoot of checkedRoots) {
  walk(path.join(root, checkedRoot), fileEntries);
}
const sawWebModule = check(fileEntries, failures);
if (!sawWebModule) {
  failures.push(
    `issue-890: ${WEB_SENTRY_MODULE} was not found in the web graph — the web Sentry platform shim must exist.`,
  );
}

checkNpmWiring();
checkWorkflowWiring();

if (failures.length > 0) {
  console.error("issue-890 web Sentry lazy-only gate failed.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("issue-890 web Sentry lazy-only gate passed.");
