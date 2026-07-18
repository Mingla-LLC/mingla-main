#!/usr/bin/env node
/**
 * ORCH-1386 [PR #925 residue — native bundling of BOTH apps broken
 * (`buffer`/react-native-svg) + disguised unvetted expo 54→57 major bump
 * with unsupported RN pairing] — I-PROPOSED-1386-FRAMEWORK-MAJOR-GUARD.
 *
 * WHY: Dependabot PR #925 ("bump the npm_and_yarn group … 15 updates" — a
 * "security batch") smuggled a MAJOR framework jump into both mobile apps:
 * `expo ~54.0.34 → ~57.0.6` with react-native left at 0.81.5 — an
 * UNSUPPORTED Expo-SDK/react-native pairing — plus a transitive-only
 * `@expo/*` 54→57 rewrite inside the lockfiles. It FAILED the required
 * web-build check and was merged red anyway. Result: every native bundle of
 * BOTH apps failed (`Unable to resolve module buffer from
 * node_modules/react-native-svg/src/utils/fetchData.ts`), EAS builds / OTA /
 * business-web deploys were frozen (ORCH-1386 HOLD), and the JS runtime had
 * ZERO QA. A major framework upgrade must be a DELIBERATE human project,
 * never a rider on a dependency batch.
 *
 * ASSERTS (registry-pinned; writer-independent — catches Dependabot, humans,
 * and disguised batches alike, with NO dependence on git diff or commit
 * messages, so it is immune to the COMMS-0106 HEAD-only-token trap and the
 * COMMS-0109 stale-rerun-snapshot trap):
 *  A. MANIFEST: for each app in the registry, every framework-family
 *     dependency declared in that app's package.json (deps+devDeps) is
 *     listed in the registry with the SAME major line, and every registry
 *     entry still exists in the manifest. New family dep → must be
 *     registered. Major moved → gate fails.
 *  B. LOCKFILE (the #925 transitive-disguise catcher): every resolved
 *     framework-family package in each app's package-lock.json carries a
 *     major line inside that app's registry allow-list. A lockfile-only
 *     family major (manifest untouched — exactly how `@expo/metro-config`
 *     went 54→57 under #925) fails the gate.
 *  C. PAIRING: each mobile app's `expo` major line must be a key of
 *     EXPO_RN_PAIRING and its `react-native` major line must equal the
 *     mapped value; both mobile apps must agree on the expo major line
 *     (release-parity: both apps ship the same framework).
 *
 * Framework family (per the ORCH-1386 dispatch): expo, @expo/*,
 * react-native, @react-native/*, react, next, vite, metro (+ metro-*).
 * react-dom is included deliberately: it versions in lockstep with react,
 * so a react-dom-only major IS the disguise shape this gate exists to stop.
 *
 * DELIBERATE-UPGRADE PATH (the only sanctioned way to move a major):
 *   1. Open a dedicated human PR for the framework upgrade (its own ORCH —
 *      pairing research, native rebuild, full QA; never a dep-batch rider).
 *   2. Update EXPO_RN_PAIRING below if the Expo SDK / react-native pairing
 *      changes (source: the Expo SDK release notes' supported pairing).
 *   3. Regenerate the registry: `node orch-1386-framework-major-guard.mjs
 *      --print-registry > orch-1386-framework-major-registry.json` and
 *      commit the diff — the registry diff IS the reviewable approval act.
 *   4. CI stays red until the registry commit lands in the SAME PR.
 *
 * A revert that bumps `expo` back to 57 (or any future undeclared family
 * major) must FAIL CI. `--self-test` proves it.
 *
 * Exit codes: 0 clean, 1 violation, 2 script error / inconclusive.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, "..", "..", "..");

export const REGISTRY_FILE = path.join(
  __dirname,
  "orch-1386-framework-major-registry.json",
);

/** Apps under guard — the four directories #925 rewrote. */
export const GUARDED_APPS = [
  "app-mobile",
  "mingla-business",
  "mingla-admin",
  "mingla-marketing",
];

/** Mobile apps that must satisfy the Expo-SDK/react-native pairing. */
export const MOBILE_APPS = ["app-mobile", "mingla-business"];

/**
 * Supported Expo SDK major → react-native major line. Extend ONLY inside a
 * deliberate framework-upgrade PR (see header). Source of the 54↔0.81 row:
 * Expo SDK 54 ships react-native 0.81 — the pairing the live 1.1.2 binaries
 * run. #925's expo 57 + react-native 0.81.5 pairing was UNSUPPORTED.
 */
