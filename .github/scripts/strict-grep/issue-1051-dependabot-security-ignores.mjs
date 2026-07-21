#!/usr/bin/env node
/**
 * ISSUE #1051 — DEPENDABOT'S FRAMEWORK-FAMILY IGNORES MUST BIND THE
 * SECURITY-UPDATE PATH, NOT ONLY THE VERSION-UPDATE PATH.
 * I-PROPOSED-1051-DEPENDABOT-SECURITY-IGNORES.
 *
 * WHY THIS GATE EXISTS
 * --------------------
 * `expo` was re-bumped from the pinned SDK 54 to the native-build-breaking
 * SDK 57 THREE times (#925, then #935/#936, then #944/#945) — each time by a
 * Dependabot PR whose TITLE described a postcss patch and whose DIFF moved an
 * Expo major. `.github/dependabot.yml` already carried `ignore` rules naming
 * `expo` each time, and Dependabot proposed the bump anyway.
 *
 * Reading the actual #944/#945 diffs established TWO facts:
 *
 *   1. THE PATH WAS SECURITY UPDATES, WHERE `update-types:` IS INERT.
 *      Dependabot `ignore` conditions written as
 *      `update-types: ["version-update:semver-major"]` bind VERSION updates
 *      only. Security updates honour `dependency-name:` and `versions:` and
 *      nothing else. All three recurrences came through the security path —
 *      the PR titles say "in the npm_and_yarn group", and `open-pull-requests-
 *      limit: 0` failed to suppress them because security updates carry their
 *      own internal limit that config cannot change. So EVERY ignore entry in
 *      the file was decorative against the only path that was ever used.
 *
 *   2. THE MECHANISM WAS npm TRANSITIVE-DEPENDENCY UNLOCKING (parent bump).
 *      The advertised subject was `postcss 8.4.49 → 8.5.19`. postcss is not a
 *      direct dependency of either mobile app — it is reachable ONLY through
 *      `@expo/metro-config`, which on the Expo-54 line pins `postcss ~8.4.32`,
 *      a range that cannot reach 8.5.19. Dependabot therefore rewrote the
 *      PARENT it could edit: the top-level `expo` entry, ~54.0.34 → ~57.0.7,
 *      because Expo 57's @expo/metro-config allows `postcss ^8.5.14`.
 *
 * THE RULE THIS GATE ENFORCES
 * ---------------------------
 * For EVERY directory in `.github/dependabot.yml`, each framework-family
 * dependency must be ignored in BOTH forms:
 *   A. the original ORCH-1386 `update-types:` entry  (version-update path), AND
 *   B. a `versions:` entry with a lower bound             (security-update path).
 * Satisfying B by DELETING A is a weakening and fails this gate — the two
 * cover different paths and both are required.
 *
 * The `expo` bound is not a literal: it is derived from
 * orch-1386-framework-major-registry.json (approved major line + 1), so the
 * config cannot silently drift away from the registry that ORCH-1386 pins.
 *
 * WHAT THIS GATE DOES *NOT* CLAIM
 * -------------------------------
 * Whether Dependabot consults ignore conditions for a package it edits as an
 * UNLOCK PARENT — rather than as the named subject of the update — is not
 * observable from outside GitHub. This file therefore asserts defence-in-depth,
 * not a proof of prevention. The load-bearing controls remain
 * orch-1398-expo-pinned-54.mjs + orch-1386-framework-major-guard.mjs, and
 * branch protection making them REQUIRED (issue #1051, owner: Seth) — all
 * three recurrences were merged while those gates were red.
 *
 * `--self-test` proves the gate fails in all four regression directions.
 * Exit codes: 0 clean, 1 violation, 2 script error / inconclusive.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const DEPENDABOT_FILE = path.join(REPO_ROOT, ".github", "dependabot.yml");
const REGISTRY_FILE = path.join(
  __dirname,
  "orch-1386-framework-major-registry.json",
);

/**
 * Family names that MUST carry a `versions:` (security-effective) ignore in
 * every directory block. Mirrors the ORCH-1386 dependabot header's family list.
 */
export const REQUIRE_VERSIONS = [
  "expo",
  "@expo/*",
  "react-native",
  "@react-native/*",
  "react",
  "react-dom",
  "next",
  "vite",
  "metro",
  "metro-*",
];

/**
 * Family names whose ORIGINAL ORCH-1386 `update-types:` entry must SURVIVE.
 * Listing them separately is the anti-weakening assertion: you may not satisfy
 * the new rule by replacing the old entries.
 */
