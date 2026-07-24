#!/usr/bin/env node
/**
 * ORCH-1130 [Dependabot smuggles Expo 54→57 into app-mobile + mingla-business
 * via grouped transitive postcss bumps] — I-PROPOSED-1130-POSTCSS-TRANSITIVE-PATCHED.
 *
 * WHY: postcss < 8.5.10 (GHSA-qx2v-qp2m-jg93 / CVE-2026-41305 — XSS via an
 * unescaped `</style>` in stringify) is a VULNERABLE TRANSITIVE dependency of
 * both Expo-54 apps: it is pulled in only through `@expo/metro-config`, whose
 * Expo-54 line permits `~8.4.x`, so the tree resolved `postcss@8.4.49`. A
 * Dependabot SECURITY update for a vulnerable *transitive* npm package unlocks
 * the editable PARENT to reach a safe version — and the only published Expo tree
 * whose `@expo/metro-config` allows `postcss ^8.5.14` is the 57 line. Dependabot
 * therefore rewrites the top-level `expo` manifest entry `~54.0.34 → ~57.0.7`
 * (PR #1053) to "fix" postcss. Expo 57 is BANNED — it broke native EAS builds
 * three times (#925, ORCH-1398, #1051). No `expo`-keyed `ignore` in
 * `.github/dependabot.yml` is ever consulted, because expo is the *dragged
 * parent*, never the update *subject* (INVESTIGATION F-4).
 *
 * THE FIX THIS GATE PROTECTS: pin `postcss` forward to a non-vulnerable,
 * Expo-54-compatible version via a top-level npm `overrides` block in each app's
 * package.json (`"overrides": { "postcss": "^8.5.21" }`) and regenerate the
 * lockfile so `postcss` resolves ≥ 8.5.10. The security alert clears, Dependabot
 * has no reason to unlock the `expo` parent, and the poisoned 54→57 PR is never
 * generated — while the expo-54 pin, the dependabot.yml expo ignores, and the
 * ORCH-1386 framework-major guard all stay ACTIVE and untouched.
 *
 * DO NOT REMOVE THE OVERRIDE. Deleting `overrides.postcss` (or letting any
 * resolved `postcss` node drift back below 8.5.10) re-arms the exact
 * transitive-security → expo-parent-unlock drag this gate exists to prevent.
 *
 * ASSERTS (for BOTH app-mobile and mingla-business — the two Expo-54 apps):
 *  A. MANIFEST: package.json declares a top-level `overrides.postcss` whose
 *     guaranteed lower bound is ≥ the advisory floor (8.5.10). A missing
 *     override, or a floor below 8.5.10 (e.g. `^8.4.49`, `<8.5.10`, `*`), fails.
 *  B. LOCKFILE: every resolved postcss node (top-level `node_modules/postcss`
 *     and any nested `.../node_modules/postcss`) in
 *     package-lock.json is ≥ 8.5.10, and at least one postcss node exists (a
 *     lockfile that resolves ZERO postcss nodes is a rewritten tree, not a pass —
 *     the "green because it matched nothing" mode is a FAILURE here).
 *
 * RELATIONSHIP TO ORCH-1386: ORCH-1386 is the DESTINATION guard — it fails any
 * PR that actually moves a framework-family major (the 54→57 rewrite). This gate
 * (ORCH-1130) is the SOURCE guard — it removes Dependabot's *reason* to attempt
 * the move. Defense-in-depth; both fail-on-revert, neither replaces the other.
 *
 * A revert that deletes the override, or a lockfile that regresses postcss below
 * 8.5.10, must FAIL CI. `--self-test` proves both directions.
 *
 * Exit codes: 0 clean, 1 violation, 2 script error / inconclusive.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, "..", "..", "..");

/** The two Expo-54 apps that resolve postcss transitively under @expo/metro-config. */
export const GUARDED_APPS = ["app-mobile", "mingla-business"];

/**
 * The advisory floor for GHSA-qx2v-qp2m-jg93: postcss is fixed in 8.5.10+.
 * Any resolved postcss < this, or any override whose floor is below this, fails.
 */
export const ADVISORY_FLOOR = [8, 5, 10];