export const EXPO_RN_PAIRING = { 54: "0.81" };

/** Framework-family membership (see header for why react-dom is included). */
export function isFrameworkFamily(name) {
  return (
    name === "expo" ||
    name.startsWith("@expo/") ||
    name === "react-native" ||
    name.startsWith("@react-native/") ||
    name === "react" ||
    name === "react-dom" ||
    name === "next" ||
    name === "vite" ||
    name === "metro" ||
    name.startsWith("metro-")
  );
}

/**
 * Reduce a version/range spec to its "major line": "54" for 54.x, "0.81"
 * for 0.81.x (semver: 0.x minors are breaking, so the minor IS the line).
 * Handles ^ ~ >= = v prefixes and prerelease suffixes ("57.0.0-beta.1" →
 * "57"). Returns null for specs with no leading concrete version (`*`,
 * `latest`, `file:`, `git+…`, `workspace:`) — a family dep pinned that
 * loosely is itself a violation and is reported by the callers.
 */
export function majorLineOf(spec) {
  if (typeof spec !== "string") return null;
  const m = spec.trim().match(/^[~^]?[><=\s]*v?(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const major = Number(m[1]);
  if (major === 0) {
    if (m[2] === undefined) return null; // "0" alone pins nothing
    return `0.${Number(m[2])}`;
  }
  return String(major);
}

/** name of a lockfile packages-map path: text after the LAST node_modules/. */
export function lockPathName(p) {
  const i = p.lastIndexOf("node_modules/");
  return i === -1 ? p : p.slice(i + "node_modules/".length);
}

/** All family entries of a parsed package.json (deps + devDeps). */
export function manifestFamilyDeps(pkgJson) {
  const all = {
    ...(pkgJson.dependencies ?? {}),
    ...(pkgJson.devDependencies ?? {}),
  };
  const fam = {};
  for (const [name, spec] of Object.entries(all)) {
    if (isFrameworkFamily(name)) fam[name] = spec;
  }
  return fam;
}

/** Map of family package name → Set of major lines resolved in a lockfile. */
export function lockfileFamilyMajors(lockJson) {
  const out = new Map();
  for (const [p, meta] of Object.entries(lockJson.packages ?? {})) {
    if (!p || !p.includes("node_modules/")) continue;
    const name = lockPathName(p);
    if (!isFrameworkFamily(name)) continue;
    if (!meta || typeof meta.version !== "string") continue;
    const line = majorLineOf(meta.version);
    if (!out.has(name)) out.set(name, new Set());
    out.get(name).add(line === null ? `UNPARSEABLE(${meta.version})` : line);
  }
  return out;
}

/** Check A — manifest majors vs registry. Returns failure strings. */
export function checkManifest(appName, pkgJson, registryApp) {
  const failures = [];
  const pinned = registryApp?.manifest ?? {};
  const fam = manifestFamilyDeps(pkgJson);
  for (const [name, spec] of Object.entries(fam)) {
    const line = majorLineOf(spec);
    if (line === null) {
      failures.push(
        `${appName}/package.json: framework-family dep "${name}" has un-pinnable spec "${spec}" — family deps must carry a concrete major (see ORCH-1386 gate header).`,
      );
      continue;
    }
    if (!(name in pinned)) {
      failures.push(
        `${appName}/package.json: NEW framework-family dep "${name}"@"${spec}" is not in the ORCH-1386 registry — framework majors ride in only via the deliberate-upgrade path (registry diff in the same PR).`,
      );
      continue;
    }
    if (pinned[name] !== line) {
      failures.push(
        `${appName}/package.json: framework MAJOR moved for "${name}" — registry approves major line ${pinned[name]}, manifest now "${spec}" (line ${line}). This is the PR #925 bug class (expo 54→57 merged red inside a "security batch"). Majors move only via the deliberate-upgrade path.`,
      );
    }
  }
  for (const name of Object.keys(pinned)) {
    if (!(name in fam)) {
      failures.push(
        `${appName}/package.json: registry pins framework-family dep "${name}" but the manifest no longer declares it — remove it from the registry via the deliberate-upgrade path (keeps the registry honest).`,
      );
    }
  }
  return failures;
}

/** Check B — lockfile resolved family majors vs registry allow-list. */
export function checkLockfile(appName, lockJson, registryApp) {
  const failures = [];
  const allowed = registryApp?.lockfile ?? {};
  for (const [name, lines] of lockfileFamilyMajors(lockJson)) {
    const allow = allowed[name];
    if (!allow) {
      failures.push(
        `${appName}/package-lock.json: NEW framework-family package "${name}" (major line(s) ${[...lines].join(", ")}) resolved in the lockfile but absent from the ORCH-1386 registry — transitive family additions need the deliberate-upgrade path.`,
      );
      continue;
    }
    for (const line of lines) {
      if (!allow.includes(line)) {
        failures.push(
          `${appName}/package-lock.json: framework-family package "${name}" resolved at major line ${line}, outside the approved set [${allow.join(", ")}]. This is the #925 TRANSITIVE disguise (manifest untouched, lockfile family majors moved — e.g. @expo/metro-config 54→57).`,
        );
      }
    }
  }
  return failures;
}

/** Check C — Expo-SDK/react-native pairing + cross-app expo parity. */
export function checkPairing(manifestsByApp) {
  const failures = [];
  const expoLines = {};
  for (const appName of MOBILE_APPS) {
    const pkgJson = manifestsByApp[appName];
    if (!pkgJson) continue;
    const deps = {
      ...(pkgJson.dependencies ?? {}),
      ...(pkgJson.devDependencies ?? {}),
    };
    const expoLine = majorLineOf(deps.expo);
    const rnLine = majorLineOf(deps["react-native"]);
    expoLines[appName] = expoLine;
    if (expoLine === null || rnLine === null) {
      failures.push(
        `${appName}/package.json: expo ("${deps.expo}") and react-native ("${deps["react-native"]}") must both carry concrete versions for the pairing check.`,
      );
      continue;
    }
    const wantedRn = EXPO_RN_PAIRING[expoLine];
    if (wantedRn === undefined) {
      failures.push(
        `${appName}/package.json: expo major line ${expoLine} has NO approved react-native pairing in EXPO_RN_PAIRING — #925 shipped exactly this (expo 57 with no vetted pairing). Framework upgrades extend the table inside a deliberate upgrade PR.`,
      );
    } else if (wantedRn !== rnLine) {
      failures.push(
        `${appName}/package.json: expo ${expoLine} pairs with react-native ${wantedRn}, but the manifest declares react-native ${rnLine} — unsupported SDK pairing.`,
      );
    }
  }
  const [a, b] = MOBILE_APPS;
  if (
    expoLines[a] !== undefined &&
    expoLines[b] !== undefined &&
    expoLines[a] !== expoLines[b]
  ) {
    failures.push(
      `expo major line differs between ${a} (${expoLines[a]}) and ${b} (${expoLines[b]}) — both apps ship the SAME framework (release-parity rule).`,
    );
  }
  return failures;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Compute a fresh registry object from the current tree. */
export function computeRegistry(rootDir = root) {
  const registry = { apps: {} };
  for (const appName of GUARDED_APPS) {
    const pkgJson = readJson(path.join(rootDir, appName, "package.json"));
    const lockJson = readJson(path.join(rootDir, appName, "package-lock.json"));
    const manifest = {};
    for (const [name, spec] of Object.entries(manifestFamilyDeps(pkgJson))) {
      manifest[name] = majorLineOf(spec);
    }
    const lockfile = {};
    for (const [name, lines] of [...lockfileFamilyMajors(lockJson)].sort(
      (x, y) => x[0].localeCompare(y[0]),
    )) {
      lockfile[name] = [...lines].sort();
    }
    registry.apps[appName] = { manifest, lockfile };
  }
  return registry;
}

/** Run all checks against a tree. Returns failure strings. */
export function runAll(rootDir = root, registry = null) {
  const failures = [];
  let reg = registry;
  if (reg === null) {
    try {
      reg = readJson(REGISTRY_FILE);
    } catch (err) {
      return [
        `Cannot read registry ${REGISTRY_FILE}: ${err.message} — the gate fails closed.`,
      ];
    }
  }
  const manifestsByApp = {};
  for (const appName of GUARDED_APPS) {
    let pkgJson;
    let lockJson;
    try {
      pkgJson = readJson(path.join(rootDir, appName, "package.json"));
      lockJson = readJson(path.join(rootDir, appName, "package-lock.json"));
    } catch (err) {
      failures.push(`Cannot read ${appName} manifest/lockfile: ${err.message}`);
      continue;
    }
    manifestsByApp[appName] = pkgJson;
    const registryApp = reg.apps?.[appName];
    if (!registryApp) {
      failures.push(
        `Registry has no entry for guarded app "${appName}" — regenerate via --print-registry inside a deliberate-upgrade PR.`,
      );
      continue;
    }
    failures.push(...checkManifest(appName, pkgJson, registryApp));
    failures.push(...checkLockfile(appName, lockJson, registryApp));
  }
  failures.push(...checkPairing(manifestsByApp));
  return failures;
}

/* ------------------------------- self-test ------------------------------- */

function selfTest() {
  const results = [];
  const ok = (name, cond) => results.push({ name, pass: !!cond });

  // Fixture registry mirroring the post-revert approved state.
  const reg = {
    apps: {
      "app-mobile": {
        manifest: {
          expo: "54",
          "@expo/vector-icons": "15",
          react: "19",
          "react-dom": "19",
          "react-native": "0.81",
        },
        lockfile: {
          expo: ["54"],
          "@expo/metro-config": ["54"],
          react: ["19"],
          "react-native": ["0.81"],
        },
      },
    },
  };
  const goodPkg = {
    dependencies: {
      expo: "~54.0.34",
      "@expo/vector-icons": "^15.0.2",
      react: "19.1.0",
      "react-dom": "19.1.0",
      "react-native": "0.81.5",
    },
  };
  const regApp = reg.apps["app-mobile"];

  // 1. version parsing incl. prerelease + 0.x + garbage.
  ok(
    "majorLineOf handles pins, ranges, prerelease, 0.x, garbage",
    majorLineOf("~54.0.34") === "54" &&
      majorLineOf("^15.0.2") === "15" &&
      majorLineOf("57.0.0-beta.1") === "57" &&
      majorLineOf(">=19.1.0") === "19" &&
      majorLineOf("0.81.5") === "0.81" &&
      majorLineOf("v54.2.0") === "54" &&
      majorLineOf("*") === null &&
      majorLineOf("latest") === null &&
      majorLineOf("file:../packages/x") === null &&
      majorLineOf(undefined) === null,
  );

  // 2. clean manifest passes.
  ok(
    "approved manifest passes",
    checkManifest("app-mobile", goodPkg, regApp).length === 0,
  );

  // 3. the exact #925 shape — expo major bumped in the manifest — fails.
  const pkg925 = structuredClone(goodPkg);
  pkg925.dependencies.expo = "~57.0.6";
  const f925 = checkManifest("app-mobile", pkg925, regApp);
  ok(
    "#925 shape (expo ~54→~57) fails with major-moved message",
    f925.length === 1 && /MAJOR moved for "expo"/.test(f925[0]),
  );

  // 4. NEW family dep not in registry fails (incl. via devDependencies).
  const pkgNew = structuredClone(goodPkg);
  pkgNew.devDependencies = { metro: "0.83.3" };
  ok(
    "unregistered family dep (devDeps) fails",
    checkManifest("app-mobile", pkgNew, regApp).some((f) =>
      /NEW framework-family dep "metro"/.test(f),
    ),
  );

  // 5. un-pinnable family spec fails.
  const pkgLoose = structuredClone(goodPkg);
  pkgLoose.dependencies.expo = "*";
  ok(
    "un-pinnable family spec fails",
    checkManifest("app-mobile", pkgLoose, regApp).some((f) =>
      /un-pinnable spec/.test(f),
    ),
  );

  // 6. registry entry vanished from manifest fails (stale-registry catch).
  const pkgDropped = structuredClone(goodPkg);
  delete pkgDropped.dependencies["react-dom"];
  ok(
    "manifest missing a registered family dep fails",
    checkManifest("app-mobile", pkgDropped, regApp).some((f) =>
      /no longer declares it/.test(f),
    ),
  );

  // 7. clean lockfile passes.
  const goodLock = {
    packages: {
      "": {},
      "node_modules/expo": { version: "54.0.34" },
      "node_modules/@expo/metro-config": { version: "54.0.15" },
      "node_modules/react": { version: "19.1.0" },
      "node_modules/react-native": { version: "0.81.5" },
      "node_modules/lodash": { version: "4.17.21" },
      "../packages/phone-input": { version: "1.0.0" },
    },
  };
  ok(
    "approved lockfile passes",
    checkLockfile("app-mobile", goodLock, regApp).length === 0,
  );

  // 8. the #925 TRANSITIVE disguise — lockfile-only family major — fails.
  const lockDisguise = structuredClone(goodLock);
  lockDisguise.packages["node_modules/@expo/metro-config"].version = "57.0.5";
  const fT = checkLockfile("app-mobile", lockDisguise, regApp);
  ok(
    "transitive-only family major (lockfile, manifest untouched) fails",
    fT.length === 1 && /TRANSITIVE disguise/.test(fT[0]),
  );

  // 9. NEW family package appearing only in the lockfile fails.
  const lockNew = structuredClone(goodLock);
  lockNew.packages["node_modules/@expo/dom-webview"] = { version: "57.0.1" };
  ok(
    "new lockfile-only family package fails",
    checkLockfile("app-mobile", lockNew, regApp).some((f) =>
      /NEW framework-family package "@expo\/dom-webview"/.test(f),
    ),
  );

  // 10. nested lockfile paths attribute to the right package name.
  ok(
    "nested node_modules path resolves to last segment name",
    lockPathName("node_modules/@expo/metro/node_modules/metro-config") ===
      "metro-config" && lockPathName("../packages/x") === "../packages/x",
  );

  // 11. pairing: approved 54↔0.81 passes on both apps.
  const pairGood = {
    "app-mobile": goodPkg,
    "mingla-business": structuredClone(goodPkg),
  };
  ok("pairing 54↔0.81 both apps passes", checkPairing(pairGood).length === 0);

  // 12. pairing: expo 57 (no table row) fails — the revert-the-revert drill.
  const pairBad = structuredClone(pairGood);
  pairBad["app-mobile"].dependencies.expo = "~57.0.6";
  pairBad["mingla-business"].dependencies.expo = "~57.0.6";
  const fPair = checkPairing(pairBad);
  ok(
    "expo 57 + rn 0.81 fails pairing for both apps",
    fPair.filter((f) => /NO approved react-native pairing/.test(f)).length ===
      2,
  );

  // 13. pairing: prerelease expo spec still parses and fails the table.
  const pairPre = structuredClone(pairGood);
  pairPre["app-mobile"].dependencies.expo = "57.0.0-beta.1";
  ok(
    "prerelease expo spec parses to 57 and fails pairing (not bypassed)",
    checkPairing(pairPre).some((f) =>
      /expo major line 57 has NO approved react-native pairing/.test(f),
    ),
  );

  // 14. pairing: cross-app expo parity violation fails.
  const pairSplit = structuredClone(pairGood);
  pairSplit["mingla-business"].dependencies.expo = "~55.0.0";
  ok(
    "expo major differing between the two apps fails parity",
    checkPairing(pairSplit).some((f) => /differs between/.test(f)),
  );

  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
  }
  if (failed.length > 0) {
    console.error(
      `ORCH-1386 framework-major-guard self-test FAIL (${failed.length}/${results.length}).`,
    );
    process.exit(2);
  }
  console.log(
    `ORCH-1386 framework-major-guard self-test PASS (${results.length}/${results.length} cases).`,
  );
}

/* --------------------------------- main ---------------------------------- */

const argv = process.argv.slice(2);
const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  try {
    if (argv.includes("--self-test")) {
      selfTest();
    } else if (argv.includes("--print-registry")) {
      console.log(JSON.stringify(computeRegistry(), null, 2));
    } else {
      const failures = runAll();
      if (failures.length > 0) {
        console.error(
          `ORCH-1386 framework-major-guard FAIL (${failures.length} violation(s)):\n`,
        );
        for (const f of failures) console.error("  - " + f);
        console.error(
          "\nFramework majors move ONLY via the deliberate-upgrade path (see the header of .github/scripts/strict-grep/orch-1386-framework-major-guard.mjs). PR #925 is why.",
        );
        process.exit(1);
      }
      console.log(
        "ORCH-1386 framework-major-guard PASS — all framework-family majors match the approved registry; expo/react-native pairing supported; cross-app expo parity holds.",
      );
    }
  } catch (err) {
    console.error(`ORCH-1386 framework-major-guard script error: ${err.stack}`);
    process.exit(2);
  }
}