export const REQUIRE_UPDATE_TYPES = [...REQUIRE_VERSIONS];

/** Lowest version a `versions:` bound must exclude, per family name. */
export function requiredExpoBound(registry) {
  const lines = [];
  for (const app of Object.keys(registry.apps ?? {})) {
    const spec = registry.apps[app]?.manifest?.expo;
    if (spec != null) lines.push(Number(spec));
  }
  if (lines.length === 0 || lines.some((n) => !Number.isFinite(n))) return null;
  return Math.max(...lines) + 1;
}

/**
 * Parse the lower bound out of a `versions:` list. Accepts ">= 55", ">=55",
 * "> 54". Returns the smallest version the entry EXCLUDES, or null.
 */
export function lowerBoundOf(versions) {
  if (!Array.isArray(versions)) return null;
  for (const v of versions) {
    const m = String(v).trim().match(/^(>=|>)\s*v?(\d+)(?:\.(\d+))?/);
    if (!m) continue;
    const major = Number(m[2]);
    const minor = m[3] === undefined ? null : Number(m[3]);
    return { op: m[1], major, minor };
  }
  return null;
}

export function checkConfig(doc, registry) {
  const violations = [];
  const expoBound = requiredExpoBound(registry);
  if (expoBound === null) {
    violations.push(
      "orch-1386-framework-major-registry.json: could not derive the approved `expo` major line — cannot validate the dependabot bound.",
    );
    return violations;
  }

  const updates = doc?.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    violations.push(".github/dependabot.yml: no `updates:` entries found.");
    return violations;
  }

  for (const block of updates) {
    const dir = block?.directory ?? "<unknown directory>";
    const ignore = Array.isArray(block?.ignore) ? block.ignore : [];

    const withVersions = new Map();
    const withUpdateTypes = new Set();
    for (const e of ignore) {
      const name = e?.["dependency-name"];
      if (typeof name !== "string") continue;
      if (Array.isArray(e?.versions) && e.versions.length > 0) {
        withVersions.set(name, e.versions);
      }
      if (Array.isArray(e?.["update-types"]) && e["update-types"].length > 0) {
        withUpdateTypes.add(name);
      }
    }

    for (const name of REQUIRE_UPDATE_TYPES) {
      if (!withUpdateTypes.has(name)) {
        violations.push(
          `${dir}: the ORCH-1386 \`update-types:\` ignore for "${name}" is MISSING. ` +
            "It binds the version-update path and must not be deleted — the new " +
            "`versions:` entries are ADDITIVE, not a replacement.",
        );
      }
    }

    for (const name of REQUIRE_VERSIONS) {
      if (!withVersions.has(name)) {
        violations.push(
          `${dir}: framework-family dependency "${name}" has no \`versions:\` ignore condition. ` +
            "`update-types:` alone is INERT on the Dependabot SECURITY-update path — the path " +
            "that re-bumped expo 54→57 three times (#925, #935/#936, #944/#945). Add a " +
            "`versions:` bound (issue #1051).",
        );
      }
    }

    const expoVersions = withVersions.get("expo");
    if (expoVersions) {
      const bound = lowerBoundOf(expoVersions);
      if (bound === null) {
        violations.push(
          `${dir}: the \`versions:\` ignore for "expo" (${JSON.stringify(expoVersions)}) has no parseable ` +
            '">=" / ">" lower bound, so it excludes nothing.',
        );
      } else if (bound.major > expoBound) {
        violations.push(
          `${dir}: the \`versions:\` ignore for "expo" starts at ${bound.major}, which LETS ` +
            `expo ${expoBound}..${bound.major - 1} through. The ORCH-1386 registry approves expo ` +
            `major line ${expoBound - 1}, so the bound must be ">= ${expoBound}" or lower. ` +
            "Expo 57 broke native builds; do not widen this.",
        );
      }
    }
  }

  return violations;
}

// --------------------------------------------------------------------------
// self-test
// --------------------------------------------------------------------------

const FIXTURE_REGISTRY = {
  apps: {
    "app-mobile": { manifest: { expo: "54" } },
    "mingla-business": { manifest: { expo: "54" } },
  },
};

function fixtureDoc() {
  const ignore = [];
  for (const name of REQUIRE_UPDATE_TYPES) {
    ignore.push({
      "dependency-name": name,
      "update-types": ["version-update:semver-major"],
    });
  }
  for (const name of REQUIRE_VERSIONS) {
    ignore.push({
      "dependency-name": name,
      versions: [name === "expo" ? ">= 55" : ">= 999"],
    });
  }
  return { updates: [{ directory: "/app-mobile", ignore }] };
}

