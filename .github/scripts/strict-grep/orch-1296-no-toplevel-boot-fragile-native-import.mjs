#!/usr/bin/env node
/**
 * ORCH-1296 [OTA boot-brick] — no top-level boot-fragile native imports gate.
 *
 * WHY: ORCH-1295 shipped `eventCoverVideoTusPatch.native.ts` with TOP-LEVEL
 * static imports of `expo/fetch` and expo-file-system's new `File` API. Expo
 * Router eagerly require()s the whole `app/` route tree at startup (native,
 * asyncRoutes off); the venue/experience routes transitively import CoverPicker
 * → the cover-video service → that module. A top-level native import there
 * EVALUATES during boot, before the native modules are fully registered, throws,
 * and bricks the splash. It only bricks OVER-THE-AIR (a native build compiles the
 * modules in and boots fine; the OTA runs new native-touching JS on the already
 * installed core). Same failure class as ORCH-1001's web `getEnforcing`, but at
 * NATIVE boot — so `*.native.ts` files are the danger zone here, NOT exempt.
 *
 * RULE: a boot-fragile native module must be imported LAZILY —
 *   `const { X } = await import("pkg")` INSIDE a function — never at module scope.
 *   Static `import ... from "pkg"` is module-scope by definition (ESM forbids it
 *   inside a function), so ANY static import is a top-level import. `import type`
 *   is erased at compile time (no runtime import) and is allowed. Dynamic
 *   `await import("pkg")` is allowed.
 *
 * RATCHET: pre-ORCH-1296 top-level usages that were audited boot-safe are
 * GRANDFATHERED (see ALLOWLIST) — the gate does not force a churn on them. It
 * hard-fails any NEW top-level import of a boot-fragile module (i.e. exactly the
 * ORCH-1295 mistake). The ORCH-1295 module is intentionally NOT grandfathered: it
 * was fixed to lazy imports, so re-adding a top-level import there fails the gate.
 *
 * Exit: 0 = clean, 1 = violation(s), 0 = self-test pass (`--self-test`).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const checkedRoots = ["mingla-business/app", "mingla-business/src"];

// Whole-package boot-fragile natives: ANY top-level runtime import is forbidden.
const fragilePackages = [
  "expo/fetch",
  "posthog-react-native",
  "react-native-keyboard-controller",
];

// expo-file-system is only fragile via its NEW-API value bindings from the BARE
// specifier. `expo-file-system/legacy` and type-only imports are allowed.
const EXPO_FS_NEW_API = ["File", "Directory", "Paths"];

// Pre-ORCH-1296 top-level imports, audited boot-safe (their native modules are
// core/register before their routes load, or the import is not import-eval-fatal).
// Grandfathered so the ratchet blocks NEW violations without churning these.
// Paths are POSIX-relative to the monorepo root.
const ALLOWLIST = new Set([
  // expo-file-system new `File` API — ORCH-0786 native byte-read pattern.
  "mingla-business/src/services/eventCoverFileReader.native.ts",
  "mingla-business/src/services/creatorAvatarFileReader.native.ts",
  "mingla-business/src/services/brandCoverFileReader.native.ts",
  "mingla-business/src/services/brandAvatarFileReader.native.ts",
  // react-native-keyboard-controller — canonical keyboard lib (ORCH-0892),
  // imported as JSX components across boot-safe native wrappers/components.
  "mingla-business/src/wrappers/useKeyboardIsVisible.native.ts",
  "mingla-business/src/wrappers/KeyboardRoot.native.tsx",
  "mingla-business/src/wrappers/SmartScrollView.native.tsx",
  "mingla-business/src/wrappers/KeyboardToolbarRoot.native.tsx",
  "mingla-business/src/components/groupChat/GroupChatPanel.tsx",
  "mingla-business/src/components/brand/BrandPaystackOnboardView.tsx",
  "mingla-business/src/components/support/SupportThread.native.tsx",
]);

const isTestFile = (p) =>
  /\.(test|spec)\.[jt]sx?$/.test(p) || /(^|\/)__tests__\//.test(p);

// Top-level static RUNTIME import of `pkg` (default / named / namespace / side
// effect). Excludes `import type ...` (erased) and dynamic `import("pkg")` (the
// `[^(;]` class stops before a `(`, so `import(` never matches).
const packageImportPattern = (pkg) => {
  const e = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    // `import <clause> from "pkg"` where clause is not `type ...`
    `(?:^|\\n)\\s*import\\s+(?!type\\b)[^(;]*?\\s+from\\s+["']${e}["']` +
      // side-effect `import "pkg"`
      `|(?:^|\\n)\\s*import\\s+["']${e}["']`,
  );
};

// Bare `expo-file-system` named-import statements, capturing the `type` keyword
// (statement-level) and the brace contents.
const EXPO_FS_IMPORT =
  /(?:^|\n)\s*import\s+(type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*["']expo-file-system["']/g;

// Returns the fragile new-API names value-imported from bare expo-file-system, or
// [] if none (type-only / legacy / absent).
const fragileExpoFsNames = (source) => {
  const found = new Set();
  const re = new RegExp(EXPO_FS_IMPORT.source, "g");
  let m;
  while ((m = re.exec(source)) !== null) {
    if (m[1]) continue; // `import type { ... }` — erased, allowed.
    for (const raw of m[2].split(",")) {
      const name = raw.trim();
      if (!name) continue;
      if (/^type\s+/.test(name)) continue; // inline `type File` — erased.
      const local = name.split(/\s+as\s+/)[0].trim();
      if (EXPO_FS_NEW_API.includes(local)) found.add(local);
    }
  }
  return [...found];
};

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
    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
    if (isTestFile(relativePath)) continue;
    const source = fs.readFileSync(absolutePath, "utf8");
    const grandfathered = ALLOWLIST.has(relativePath);

    for (const pkg of fragilePackages) {
      if (!packageImportPattern(pkg).test(source)) continue;
      if (grandfathered) continue;
      failures.push(
        `${relativePath}: top-level static import of boot-fragile native module "${pkg}". ` +
          `Import it lazily inside the function ('const { X } = await import("${pkg}")') so it is not ` +
          `evaluated during Expo Router's eager boot-time route load (→ splash brick on OTA).`,
      );
    }

    const fsNames = fragileExpoFsNames(source);
    if (fsNames.length && !grandfathered) {
      failures.push(
        `${relativePath}: top-level import of expo-file-system new-API {${fsNames.join(", ")}}. ` +
          `Use a lazy 'const { ${fsNames[0]} } = await import("expo-file-system")' inside the function ` +
          `(or 'expo-file-system/legacy'), so it is not evaluated at boot (→ splash brick on OTA).`,
      );
    }
  }
};

// ---- Self-test: proves the gate catches the ORCH-1295 mistake and allows the fix.
if (process.argv.includes("--self-test")) {
  const cases = [
    ["top-level expo/fetch", 'import { fetch as f } from "expo/fetch";', true, (s) => packageImportPattern("expo/fetch").test(s)],
    ["dynamic expo/fetch", 'const { fetch: f } = await import("expo/fetch");', false, (s) => packageImportPattern("expo/fetch").test(s)],
    ["side-effect keyboard", 'import "react-native-keyboard-controller";', true, (s) => packageImportPattern("react-native-keyboard-controller").test(s)],
    ["type-only posthog", 'import type { PostHog } from "posthog-react-native";', false, (s) => packageImportPattern("posthog-react-native").test(s)],
    ["top-level File", 'import { File } from "expo-file-system";', true, (s) => fragileExpoFsNames(s).length > 0],
    ["type-only File", 'import type { File } from "expo-file-system";', false, (s) => fragileExpoFsNames(s).length > 0],
    ["inline type File", 'import { type File } from "expo-file-system";', false, (s) => fragileExpoFsNames(s).length > 0],
    ["legacy allowed", 'import { readAsStringAsync } from "expo-file-system/legacy";', false, (s) => fragileExpoFsNames(s).length > 0],
    ["default+named File", 'import FS, { File } from "expo-file-system";', true, (s) => fragileExpoFsNames(s).length > 0],
    ["non-fragile fs name", 'import { Paths as P } from "expo-file-system";', true, (s) => fragileExpoFsNames(s).length > 0],
  ];
  const selfFailures = [];
  for (const [label, src, expect, fn] of cases) {
    const got = fn(src);
    if (got !== expect) selfFailures.push(`SELF-TEST "${label}": expected ${expect}, got ${got}`);
  }
  if (selfFailures.length) {
    console.error("ORCH-1296 gate SELF-TEST FAILED:");
    selfFailures.forEach((f) => console.error("  - " + f));
    process.exit(1);
  }
  console.log(`ORCH-1296 gate self-test PASS (${cases.length}/${cases.length} cases).`);
  process.exit(0);
}

// ---- npm wiring check: the gate must be wired into package.json.
const checkNpmWiring = () => {
  const packageJsonPath = path.join(root, "mingla-business/package.json");
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch (error) {
    failures.push(`ORCH-1296 wiring: mingla-business/package.json parse failed: ${error.message}`);
    return;
  }
  const script = packageJson.scripts?.["test:orch-1296"];
  if (
    typeof script !== "string" ||
    !script.includes("orch-1296-no-toplevel-boot-fragile-native-import.mjs")
  ) {
    failures.push(
      `ORCH-1296 wiring: mingla-business/package.json missing scripts["test:orch-1296"] pointing at the gate script.`,
    );
  }
};

checkedRoots.forEach((relativeRoot) => walk(path.join(root, relativeRoot)));
checkNpmWiring();

if (failures.length) {
  console.error("ORCH-1296 boot-fragile native-import gate FAILED:");
  failures.forEach((failure) => console.error("  - " + failure));
  process.exit(1);
}
console.log(
  `ORCH-1296 gate PASS: no NEW top-level boot-fragile native imports ` +
    `(${fragilePackages.join(", ")}, expo-file-system {${EXPO_FS_NEW_API.join("/")}}).`,
);
