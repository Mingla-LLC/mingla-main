#!/usr/bin/env node
/**
 * ORCH-1130 / #1135 — TESTER ADVERSARIAL REGRESSION GATE (repo-wide postcss floor).
 *
 * DIFFERENT ANGLE from orch-1130-postcss-transitive-pin-check.mjs (NOT a rename of it):
 *   - orch-1130-postcss-transitive-pin-check walks a FIXED allowlist of exactly three
 *     apps (GUARDED_APPS = app-mobile, mingla-business, mingla-marketing) and checks
 *     BOTH the manifest `overrides.postcss` AND that app's resolved lockfile nodes.
 *   - THIS gate ignores manifests and the allowlist entirely. It DISCOVERS the OPEN SET
 *     of every package-lock.json in the repo (skipping node_modules/.git) and asserts a
 *     single invariant: NO resolved postcss node in ANY lockfile is below the advisory
 *     floor (8.5.10). It is the "4th surface" catch — a lockfile the primary guard's
 *     hardcoded 3-app list structurally cannot see (mingla-admin, scripts/, or a NEW app
 *     added tomorrow) reintroducing postcss < 8.5.10 (GHSA-qx2v-qp2m-jg93 / CVE-2026-41305)
 *     re-arms the exact vulnerable-transitive → framework-parent-unlock drag #1130 exists
 *     to prevent, yet would pass the per-app guard green. This gate reds on it.
 *
 * WHY THIS MATTERS: #1130 pinned postcss forward in the two Expo-54 apps; #1135 extended
 * it to the Next.js marketing app. The vulnerability class is a vulnerable TRANSITIVE
 * postcss dragging an editable framework PARENT (expo, next) forward when Dependabot tries
 * to remediate it. That class is not app-specific — ANY future dependency tree that
 * resolves postcss < 8.5.10 is a fresh instance of the same drag. A per-app allowlist is
 * necessary (it also proves the override is present) but not sufficient: it goes stale the
 * moment a 4th surface appears. This gate makes the resolved-version invariant total across
 * the whole repository, so the drag cannot re-enter through a door the allowlist never
 * watches.
 *
 * COVERAGE FLOOR: the sweep MUST reach the four framework-bearing app dirs
 * (app-mobile, mingla-business, mingla-marketing, mingla-admin) — the last of which is
 * NOT in orch-1130's GUARDED_APPS. If a refactor relocates or deletes one of those
 * lockfiles out of the sweep, the invariant would silently stop covering it; this gate
 * fails closed instead.
 *
 * ANTI-VACUOUS: discovering ZERO package-lock.json files, or a corpus with ZERO resolved
 * postcss nodes across every lockfile, is a FAILURE — never a "green because it matched
 * nothing" pass (the rel="noopener" failure mode).
 *
 * Append-only; does not modify or weaken orch-1130-postcss-transitive-pin-check.mjs or the
 * ORCH-1386 framework-major guard — it is an independent, additional invariant.
 *
 * Exit codes: 0 clean, 1 violation, 2 script error / inconclusive.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, "..", "..", "..");

/** GHSA-qx2v-qp2m-jg93 is fixed in postcss 8.5.10; any resolved node below this fails. */
export const ADVISORY_FLOOR = [8, 5, 10];

/**
 * Directories the sweep MUST cover. These carry a framework (expo / next / vite) that can
 * be dragged forward by a vulnerable transitive postcss. mingla-admin is deliberately
 * included even though it is NOT in orch-1130's GUARDED_APPS — reaching it is the whole
 * point of this adversarial gate. If one of these has no lockfile in the sweep, fail.
 */
export const REQUIRED_SWEEP_SURFACES = [
  "app-mobile",
  "mingla-business",
  "mingla-marketing",
  "mingla-admin",
];