/**
 * Parse a version or range lower-bound into [major, minor, patch]. Strips a
 * leading run of range operators (`^ ~ >= = v` and whitespace), then reads the
 * first concrete numeric triple, padding a missing minor/patch with 0. Returns
 * null for specs with no leading concrete version (`*`, `latest`, `<8.5.10`,
 * `file:`, `git+…`, `workspace:`, objects) — an override that loose cannot
 * guarantee a floor and is reported as a violation by the caller.
 */
export function versionFloor(spec) {
  if (typeof spec !== "string") return null;
  const stripped = spec.trim().replace(/^[\^~>=v\s]+/, "");
  const m = stripped.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** a >= b for [major, minor, patch] tuples. */
export function gte(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

/** Format a tuple as a dotted string for messages. */
function fmt(v) {
  return v.join(".");
}

/** name of a lockfile packages-map path: text after the LAST node_modules/. */
export function lockPathName(p) {
  const i = p.lastIndexOf("node_modules/");
  return i === -1 ? p : p.slice(i + "node_modules/".length);
}

/** All resolved postcss nodes in a parsed lockfile: [{ path, version }]. */
export function postcssNodes(lockJson) {
  const out = [];
  for (const [p, meta] of Object.entries(lockJson.packages ?? {})) {
    if (!p || !p.includes("node_modules/")) continue;
    if (lockPathName(p) !== "postcss") continue;
    if (!meta || typeof meta.version !== "string") continue;
    out.push({ path: p, version: meta.version });
  }
  return out;
}

/** Check A — the manifest override pins postcss forward. Returns failure strings. */
export function checkOverride(appName, pkgJson) {
  const failures = [];
  const spec = pkgJson?.overrides?.postcss;
  if (spec === undefined) {
    failures.push(
      `${appName}/package.json: missing the ORCH-1130 pin — a top-level "overrides": { "postcss": "^8.5.21" } (floor ≥ ${fmt(ADVISORY_FLOOR)}) must be present. Removing it re-arms the Dependabot expo 54→57 transitive drag (GHSA-qx2v-qp2m-jg93). DO NOT REMOVE THE OVERRIDE.`,
    );
    return failures;
  }
  if (typeof spec !== "string") {
    failures.push(
      `${appName}/package.json: "overrides.postcss" must be a version-range string (e.g. "^8.5.21"), got ${JSON.stringify(spec)}.`,
    );
    return failures;
  }
  const floor = versionFloor(spec);
  if (floor === null) {
    failures.push(
      `${appName}/package.json: "overrides.postcss" = "${spec}" has no guaranteed lower bound ≥ ${fmt(ADVISORY_FLOOR)} — pin it to a caret/tilde/exact range whose floor clears the GHSA-qx2v-qp2m-jg93 advisory (e.g. "^8.5.21").`,
    );
    return failures;
  }
  if (!gte(floor, ADVISORY_FLOOR)) {
    failures.push(
      `${appName}/package.json: "overrides.postcss" = "${spec}" (floor ${fmt(floor)}) is BELOW the advisory floor ${fmt(ADVISORY_FLOOR)}. postcss must stay ≥ ${fmt(ADVISORY_FLOOR)} (GHSA-qx2v-qp2m-jg93) so no vulnerable-transitive alert can unlock the expo parent.`,
    );
  }
  return failures;
}

/** Check B — every resolved postcss node clears the advisory floor. */
export function checkLockfile(appName, lockJson) {
  const failures = [];
  const nodes = postcssNodes(lockJson);
  if (nodes.length === 0) {
    failures.push(
      `${appName}/package-lock.json: resolves ZERO postcss nodes. postcss is a required transitive of @expo/metro-config under Expo 54 — its total absence means the tree was rewritten. This gate fails closed rather than pass vacuously.`,
    );
    return failures;
  }
  for (const { path: p, version } of nodes) {
    const v = versionFloor(version);
    if (v === null) {
      failures.push(
        `${appName}/package-lock.json: "${p}" has an unparseable postcss version "${version}".`,
      );
      continue;
    }
    if (!gte(v, ADVISORY_FLOOR)) {
      failures.push(
        `${appName}/package-lock.json: "${p}" resolves postcss ${version}, BELOW the advisory floor ${fmt(ADVISORY_FLOOR)} (GHSA-qx2v-qp2m-jg93). Regenerate the lockfile with the overrides.postcss pin applied (npm install --package-lock-only).`,
      );
    }
  }
  return failures;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Run both checks against a tree for every guarded app. Returns failure strings. */
export function runAll(rootDir = root) {
  const failures = [];
  for (const appName of GUARDED_APPS) {
    let pkgJson;
    let lockJson;
    try {
      pkgJson = readJson(path.join(rootDir, appName, "package.json"));
      lockJson = readJson(path.join(rootDir, appName, "package-lock.json"));
    } catch (err) {
      failures.push(`Cannot read ${appName} manifest/lockfile: ${err.message} — the gate fails closed.`);
      continue;
    }
    failures.push(...checkOverride(appName, pkgJson));
    failures.push(...checkLockfile(appName, lockJson));
  }
  return failures;
}

/* ------------------------------- self-test ------------------------------- */

function selfTest() {
  const results = [];
  const ok = (name, cond) => results.push({ name, pass: !!cond });

  // 1. version-floor parsing: ranges, exacts, padding, and the un-pinnable set.
  ok(
    "versionFloor handles caret/tilde/gte/exact, padding, and rejects loose specs",
    fmt(versionFloor("^8.5.21")) === "8.5.21" &&
      fmt(versionFloor("~8.5.21")) === "8.5.21" &&
      fmt(versionFloor(">=8.5.10")) === "8.5.10" &&
      fmt(versionFloor("8.5.22")) === "8.5.22" &&
      fmt(versionFloor("8.6")) === "8.6.0" &&
      fmt(versionFloor("8")) === "8.0.0" &&
      versionFloor("<8.5.10") === null &&
      versionFloor("*") === null &&
      versionFloor("latest") === null &&
      versionFloor(undefined) === null &&
      versionFloor({ ".": "^8.5.21" }) === null,
  );

  // 2. gte tuple comparison incl. the exact advisory boundary.
  ok(
    "gte compares major.minor.patch correctly at the 8.5.10 boundary",
    gte([8, 5, 10], ADVISORY_FLOOR) === true &&
      gte([8, 5, 22], ADVISORY_FLOOR) === true &&
      gte([8, 6, 0], ADVISORY_FLOOR) === true &&
      gte([9, 0, 0], ADVISORY_FLOOR) === true &&
      gte([8, 5, 9], ADVISORY_FLOOR) === false &&
      gte([8, 4, 49], ADVISORY_FLOOR) === false &&
      gte([8, 0, 0], ADVISORY_FLOOR) === false,
  );

  // 3. clean manifest override passes.
  const goodPkg = { overrides: { postcss: "^8.5.21" } };
  ok("approved override (^8.5.21) passes", checkOverride("app-mobile", goodPkg).length === 0);

  // 4. THE REVERT (T2): override deleted entirely — fails with the protective message.
  const noOverridesPkg = { dependencies: {}, devDependencies: {} };
  const fNoOverride = checkOverride("app-mobile", noOverridesPkg);
  ok(
    "missing overrides block fails (fails-on-revert T2)",
    fNoOverride.length === 1 && /DO NOT REMOVE THE OVERRIDE/.test(fNoOverride[0]),
  );

  // 5. overrides present but postcss key missing — fails.
  ok(
    "overrides without a postcss key fails",
    checkOverride("app-mobile", { overrides: { foo: "1.0.0" } }).some((f) =>
      /missing the ORCH-1130 pin/.test(f),
    ),
  );

  // 6. override floor below the advisory floor — fails.
  ok(
    "override floor below 8.5.10 fails (^8.4.49)",
    checkOverride("app-mobile", { overrides: { postcss: "^8.4.49" } }).some((f) =>
      /BELOW the advisory floor/.test(f),
    ),
  );

  // 7. an un-pinnable override range — fails.
  ok(
    "un-pinnable override (<8.5.10) fails",
    checkOverride("app-mobile", { overrides: { postcss: "<8.5.10" } }).some((f) =>
      /no guaranteed lower bound/.test(f),
    ),
  );

  // 8. a non-string override value — fails.
  ok(
    "non-string override value fails",
    checkOverride("app-mobile", { overrides: { postcss: { ".": "^8.5.21" } } }).some((f) =>
      /must be a version-range string/.test(f),
    ),
  );

  // 9. clean lockfile (all postcss ≥ floor, incl. a nested node) passes.
  const goodLock = {
    packages: {
      "": {},
      "node_modules/postcss": { version: "8.5.22" },
      "node_modules/@some/tool/node_modules/postcss": { version: "8.5.10" },
      "node_modules/lodash": { version: "4.17.21" },
    },
  };
  ok("lockfile with all postcss ≥ 8.5.10 (incl. nested) passes", checkLockfile("app-mobile", goodLock).length === 0);

  // 10. THE REVERT (T3): a postcss node regressed to 8.4.49 — fails by path + version.
  const vulnLock = structuredClone(goodLock);
  vulnLock.packages["node_modules/postcss"].version = "8.4.49";
  const fVuln = checkLockfile("app-mobile", vulnLock);
  ok(
    "lockfile postcss regressed to 8.4.49 fails (fails-on-revert T3)",
    fVuln.length === 1 && /BELOW the advisory floor/.test(fVuln[0]) && /8\.4\.49/.test(fVuln[0]),
  );

  // 11. a nested postcss node below the floor is caught even when the top-level is safe.
  const nestedVuln = structuredClone(goodLock);
  nestedVuln.packages["node_modules/@some/tool/node_modules/postcss"].version = "8.4.31";
  ok(
    "nested vulnerable postcss node (8.4.31) is caught",
    checkLockfile("app-mobile", nestedVuln).some((f) => /8\.4\.31/.test(f) && /BELOW the advisory floor/.test(f)),
  );

  // 12. zero postcss nodes in the lockfile is a FAILURE, never a vacuous pass.
  ok(
    "lockfile resolving zero postcss nodes fails (anti-vacuous)",
    checkLockfile("app-mobile", { packages: { "": {}, "node_modules/lodash": { version: "4.17.21" } } }).some((f) =>
      /ZERO postcss nodes/.test(f),
    ),
  );

  // 13. nested lockfile paths attribute to the last path segment (postcss vs not-postcss).
  ok(
    "lockPathName resolves the last node_modules segment",
    lockPathName("node_modules/@some/tool/node_modules/postcss") === "postcss" &&
      lockPathName("node_modules/postcss-loader") === "postcss-loader",
  );

  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
  }
  if (failed.length > 0) {
    console.error(
      `ORCH-1130 postcss-transitive-pin-check self-test FAIL (${failed.length}/${results.length}).`,
    );
    process.exit(2);
  }
  console.log(
    `ORCH-1130 postcss-transitive-pin-check self-test PASS (${results.length}/${results.length} cases).`,
  );
}

/* --------------------------------- main ---------------------------------- */

const argv = process.argv.slice(2);
const isMain =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  try {
    if (argv.includes("--self-test")) {
      selfTest();
    } else {
      const failures = runAll();
      if (failures.length > 0) {
        console.error(
          `ORCH-1130 postcss-transitive-pin-check FAIL (${failures.length} violation(s)):\n`,
        );
        for (const f of failures) console.error("  - " + f);
        console.error(
          "\npostcss must stay pinned ≥ 8.5.10 via overrides in BOTH Expo-54 apps so Dependabot has no vulnerable-transitive reason to unlock the expo parent (see the header of .github/scripts/strict-grep/orch-1130-postcss-transitive-pin-check.mjs). Issue #1130 / GHSA-qx2v-qp2m-jg93.",
        );
        process.exit(1);
      }
      console.log(
        "ORCH-1130 postcss-transitive-pin-check PASS — overrides.postcss pins ≥ 8.5.10 in both Expo-54 apps and every resolved postcss node clears the advisory floor.",
      );
    }
  } catch (err) {
    console.error(`ORCH-1130 postcss-transitive-pin-check script error: ${err.stack}`);
    process.exit(2);
  }
}
