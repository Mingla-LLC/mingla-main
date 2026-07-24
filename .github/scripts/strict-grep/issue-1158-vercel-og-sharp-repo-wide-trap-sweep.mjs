#!/usr/bin/env node
/**
 * ISSUE-1158 [repo-wide @vercel/og / sharp semver-trap sweep] — TESTER ADVERSARIAL gate.
 *
 * DIFFERENT ANGLE than issue-1158-vercel-og-semver-trap-pin-check.mjs. That gate DEEP-checks
 * exactly ONE app (mingla-business): its override, its byte-identical direct dep, and its
 * lockfile-resolved nodes. This gate instead sweeps EVERY package.json in the monorepo and
 * fails CI if ANY of them declares:
 *   • `@vercel/og` (in dependencies / devDependencies / optionalDependencies /
 *     peerDependencies / overrides, as a version-range string) with a range that can reach
 *     the broken `>= 1.0.0` mispublish, or a floor below `0.11.1` (npm `latest`); OR
 *   • `sharp` (direct dep or override, as a version-range string) pinned below the `0.35.0`
 *     libvips-advisory floor (GHSA-f88m-g3jw-g9cj).
 *
 * WHY THIS EXISTS (the gap the pin-check does not cover): `@vercel/og` lives only in
 * mingla-business TODAY, so the mingla-business-only pin-check protects the current surface.
 * But nothing stops a FUTURE app (mingla-admin, app-mobile, a brand-new package, a copied
 * manifest) from adding `@vercel/og` (or a downgraded `sharp` override) unpinned — reintroducing
 * the exact sharp-security → parent-unlock drag in a manifest the pin-check never reads. This
 * sweep is the repo-wide backstop, mirroring the established #1130 pairing (single-app
 * orch-1130-postcss-transitive-pin-check + repo-wide orch-1130-postcss-repo-wide-floor-check).
 *
 * ANTI-VACUOUS: `@vercel/og` must be declared as a string spec in at least ONE package.json
 * (today: mingla-business). Zero declarations across the whole repo means the manifest was
 * moved/rewritten (or the sweep is scanning nothing) → FAIL closed, never pass vacuously.
 *
 * SINGLE SOURCE OF TRUTH: the floor/ceiling semver primitives are imported from the sibling
 * pin-check (versionFloor / gte / admitsGte1x / VERCEL_OG_FLOOR / VERCEL_OG_CEILING /
 * SHARP_FLOOR). This gate does NOT touch, overlap, or weaken that gate — it only widens the
 * SCOPE of the same invariant from one app to the whole repo.
 *
 * DO NOT loosen. Adding an unpinned/1.x `@vercel/og` or a sub-0.35.0 `sharp` pin to any
 * package.json re-arms issue #1158.
 *
 * Exit codes: 0 clean, 1 violation, 2 script error / inconclusive.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  versionFloor,
  gte,
  admitsGte1x,
  VERCEL_OG_FLOOR,
  VERCEL_OG_CEILING,
  SHARP_FLOOR,
} from "./issue-1158-vercel-og-semver-trap-pin-check.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..", "..", "..");

/** Directories never walked (build output, vendored deps, VCS). */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".expo",
  "dist",
  "build",
  "web-build",
  "coverage",
  ".next",
  ".vercel",
  "ios",
  "android",
]);

/** The dependency sections that can pull a package into the tree. */
const OG_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "overrides",
];
/** sharp is only ever a direct dep or a deliberate override in a repo manifest. */
const SHARP_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "overrides"];

const fmt = (v) => v.join(".");

/** Recursively collect every package.json path under `root`, skipping SKIP_DIRS. */
export function discoverPackageJsons(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name));
      } else if (e.isFile() && e.name === "package.json") {
        out.push(path.join(dir, e.name));
      }
    }
  };
  walk(root);
  return out.sort();
}

/**
 * Pure sweep over a corpus of { file, json } entries. Returns { failures, ogStringDecls }.
 * ogStringDecls counts every @vercel/og *string* declaration found (for the anti-vacuous check).
 */