function selfTest() {
  const failures = [];
  const expect = (label, doc, shouldFail, needle) => {
    const v = checkConfig(doc, FIXTURE_REGISTRY);
    const failed = v.length > 0;
    if (failed !== shouldFail) {
      failures.push(
        `${label}: expected ${shouldFail ? "FAIL" : "PASS"} but got ${failed ? "FAIL" : "PASS"} — ${JSON.stringify(v)}`,
      );
      return;
    }
    if (shouldFail && needle && !v.some((m) => m.includes(needle))) {
      failures.push(`${label}: failed for the wrong reason — ${JSON.stringify(v)}`);
    }
  };

  // Direction 1 — the shipped shape passes.
  expect("compliant config PASSES", fixtureDoc(), false);

  // Direction 2 — the PRE-#1051 shape (update-types only) FAILS. This is the
  // exact config that let #925 / #935+#936 / #944+#945 through.
  const noVersions = fixtureDoc();
  noVersions.updates[0].ignore = noVersions.updates[0].ignore.filter(
    (e) => !e.versions,
  );
  expect("update-types-only config FAILS", noVersions, true, "no `versions:` ignore condition");

  // Direction 3 — satisfying the new rule by DELETING the ORCH-1386 entries
  // FAILS (anti-weakening).
  const noUpdateTypes = fixtureDoc();
  noUpdateTypes.updates[0].ignore = noUpdateTypes.updates[0].ignore.filter(
    (e) => !e["update-types"],
  );
  expect("deleting the ORCH-1386 update-types entries FAILS", noUpdateTypes, true, "is MISSING");

  // Direction 4 — a bound loose enough to readmit expo 57 FAILS.
  const looseExpo = fixtureDoc();
  for (const e of looseExpo.updates[0].ignore) {
    if (e["dependency-name"] === "expo" && e.versions) e.versions = [">= 58"];
  }
  expect("a bound that readmits expo 57 FAILS", looseExpo, true, "LETS");

  // Direction 5 — an unparseable bound FAILS (a decorative `versions:`).
  const junkExpo = fixtureDoc();
  for (const e of junkExpo.updates[0].ignore) {
    if (e["dependency-name"] === "expo" && e.versions) e.versions = ["latest"];
  }
  expect("an unparseable expo bound FAILS", junkExpo, true, "no parseable");

  if (failures.length > 0) {
    console.error("SELF-TEST FAIL (issue-1051-dependabot-security-ignores):");
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log(
    "issue-1051-dependabot-security-ignores self-test OK (5 directions: compliant passes; update-types-only, ORCH-1386-deletion, loose bound, and unparseable bound all fail).",
  );
  process.exit(0);
}

async function main() {
  if (process.argv.includes("--self-test")) return selfTest();

  let YAML;
  try {
    YAML = (await import("yaml")).default;
  } catch {
    console.error(
      "✗ issue-1051-dependabot-security-ignores: the `yaml` package is not installed. " +
        "This gate runs in strict-grep class B, whose 'Install gate dependencies' step installs it. " +
        "Refusing to pass without parsing — a skipped gate is a dark gate.",
    );
    process.exit(2);
  }

  let doc;
  let registry;
  try {
    doc = YAML.parse(fs.readFileSync(DEPENDABOT_FILE, "utf8"));
  } catch (err) {
    console.error(`✗ issue-1051: cannot read/parse ${DEPENDABOT_FILE}: ${err.message}`);
    process.exit(2);
  }
  try {
    registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
  } catch (err) {
    console.error(`✗ issue-1051: cannot read/parse ${REGISTRY_FILE}: ${err.message}`);
    process.exit(2);
  }

  const violations = checkConfig(doc, registry);
  if (violations.length > 0) {
    console.error(
      `✗ issue #1051 / I-PROPOSED-1051-DEPENDABOT-SECURITY-IGNORES — ${violations.length} violation(s):`,
    );
    for (const v of violations) console.error("  - " + v);
    console.error(
      "\n`update-types:` binds Dependabot VERSION updates only. Security updates honour " +
        "`dependency-name:` + `versions:` ONLY — and every expo 54→57 recurrence came through " +
        "the security path. See this file's header.",
    );
    process.exit(1);
  }
  console.log(
    "✓ issue #1051: every framework-family ignore in .github/dependabot.yml binds BOTH the version-update and the security-update path.",
  );
}

main();