/** Directory names never descended into during discovery. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".expo",
  "dist",
  "build",
  "ios",
  "android",
]);

/** Parse a concrete resolved version "8.5.22" → [8,5,22]. Null if not a concrete triple. */
export function floorTuple(spec) {
  if (typeof spec !== "string") return null;
  const m = spec.trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
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

/** Final path segment after the LAST "node_modules/" (the installed package name). */
export function lockPathName(p) {
  const i = p.lastIndexOf("node_modules/");
  return i === -1 ? p : p.slice(i + "node_modules/".length);
}

/** Every resolved postcss node in a parsed lockfile: [{ path, version }]. */
export function postcssNodesIn(lockJson) {
  const out = [];
  for (const [p, meta] of Object.entries(lockJson?.packages ?? {})) {
    if (!p || !p.includes("node_modules/")) continue;
    if (lockPathName(p) !== "postcss") continue;
    if (!meta || typeof meta.version !== "string") continue;
    out.push({ path: p, version: meta.version });
  }
  return out;
}

/**
 * Pure checker — all I/O injected so --self-test drives every failure mode with fixtures.
 * @param {object} a
 * @param {{relPath:string, json:object}[]} a.lockfiles  discovered lockfiles + parsed JSON
 * @param {string[]} [a.requiredSurfaces]  dirs that must appear in the sweep
 * @returns {string[]} failures
 */
export function runChecks({ lockfiles, requiredSurfaces = REQUIRED_SWEEP_SURFACES }) {
  const failures = [];

  // Anti-vacuous #1 — a sweep that found no lockfile at all must FAIL.
  if (!Array.isArray(lockfiles) || lockfiles.length === 0) {
    failures.push(
      "P-vacuous: discovered ZERO package-lock.json files under the repo. A repo-wide " +
        "sweep that matches nothing must fail, not pass green.",
    );
    return failures;
  }

  // Coverage floor — every framework-bearing surface must be in the sweep (incl. the
  // orch-1130-UNGUARDED mingla-admin).
  for (const surface of requiredSurfaces) {
    const covered = lockfiles.some(
      (lf) => lf.relPath === `${surface}/package-lock.json` || lf.relPath.startsWith(`${surface}/`),
    );
    if (!covered) {
      failures.push(
        `coverage: required surface "${surface}" has no package-lock.json in the sweep. ` +
          `The repo-wide postcss floor no longer covers it — a vulnerable postcss could ` +
          `re-enter there unseen. Restore its lockfile or update REQUIRED_SWEEP_SURFACES ` +
          `in a reviewed change.`,
      );
    }
  }

  // The invariant — no resolved postcss node anywhere below the advisory floor.
  let totalPostcssNodes = 0;
  for (const { relPath, json } of lockfiles) {
    const nodes = postcssNodesIn(json);
    totalPostcssNodes += nodes.length;
    for (const { path: p, version } of nodes) {
      const t = floorTuple(version);
      if (t === null) {
        failures.push(`${relPath}: "${p}" has an unparseable postcss version "${version}".`);
        continue;
      }
      if (!gte(t, ADVISORY_FLOOR)) {
        failures.push(
          `${relPath}: "${p}" resolves postcss ${version}, BELOW the advisory floor ` +
            `${ADVISORY_FLOOR.join(".")} (GHSA-qx2v-qp2m-jg93). This is the #1130 vulnerable-` +
            `transitive drag on a surface the per-app guard may not watch — pin postcss ` +
            `forward (overrides.postcss ≥ ^8.5.10) and regenerate this lockfile.`,
        );
      }
    }
  }

  // Anti-vacuous #2 — a corpus with zero postcss nodes anywhere is a rewritten tree, not
  // a clean pass.
  if (totalPostcssNodes === 0) {
    failures.push(
      "P-vacuous: NOT ONE resolved postcss node across every discovered lockfile. postcss " +
        "is a required transitive of the app toolchains here — its total absence means the " +
        "trees were rewritten. This gate fails closed rather than pass vacuously.",
    );
  }

  return failures;
}

/** Discover every package-lock.json under rootDir, skipping SKIP_DIRS. Returns rel paths. */
export function discoverLockfiles(rootDir) {
  const out = [];
  const walk = (absDir, relDir) => {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const en of entries) {
      if (en.isDirectory()) {
        if (SKIP_DIRS.has(en.name)) continue;
        walk(path.join(absDir, en.name), relDir ? `${relDir}/${en.name}` : en.name);
      } else if (en.name === "package-lock.json") {
        out.push(relDir ? `${relDir}/${en.name}` : en.name);
      }
    }
  };
  walk(rootDir, "");
  return out.sort();
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Real run against the repo tree. Returns failure strings. */
export function runAll(rootDir = REPO_ROOT) {
  const relPaths = discoverLockfiles(rootDir);
  const lockfiles = [];
  for (const relPath of relPaths) {
    try {
      lockfiles.push({ relPath, json: readJson(path.join(rootDir, relPath)) });
    } catch (err) {
      return [`Cannot parse ${relPath}: ${err.message} — the gate fails closed.`];
    }
  }
  return runChecks({ lockfiles });
}

/* ------------------------------- self-test ------------------------------- */

function selfTest() {
  const results = [];
  const ok = (name, cond) => results.push({ name, pass: !!cond });

  // A clean corpus that covers all four required surfaces and every postcss ≥ floor.
  const cleanCorpus = () => [
    { relPath: "app-mobile/package-lock.json", json: { packages: { "": {}, "node_modules/postcss": { version: "8.5.22" } } } },
    { relPath: "mingla-business/package-lock.json", json: { packages: { "": {}, "node_modules/postcss": { version: "8.5.22" } } } },
    { relPath: "mingla-marketing/package-lock.json", json: { packages: { "": {}, "node_modules/postcss": { version: "8.5.22" } } } },
    { relPath: "mingla-admin/package-lock.json", json: { packages: { "": {}, "node_modules/postcss": { version: "8.5.19" } } } },
    { relPath: "scripts/package-lock.json", json: { packages: { "": {}, "node_modules/lodash": { version: "4.17.21" } } } },
  ];

  // 1. version parsing + boundary.
  ok(
    "floorTuple + gte handle the 8.5.10 boundary and padding",
    gte(floorTuple("8.5.10"), ADVISORY_FLOOR) === true &&
      gte(floorTuple("8.5.22"), ADVISORY_FLOOR) === true &&
      gte(floorTuple("8.6"), ADVISORY_FLOOR) === true &&
      gte(floorTuple("9"), ADVISORY_FLOOR) === true &&
      gte(floorTuple("8.5.9"), ADVISORY_FLOOR) === false &&
      gte(floorTuple("8.4.49"), ADVISORY_FLOOR) === false &&
      gte(floorTuple("8.4.31"), ADVISORY_FLOOR) === false &&
      floorTuple("latest") === null,
  );

  // 2. lockPathName resolves nested paths to the last segment.
  ok(
    "lockPathName resolves the last node_modules segment",
    lockPathName("node_modules/next/node_modules/postcss") === "postcss" &&
      lockPathName("node_modules/postcss-value-parser") === "postcss-value-parser",
  );

  // 3. clean corpus (all four surfaces, every postcss ≥ floor) PASSES.
  ok("clean multi-surface corpus passes", runChecks({ lockfiles: cleanCorpus() }).length === 0);

  // 4. THE DIFFERENT-ANGLE CATCH — an UNGUARDED surface (mingla-admin, absent from
  //    orch-1130 GUARDED_APPS) regresses to a vulnerable postcss → THIS gate FAILS,
  //    naming the file, path, and version. This is exactly what the per-app guard misses.
  {
    const corpus = cleanCorpus();
    corpus[3].json.packages["node_modules/postcss"].version = "8.4.31"; // mingla-admin
    const f = runChecks({ lockfiles: corpus });
    ok(
      "vulnerable postcss on an UNGUARDED surface (mingla-admin) fails (fails-on-revert / 4th-surface)",
      f.some((x) => /mingla-admin\/package-lock\.json/.test(x) && /8\.4\.31/.test(x) && /BELOW the advisory floor/.test(x)),
    );
  }

  // 5. a NEW app added tomorrow (not in any allowlist) with a vulnerable nested postcss → fails.
  {
    const corpus = cleanCorpus();
    corpus.push({
      relPath: "mingla-newapp/package-lock.json",
      json: {
        packages: {
          "": {},
          "node_modules/postcss": { version: "8.5.22" },
          "node_modules/some-tool/node_modules/postcss": { version: "8.4.49" },
        },
      },
    });
    const f = runChecks({ lockfiles: corpus });
    ok(
      "nested vulnerable postcss in a brand-new (unlisted) app fails",
      f.some((x) => /mingla-newapp/.test(x) && /8\.4\.49/.test(x)),
    );
  }

  // 6. coverage floor — a required surface (mingla-admin) missing from the sweep → fails.
  {
    const corpus = cleanCorpus().filter((lf) => !lf.relPath.startsWith("mingla-admin/"));
    ok(
      "missing required surface (mingla-admin) fails coverage",
      runChecks({ lockfiles: corpus }).some((x) => /coverage/.test(x) && /mingla-admin/.test(x)),
    );
  }

  // 7. anti-vacuous — zero lockfiles discovered → fails, never green.
  ok(
    "zero lockfiles discovered fails (anti-vacuous)",
    runChecks({ lockfiles: [] }).some((x) => /P-vacuous/.test(x)),
  );

  // 8. anti-vacuous — lockfiles present but NOT ONE postcss node anywhere → fails.
  //    (requiredSurfaces overridden to [] so the coverage rule doesn't mask the intent.)
  ok(
    "corpus with zero postcss nodes fails (anti-vacuous)",
    runChecks({
      lockfiles: [
        { relPath: "app-mobile/package-lock.json", json: { packages: { "": {}, "node_modules/lodash": { version: "4.17.21" } } } },
      ],
      requiredSurfaces: [],
    }).some((x) => /NOT ONE resolved postcss node/.test(x)),
  );

  // 9. unparseable version → fails.
  ok(
    "unparseable postcss version fails",
    runChecks({
      lockfiles: [{ relPath: "x/package-lock.json", json: { packages: { "": {}, "node_modules/postcss": { version: "garbage" } } } }],
      requiredSurfaces: [],
    }).some((x) => /unparseable postcss version/.test(x)),
  );

  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
  if (failed.length > 0) {
    console.error(`ORCH-1130 repo-wide postcss floor self-test FAIL (${failed.length}/${results.length}).`);
    process.exit(2);
  }
  console.log(`ORCH-1130 repo-wide postcss floor self-test PASS (${results.length}/${results.length} cases).`);
}

/* --------------------------------- main ---------------------------------- */

const argv = process.argv.slice(2);
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  try {
    if (argv.includes("--self-test")) {
      selfTest();
    } else {
      const failures = runAll();
      if (failures.length > 0) {
        console.error(`ORCH-1130 repo-wide postcss floor FAIL (${failures.length} violation(s)):\n`);
        for (const f of failures) console.error("  - " + f);
        console.error(
          "\nNo resolved postcss node in ANY repo lockfile may fall below 8.5.10 " +
            "(GHSA-qx2v-qp2m-jg93). This adversarial gate is the repo-wide backstop to the " +
            "per-app orch-1130-postcss-transitive-pin-check — it catches a vulnerable postcss " +
            "reintroduced on a surface the fixed 3-app allowlist does not watch. Issue #1130 / #1135.",
        );
        process.exit(1);
      }
      console.log(
        `ORCH-1130 repo-wide postcss floor PASS — every resolved postcss node across all ` +
          `discovered lockfiles clears the ${ADVISORY_FLOOR.join(".")} advisory floor; all ` +
          `required surfaces swept.`,
      );
    }
  } catch (err) {
    console.error(`ORCH-1130 repo-wide postcss floor script error: ${err.stack}`);
    process.exit(2);
  }
}