export function sweepCorpus(entries) {
  const failures = [];
  let ogStringDecls = 0;

  for (const { file, json } of entries) {
    if (json === null || typeof json !== "object") continue;

    // --- @vercel/og across every section ---
    for (const section of OG_SECTIONS) {
      const bag = json[section];
      if (bag === null || typeof bag !== "object") continue;
      if (!Object.prototype.hasOwnProperty.call(bag, "@vercel/og")) continue;
      const spec = bag["@vercel/og"];
      if (typeof spec !== "string") continue; // nested-override object etc. — not a version pin
      ogStringDecls += 1;
      const floor = versionFloor(spec);
      if (floor === null) {
        failures.push(
          `${file}: "${section}['@vercel/og']" = "${spec}" has no guaranteed lower bound >= ${fmt(VERCEL_OG_FLOOR)} — ` +
            `pin it to a caret/tilde/exact 0.x range (e.g. "^0.11.1"). Issue #1158.`,
        );
      } else if (!gte(floor, VERCEL_OG_FLOOR)) {
        failures.push(
          `${file}: "${section}['@vercel/og']" = "${spec}" (floor ${fmt(floor)}) is BELOW ${fmt(VERCEL_OG_FLOOR)} (npm latest). Issue #1158.`,
        );
      }
      if (admitsGte1x(spec)) {
        failures.push(
          `${file}: "${section}['@vercel/og']" = "${spec}" ADMITS >= ${fmt(VERCEL_OG_CEILING)} — it must be pinned to the 0.x line ` +
            `(e.g. "^0.11.1"). 1.0.0 is a stray 2023 mispublish that renders zero OG images. Issue #1158.`,
        );
      }
    }

    // --- sharp (direct dep or deliberate override) must clear the libvips floor ---
    for (const section of SHARP_SECTIONS) {
      const bag = json[section];
      if (bag === null || typeof bag !== "object") continue;
      if (!Object.prototype.hasOwnProperty.call(bag, "sharp")) continue;
      const spec = bag.sharp;
      if (typeof spec !== "string") continue;
      const floor = versionFloor(spec);
      if (floor === null) {
        failures.push(
          `${file}: "${section}.sharp" = "${spec}" has no guaranteed lower bound >= ${fmt(SHARP_FLOOR)} — pin it to a concrete ` +
            `version (e.g. "0.35.3") that clears GHSA-f88m-g3jw-g9cj. Issue #1158.`,
        );
      } else if (!gte(floor, SHARP_FLOOR)) {
        failures.push(
          `${file}: "${section}.sharp" = "${spec}" (floor ${fmt(floor)}) is BELOW ${fmt(SHARP_FLOOR)} — re-opens the 2026 libvips ` +
            `advisory GHSA-f88m-g3jw-g9cj (CVE-2026-33327/33328/35590/35591). Issue #1158.`,
        );
      }
    }
  }

  if (ogStringDecls === 0) {
    failures.push(
      `repo-wide sweep found ZERO @vercel/og string declarations across all package.json files. @vercel/og is a required ` +
        `mingla-business dependency — its total absence means the manifest was moved/rewritten or the sweep scanned nothing. ` +
        `This gate fails closed rather than pass vacuously. Issue #1158.`,
    );
  }

  return { failures, ogStringDecls };
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/** Run the sweep against a real tree rooted at `rootDir`. Returns failure strings. */
export function runAll(rootDir = ROOT) {
  const files = discoverPackageJsons(rootDir);
  if (files.length === 0) {
    return [`repo-wide sweep discovered ZERO package.json files under ${rootDir} — the gate fails closed.`];
  }
  const entries = files.map((file) => ({
    file: path.relative(rootDir, file),
    json: readJsonSafe(file),
  }));
  return sweepCorpus(entries).failures;
}

/* ------------------------------- self-test ------------------------------- */

function selfTest() {
  const results = [];
  const ok = (name, cond) => results.push({ name, pass: !!cond });

  const clean = [
    { file: "mingla-business/package.json", json: { dependencies: { "@vercel/og": "^0.11.1" }, overrides: { "@vercel/og": "^0.11.1", sharp: "0.35.3" } } },
    { file: "app-mobile/package.json", json: { dependencies: { react: "19.1.0" } } },
  ];

  // T1 — a clean corpus (mingla-business pinned + an unrelated app) passes.
  ok("T1 clean corpus passes", sweepCorpus(clean).failures.length === 0 && sweepCorpus(clean).ogStringDecls === 2);

  // T2 — some OTHER app introduces @vercel/og ^1.0.0 (the trap) → reds with 'ADMITS'.
  const dragDep = [...clean, { file: "mingla-admin/package.json", json: { dependencies: { "@vercel/og": "^1.0.0" } } }];
  ok(
    "T2 foreign app @vercel/og ^1.0.0 fails (admits >= 1.0.0)",
    sweepCorpus(dragDep).failures.some((f) => /ADMITS >= 1\.0\.0/.test(f) && /mingla-admin/.test(f)),
  );

  // T3 — an unbounded >= override anywhere admits 1.x → reds.
  const unbounded = [{ file: "x/package.json", json: { overrides: { "@vercel/og": ">=0.11.1" } } }];
  ok("T3 unbounded >= override fails", sweepCorpus(unbounded).failures.some((f) => /ADMITS >= 1\.0\.0/.test(f)));

  // T4 — a floor below 0.11.1 → reds even though it stays on the 0.x line.
  const lowFloor = [{ file: "y/package.json", json: { dependencies: { "@vercel/og": "^0.10.0" } } }];
  ok("T4 floor < 0.11.1 fails", sweepCorpus(lowFloor).failures.some((f) => /BELOW 0\.11\.1/.test(f)));

  // T5 — a sharp override pinned below 0.35.0 anywhere → reds (re-opens the libvips advisory).
  const sharpDown = [
    { file: "mingla-business/package.json", json: { dependencies: { "@vercel/og": "^0.11.1" }, overrides: { "@vercel/og": "^0.11.1", sharp: "0.34.5" } } },
  ];
  ok("T5 sharp override < 0.35.0 fails", sweepCorpus(sharpDown).failures.some((f) => /BELOW 0\.35\.0/.test(f) && /GHSA-f88m-g3jw-g9cj/.test(f)));

  // T6 — anti-vacuous: no @vercel/og string declaration anywhere → reds.
  const vacuous = [{ file: "app-mobile/package.json", json: { dependencies: { react: "19.1.0" } } }];
  ok("T6 anti-vacuous (zero @vercel/og decls) fails", sweepCorpus(vacuous).failures.some((f) => /ZERO @vercel\/og string declarations/.test(f)));

  // T7 — a nested-override OBJECT for @vercel/og is NOT a version pin: not flagged, not counted.
  const nested = [
    { file: "mingla-business/package.json", json: { dependencies: { "@vercel/og": "^0.11.1" }, overrides: { "@vercel/og": { sharp: "0.35.3" } } } },
  ];
  const nestedRes = sweepCorpus(nested);
  ok(
    "T7 nested-override object is ignored (only the direct-dep string counts, no false positive)",
    nestedRes.failures.length === 0 && nestedRes.ogStringDecls === 1,
  );

  // T8 — discoverPackageJsons skips node_modules and finds real manifests on a tiny fixture tree.
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "og-sweep-st-"));
  fs.mkdirSync(path.join(tmp, "app", "node_modules", "dep"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "package.json"), "{}");
  fs.writeFileSync(path.join(tmp, "app", "package.json"), "{}");
  fs.writeFileSync(path.join(tmp, "app", "node_modules", "dep", "package.json"), "{}");
  const found = discoverPackageJsons(tmp).map((p) => path.relative(tmp, p));
  fs.rmSync(tmp, { recursive: true, force: true });
  ok(
    "T8 discovery finds real manifests, skips node_modules",
    found.length === 2 && found.includes("package.json") && found.includes(path.join("app", "package.json")) && !found.some((p) => p.includes("node_modules")),
  );

  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
  if (failed.length > 0) {
    console.error(`ISSUE-1158 vercel-og-sharp-repo-wide-trap-sweep self-test FAIL (${failed.length}/${results.length}).`);
    process.exit(2);
  }
  console.log(`ISSUE-1158 vercel-og-sharp-repo-wide-trap-sweep self-test PASS (${results.length}/${results.length} cases).`);
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
        console.error(`ISSUE-1158 vercel-og-sharp-repo-wide-trap-sweep FAIL (${failures.length} violation(s)):\n`);
        for (const f of failures) console.error("  - " + f);
        console.error(
          "\nNo package.json anywhere in the monorepo may declare @vercel/og with a range reaching >= 1.0.0 (the stray 2023 " +
            "mispublish that renders zero OG images), and no package.json may pin sharp below 0.35.0 (GHSA-f88m-g3jw-g9cj). " +
            "See the header of .github/scripts/strict-grep/issue-1158-vercel-og-sharp-repo-wide-trap-sweep.mjs. Issue #1158.",
        );
        process.exit(1);
      }
      console.log(
        "ISSUE-1158 vercel-og-sharp-repo-wide-trap-sweep PASS — every package.json in the repo keeps @vercel/og on the 0.x line " +
          "(>= 0.11.1, < 1.0.0) and sharp >= 0.35.0; no manifest re-arms the semver trap.",
      );
    }
  } catch (err) {
    console.error(`ISSUE-1158 vercel-og-sharp-repo-wide-trap-sweep script error: ${err.stack}`);
    process.exit(2);
  }
}
