#!/usr/bin/env node
/**
 * ISSUE-1158 [Dependabot semver-trap: a `sharp` security bump unlocks `@vercel/og`
 * and drags it to the broken `1.0.0` mispublish] — I-PROPOSED-1158-VERCEL-OG-SEMVER-TRAP-PINNED.
 *
 * WHY: `@vercel/og@0.11.1` (npm `latest`, 2026-03-05) declares `sharp` as an
 * OPTIONAL transitive dependency with range `^0.34.5`. `sharp` is NOT a direct
 * dependency of `mingla-business` — it enters the tree ONLY through `@vercel/og`.
 * When Dependabot services a `sharp` security advisory it cannot move `sharp`
 * past the `^0.34.5` cap without editing the parent it CAN reach, so it unlocks
 * `@vercel/og` and grabs its highest-semver tag `1.0.0`. But `1.0.0` is a STRAY
 * 2023-01-09 mispublish (≈3h after `0.0.24`, byte-older than `0.11.1`, the only
 * `1.x`, never followed by `1.0.1`) whose deps are a WASM-only 2023 build
 * (`satori@0.0.46` + `yoga-wasm-web@0.3.0` + `@resvg/resvg-wasm@2.0.0-alpha.4`,
 * NO `sharp`). Under `1.0.0` `mingla-business/server/socialPreview.js`'s
 * `await import("@vercel/og")` throws `ERR_MODULE_NOT_FOUND: 'wbg'` and every
 * business OG share-preview PNG (`/api/og-{event,brand,trip}` for `/e`,`/t`,`/b`)
 * renders ZERO images. Dependabot PR #1151 did exactly this and CI was GREEN —
 * the OG renderer is a Vercel serverless route, never exercised by the expo web
 * build. Identical parent-unlock class as #1130 (postcss under expo).
 *
 * THE FIX THIS GATE PROTECTS: pin `@vercel/og` to the 0.x line via a top-level
 * npm `overrides` entry in mingla-business/package.json
 * (`"overrides": { "@vercel/og": "^0.11.1" }`), BYTE-IDENTICAL to the direct
 * `dependencies["@vercel/og"]` spec so npm's EOVERRIDE rule accepts it (an
 * override on a direct dep must match the dep spec exactly). `^0.11.1` on a 0.x
 * version means `>=0.11.1 <0.12.0` → forbids `1.0.0` (and `0.12+`) while still
 * allowing future `0.11.x` patches. If Dependabot later rewrites the direct dep
 * to `^1.0.0`, the fixed override no longer matches → `npm install` FAILS CLOSED
 * (EOVERRIDE) and the poisoned bump cannot merge green. The `.github/dependabot.yml`
 * `@vercel/og >= 1.0.0` ignore is DEFENSE-IN-DEPTH only (it may not be consulted
 * for a dragged parent vs a named subject — see #1051/#1130); the override + this
 * gate is the LOAD-BEARING control.
 *
 * SHARP RESCUE (#1158 §4.3 Path A): `sharp 0.34.5` (the version @vercel/og's
 * `^0.34.5` cap admits) satisfies the 2023 libwebp CVE-2023-4863 (fixed 0.32.6)
 * but NOT the 2026 libvips advisory GHSA-f88m-g3jw-g9cj (CVE-2026-33327/33328/
 * 35590/35591), whose min-fix `0.35.0` sits ONE patch above the `^0.34.5` cap and
 * is unreachable by natural resolution. Because `sharp` is transitive (not a
 * direct dep) a `sharp` override is EOVERRIDE-free, so we force `sharp` to
 * `0.35.3` via `"overrides": { "sharp": "0.35.3" }`. A render-smoke
 * (issue-1158-og-render-smoke.mjs, class C) proves `renderOgPng` still returns a
 * valid PNG under `sharp 0.35.3`. This gate's Check C is the fails-on-revert for
 * that rescue: removing the sharp override, or any resolved `sharp` node dropping
 * below `0.35.0`, FAILS CI (re-opening GHSA-f88m-g3jw-g9cj).
 *
 * DO NOT REMOVE THE OVERRIDE. Deleting `overrides["@vercel/og"]`, loosening it so
 * it admits `>= 1.0.0`, breaking its byte-identity with the direct dep, or letting
 * any resolved `@vercel/og` node reach `1.0.0` re-arms the exact
 * transitive-security → parent-unlock drag this gate exists to prevent. Deleting
 * `overrides.sharp` (or regressing `sharp` below `0.35.0`) re-opens the 2026
 * libvips advisory.
 *
 * ASSERTS (mingla-business only — `@vercel/og` exists nowhere else in the repo):
 *  A. MANIFEST: `overrides["@vercel/og"]` is a string whose floor is >= 0.11.1
 *     AND whose range CANNOT admit `>= 1.0.0` (stays on the 0.x line). The direct
 *     `dependencies["@vercel/og"]` is BYTE-IDENTICAL to the override (EOVERRIDE
 *     safety) and itself stays on the 0.x line. Missing key, a range admitting
 *     `1.0.0` (`^1.0.0`, `>=0.11.1`, `*`, `latest`), a floor `< 0.11.1`, or a
 *     byte mismatch → FAIL.
 *  B. LOCKFILE: every resolved `@vercel/og` node in package-lock.json satisfies
 *     `>= 0.11.1 && < 1.0.0`, and at least one node exists (a lockfile that
 *     resolves ZERO `@vercel/og` nodes is a rewritten tree — the 1.0.0 shape drops
 *     the sole consumer's parent — and FAILS closed, never passes vacuously).
 *  C. LOCKFILE + MANIFEST (sharp rescue, #1158 Path A): `overrides.sharp` floor is
 *     >= 0.35.0 AND every resolved `sharp` node is >= 0.35.0, with at least one
 *     `sharp` node (zero = the 1.0.0 drag that drops sharp entirely). GHSA-f88m-g3jw-g9cj.
 *
 * RELATIONSHIP TO #1130: identical mechanism (transitive-security unlocks an
 * editable parent), different parent (`@vercel/og` here, `expo`/`next` there).
 * This gate adds a CEILING check (`admitsGte1x`) that #1130 did not need — #1130's
 * `postcss` fix pins a FORWARD floor, whereas #1158 must pin `@vercel/og` to a
 * 0.x CEILING because the trap version is NUMERICALLY HIGHER than `latest`.
 * Both fail-on-revert; neither replaces the other; this gate does not touch,
 * overlap, or weaken orch-1130-postcss-transitive-pin-check.mjs.
 *
 * `--self-test` proves BOTH directions (clean → exit 0; every revert → exit 1).
 *
 * Exit codes: 0 clean, 1 violation, 2 script error / inconclusive.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, "..", "..", "..");

/** The single app whose tree carries @vercel/og (+ sharp as its optional transitive). */
export const APP = "mingla-business";

/** @vercel/og floor: 0.11.1 is npm `latest`; the override must not drop below it. */
export const VERCEL_OG_FLOOR = [0, 11, 1];
/** @vercel/og ceiling: 1.0.0 is the stray mispublish; nothing may reach it. */
export const VERCEL_OG_CEILING = [1, 0, 0];
/** sharp floor for the 2026 libvips advisory GHSA-f88m-g3jw-g9cj (min-fix 0.35.0). */
export const SHARP_FLOOR = [0, 35, 0];

/**
 * Parse a version or range lower-bound into [major, minor, patch]. Strips a
 * leading run of range operators (`^ ~ >= = v` and whitespace), then reads the
 * first concrete numeric triple, padding a missing minor/patch with 0. Returns
 * null for specs with no leading concrete version (`*`, `latest`, `<1.0.0`,
 * `file:`, `git+…`, `workspace:`, objects) — a spec that loose cannot guarantee a
 * floor and is reported as a violation by the caller.
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

/** a < b for [major, minor, patch] tuples. */
export function lt(a, b) {
  return !gte(a, b);
}

/**
 * Does the range spec admit ANY version >= 1.0.0 (i.e. can it reach the trap)?
 *
 * A spec is SAFE (returns false) only when it is provably capped below 1.0.0:
 * a caret/tilde/exact whose MAJOR is 0 stays within the 0.x line
 * (`^0.11.1` = `>=0.11.1 <0.12.0`, `~0.11.1` = `>=0.11.1 <0.12.0`,
 * exact `0.11.1` = `0.11.1`). Everything else — a caret/tilde/exact with major
 * >= 1, ANY `>=`/`>` (unbounded above), wildcards (`*`, `x`), tags (`latest`),
 * unions (`||`), hyphen ranges, or an unparseable spec — is treated as ADMITTING
 * `>= 1.0.0` and rejected by the caller. This is the CEILING check #1130 lacked.
 */
export function admitsGte1x(spec) {
  if (typeof spec !== "string") return true;
  const s = spec.trim();
  if (s === "") return true;
  if (
    s === "*" ||
    s === "x" ||
    s === "X" ||
    /^latest$/i.test(s) ||
    s.includes("||") ||
    s.includes(" - ") ||
    s.includes("|")
  ) {
    return true;
  }
  const m = s.match(/^(\^|~|>=|<=|>|<|=|v)?\s*(\d+)/);
  if (!m) return true; // unparseable → cannot prove it stays below 1.0.0
  const op = m[1] || "";
  const major = Number(m[2]);
  if (Number.isNaN(major)) return true;
  switch (op) {
    case "^":
    case "~":
    case "":
    case "=":
    case "v":
      // Bounded within the same major (major 0 ⇒ within the same minor).
      return major >= 1;
    case ">=":
    case ">":
      // Unbounded above ⇒ admits everything at/above the floor, including 1.0.0.
      return true;
    case "<":
    case "<=":
      // Upper-bounded; reaches the 1.x line only if the cap's major is >= 1.
      return major >= 1;
    default:
      return true;
  }
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

/** All resolved nodes for a package name in a parsed lockfile: [{ path, version }]. */
export function resolvedNodes(lockJson, name) {
  const out = [];
  for (const [p, meta] of Object.entries(lockJson.packages ?? {})) {
    if (!p || !p.includes("node_modules/")) continue;
    if (lockPathName(p) !== name) continue;
    if (!meta || typeof meta.version !== "string") continue;
    out.push({ path: p, version: meta.version });
  }
  return out;
}

/** The direct dep spec for a name, from dependencies or devDependencies. */
export function directDepSpec(pkgJson, name) {
  return pkgJson?.dependencies?.[name] ?? pkgJson?.devDependencies?.[name];
}

/** Check A — the manifest override pins @vercel/og to the 0.x line, EOVERRIDE-safe. */
export function checkVercelOgOverride(pkgJson) {
  const failures = [];
  const spec = pkgJson?.overrides?.["@vercel/og"];
  if (spec === undefined) {
    failures.push(
      `${APP}/package.json: missing the ISSUE-1158 pin — a top-level "overrides": { "@vercel/og": "^0.11.1" } ` +
        `(floor >= ${fmt(VERCEL_OG_FLOOR)}, and pinned to the 0.x line, byte-identical to the direct dep) must be present. ` +
        `Removing it re-arms the Dependabot sharp-security → @vercel/og parent-unlock drag that ships the broken 1.0.0 ` +
        `mispublish (issue #1158). DO NOT REMOVE THE OVERRIDE.`,
    );
    return failures;
  }
  if (typeof spec !== "string") {
    failures.push(
      `${APP}/package.json: "overrides['@vercel/og']" must be a version-range string (e.g. "^0.11.1"), got ${JSON.stringify(spec)}.`,
    );
    return failures;
  }
  const floor = versionFloor(spec);
  if (floor === null) {
    failures.push(
      `${APP}/package.json: "overrides['@vercel/og']" = "${spec}" has no guaranteed lower bound >= ${fmt(VERCEL_OG_FLOOR)} — ` +
        `pin it to a caret/tilde/exact 0.x range (e.g. "^0.11.1", which is npm latest).`,
    );
  } else if (!gte(floor, VERCEL_OG_FLOOR)) {
    failures.push(
      `${APP}/package.json: "overrides['@vercel/og']" = "${spec}" (floor ${fmt(floor)}) is BELOW ${fmt(VERCEL_OG_FLOOR)} ` +
        `(npm latest). @vercel/og must stay >= ${fmt(VERCEL_OG_FLOOR)}.`,
    );
  }
  if (admitsGte1x(spec)) {
    failures.push(
      `${APP}/package.json: "overrides['@vercel/og']" = "${spec}" admits >= ${fmt(VERCEL_OG_CEILING)} — it must be pinned to ` +
        `the 0.x line (e.g. "^0.11.1" = >=0.11.1 <0.12.0). 1.0.0 is a stray 2023 mispublish that renders zero OG images ` +
        `(issue #1158). A caret/tilde/exact 0.x spec is required; ">=", "*", "latest", or any 1.x range is forbidden.`,
    );
  }
  // EOVERRIDE safety: the override on a DIRECT dep must be byte-identical to the
  // dep spec, else `npm install` errors EOVERRIDE. It also means the fixed
  // override no longer matches if Dependabot rewrites the direct dep to ^1.0.0 →
  // fails closed (proven CASE A/B, issue #1158).
  const direct = directDepSpec(pkgJson, "@vercel/og");
  if (direct === undefined) {
    failures.push(
      `${APP}/package.json: "@vercel/og" is not a direct dependency — the override's EOVERRIDE byte-identity invariant ` +
        `cannot hold. @vercel/og must remain a direct dependency pinned to ^0.11.1.`,
    );
  } else if (direct !== spec) {
    failures.push(
      `${APP}/package.json: direct "@vercel/og" = "${direct}" is NOT byte-identical to "overrides['@vercel/og']" = "${spec}". ` +
        `npm's EOVERRIDE rule requires an override on a direct dep to match the dep spec exactly. Keep both = "^0.11.1".`,
    );
  } else if (admitsGte1x(direct)) {
    failures.push(
      `${APP}/package.json: direct "@vercel/og" = "${direct}" admits >= ${fmt(VERCEL_OG_CEILING)} — it must stay on the 0.x line.`,
    );
  }
  return failures;
}

/** Check A (sharp) — the manifest override forces sharp past the libvips advisory. */
export function checkSharpOverride(pkgJson) {
  const failures = [];
  const spec = pkgJson?.overrides?.sharp;
  if (spec === undefined) {
    failures.push(
      `${APP}/package.json: missing the ISSUE-1158 sharp rescue — a top-level "overrides": { "sharp": "0.35.3" } ` +
        `(floor >= ${fmt(SHARP_FLOOR)}) must be present. sharp is an optional transitive of @vercel/og capped at ^0.34.5; ` +
        `the override forces it past that cap to close the 2026 libvips advisory GHSA-f88m-g3jw-g9cj. ` +
        `Removing it re-opens that advisory. DO NOT REMOVE THE OVERRIDE.`,
    );
    return failures;
  }
  if (typeof spec !== "string") {
    failures.push(
      `${APP}/package.json: "overrides.sharp" must be a version-range string (e.g. "0.35.3"), got ${JSON.stringify(spec)}.`,
    );
    return failures;
  }
  const floor = versionFloor(spec);
  if (floor === null) {
    failures.push(
      `${APP}/package.json: "overrides.sharp" = "${spec}" has no guaranteed lower bound >= ${fmt(SHARP_FLOOR)} — pin it to ` +
        `a concrete version (e.g. "0.35.3") that clears GHSA-f88m-g3jw-g9cj.`,
    );
  } else if (!gte(floor, SHARP_FLOOR)) {
    failures.push(
      `${APP}/package.json: "overrides.sharp" = "${spec}" (floor ${fmt(floor)}) is BELOW ${fmt(SHARP_FLOOR)}. sharp must stay ` +
        `>= ${fmt(SHARP_FLOOR)} to close the 2026 libvips advisory GHSA-f88m-g3jw-g9cj (CVE-2026-33327/33328/35590/35591).`,
    );
  }
  return failures;
}

/** Check B — every resolved @vercel/og node stays on the 0.x line (>= floor, < ceiling). */
export function checkVercelOgLockfile(lockJson) {
  const failures = [];
  const nodes = resolvedNodes(lockJson, "@vercel/og");
  if (nodes.length === 0) {
    failures.push(
      `${APP}/package-lock.json: resolves ZERO @vercel/og nodes. @vercel/og is the sole consumer of the OG renderer and a ` +
        `required direct dependency — its total absence means the tree was rewritten (the 1.0.0 mispublish shape drops it). ` +
        `This gate fails closed rather than pass vacuously.`,
    );
    return failures;
  }
  for (const { path: p, version } of nodes) {
    const v = versionFloor(version);
    if (v === null) {
      failures.push(`${APP}/package-lock.json: "${p}" has an unparseable @vercel/og version "${version}".`);
      continue;
    }
    if (!gte(v, VERCEL_OG_FLOOR)) {
      failures.push(
        `${APP}/package-lock.json: "${p}" resolves @vercel/og ${version}, BELOW ${fmt(VERCEL_OG_FLOOR)} (npm latest). ` +
          `Regenerate the lockfile with the overrides pin applied (npm install --package-lock-only).`,
      );
    }
    if (!lt(v, VERCEL_OG_CEILING)) {
      failures.push(
        `${APP}/package-lock.json: "${p}" resolves @vercel/og ${version}, at/above the ${fmt(VERCEL_OG_CEILING)} CEILING. ` +
          `1.0.0 is the stray 2023 mispublish that renders zero OG images (issue #1158). @vercel/og must stay < ${fmt(VERCEL_OG_CEILING)}. ` +
          `The overrides pin should have prevented this — do not hand-edit the lockfile to a 1.x @vercel/og.`,
      );
    }
  }
  return failures;
}

/** Check C — every resolved sharp node clears the 2026 libvips advisory floor. */
export function checkSharpLockfile(lockJson) {
  const failures = [];
  const nodes = resolvedNodes(lockJson, "sharp");
  if (nodes.length === 0) {
    failures.push(
      `${APP}/package-lock.json: resolves ZERO sharp nodes. sharp is the optional transitive of @vercel/og forced forward by ` +
        `the ISSUE-1158 override — its total absence means @vercel/og was dragged to the sharp-less 1.0.0 mispublish. ` +
        `This gate fails closed rather than pass vacuously.`,
    );
    return failures;
  }
  for (const { path: p, version } of nodes) {
    const v = versionFloor(version);
    if (v === null) {
      failures.push(`${APP}/package-lock.json: "${p}" has an unparseable sharp version "${version}".`);
      continue;
    }
    if (!gte(v, SHARP_FLOOR)) {
      failures.push(
        `${APP}/package-lock.json: "${p}" resolves sharp ${version}, BELOW ${fmt(SHARP_FLOOR)} — re-opens the 2026 libvips ` +
          `advisory GHSA-f88m-g3jw-g9cj. Regenerate the lockfile with the overrides.sharp pin applied ` +
          `(npm install --package-lock-only).`,
      );
    }
  }
  return failures;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Run all checks against a tree. Returns failure strings. */
export function runAll(rootDir = root) {
  const failures = [];
  let pkgJson;
  let lockJson;
  try {
    pkgJson = readJson(path.join(rootDir, APP, "package.json"));
    lockJson = readJson(path.join(rootDir, APP, "package-lock.json"));
  } catch (err) {
    failures.push(`Cannot read ${APP} manifest/lockfile: ${err.message} — the gate fails closed.`);
    return failures;
  }
  failures.push(...checkVercelOgOverride(pkgJson));
  failures.push(...checkSharpOverride(pkgJson));
  failures.push(...checkVercelOgLockfile(lockJson));
  failures.push(...checkSharpLockfile(lockJson));
  return failures;
}

/* ------------------------------- self-test ------------------------------- */

function selfTest() {
  const results = [];
  const ok = (name, cond) => results.push({ name, pass: !!cond });

  // 1. versionFloor parsing: ranges, exacts, padding, and the un-pinnable set.
  ok(
    "versionFloor handles caret/tilde/gte/exact, padding, and rejects loose specs",
    fmt(versionFloor("^0.11.1")) === "0.11.1" &&
      fmt(versionFloor("~0.11.1")) === "0.11.1" &&
      fmt(versionFloor(">=0.11.1")) === "0.11.1" &&
      fmt(versionFloor("0.11.1")) === "0.11.1" &&
      fmt(versionFloor("0.35.3")) === "0.35.3" &&
      fmt(versionFloor("0.12")) === "0.12.0" &&
      versionFloor("*") === null &&
      versionFloor("latest") === null &&
      versionFloor(undefined) === null,
  );

  // 2. gte/lt tuple comparison incl. the exact @vercel/og + sharp boundaries.
  ok(
    "gte/lt compare correctly at the 0.11.1, 1.0.0, and 0.35.0 boundaries",
    gte([0, 11, 1], VERCEL_OG_FLOOR) === true &&
      gte([0, 11, 2], VERCEL_OG_FLOOR) === true &&
      gte([0, 11, 0], VERCEL_OG_FLOOR) === false &&
      lt([0, 11, 1], VERCEL_OG_CEILING) === true &&
      lt([0, 99, 99], VERCEL_OG_CEILING) === true &&
      lt([1, 0, 0], VERCEL_OG_CEILING) === false &&
      gte([0, 35, 0], SHARP_FLOOR) === true &&
      gte([0, 35, 3], SHARP_FLOOR) === true &&
      gte([0, 34, 5], SHARP_FLOOR) === false,
  );

  // 3. admitsGte1x — the CEILING check. Safe: 0.x caret/tilde/exact. Unsafe: 1.x,
  //    unbounded >=, wildcards, tags.
  ok(
    "admitsGte1x rejects only ranges that can reach 1.0.0",
    admitsGte1x("^0.11.1") === false &&
      admitsGte1x("~0.11.1") === false &&
      admitsGte1x("0.11.1") === false &&
      admitsGte1x("^0.11.2") === false &&
      admitsGte1x("^1.0.0") === true &&
      admitsGte1x("~1.0.0") === true &&
      admitsGte1x("1.0.0") === true &&
      admitsGte1x(">=0.11.1") === true &&
      admitsGte1x(">0.11.1") === true &&
      admitsGte1x("*") === true &&
      admitsGte1x("latest") === true &&
      admitsGte1x("^0.11.1 || ^1.0.0") === true,
  );

  const goodPkg = {
    dependencies: { "@vercel/og": "^0.11.1" },
    overrides: { postcss: "^8.5.21", "@vercel/og": "^0.11.1", sharp: "0.35.3" },
  };
  const goodLock = {
    packages: {
      "": {},
      "node_modules/@vercel/og": { version: "0.11.1" },
      "node_modules/sharp": { version: "0.35.3" },
      "node_modules/lodash": { version: "4.17.21" },
    },
  };

  // 4. T1 — the clean tree passes every check.
  ok(
    "T1 happy: clean manifest + lockfile pass all checks",
    checkVercelOgOverride(goodPkg).length === 0 &&
      checkSharpOverride(goodPkg).length === 0 &&
      checkVercelOgLockfile(goodLock).length === 0 &&
      checkSharpLockfile(goodLock).length === 0,
  );

  // 5. T2 — the @vercel/og override deleted entirely (postcss + sharp remain).
  const noOgPkg = { dependencies: { "@vercel/og": "^0.11.1" }, overrides: { postcss: "^8.5.21", sharp: "0.35.3" } };
  const fT2 = checkVercelOgOverride(noOgPkg);
  ok(
    "T2 revert: missing @vercel/og override fails with DO NOT REMOVE (fails-on-revert)",
    fT2.length === 1 && /DO NOT REMOVE THE OVERRIDE/.test(fT2[0]) && /missing the ISSUE-1158 pin/.test(fT2[0]),
  );

  // 6. T3 — the lockfile resolves the 1.0.0 trap (ceiling violation).
  const dragLock = structuredClone(goodLock);
  dragLock.packages["node_modules/@vercel/og"].version = "1.0.0";
  const fT3 = checkVercelOgLockfile(dragLock);
  ok(
    "T3 drag: lockfile @vercel/og 1.0.0 fails on the ceiling (fails-on-revert)",
    fT3.length === 1 && /CEILING/.test(fT3[0]) && /1\.0\.0/.test(fT3[0]),
  );

  // 7. T4 — override loosened to admit 1.x (caret, unbounded, wildcard).
  ok(
    "T4 admits-1.x: ^1.0.0 / >=0.11.1 / * overrides each fail with 'admits >= 1.0.0'",
    checkVercelOgOverride({ dependencies: { "@vercel/og": "^1.0.0" }, overrides: { "@vercel/og": "^1.0.0", sharp: "0.35.3" } }).some((f) => /admits >= 1\.0\.0/.test(f)) &&
      checkVercelOgOverride({ dependencies: { "@vercel/og": ">=0.11.1" }, overrides: { "@vercel/og": ">=0.11.1", sharp: "0.35.3" } }).some((f) => /admits >= 1\.0\.0/.test(f)) &&
      checkVercelOgOverride({ dependencies: { "@vercel/og": "*" }, overrides: { "@vercel/og": "*", sharp: "0.35.3" } }).some((f) => /admits >= 1\.0\.0/.test(f)),
  );

  // 8. T5 — the direct dep no longer byte-identical to the override (EOVERRIDE).
  const mismatchPkg = {
    dependencies: { "@vercel/og": "^1.0.0" },
    overrides: { "@vercel/og": "^0.11.1", sharp: "0.35.3" },
  };
  ok(
    "T5 EOVERRIDE-safety: direct ^1.0.0 != override ^0.11.1 fails on byte-identity",
    checkVercelOgOverride(mismatchPkg).some((f) => /NOT byte-identical/.test(f)),
  );

  // 9. T6 — anti-vacuous: a lockfile with zero @vercel/og nodes fails.
  ok(
    "T6 anti-vacuous: lockfile with zero @vercel/og nodes fails",
    checkVercelOgLockfile({ packages: { "": {}, "node_modules/lodash": { version: "4.17.21" } } }).some((f) =>
      /ZERO @vercel\/og nodes/.test(f),
    ),
  );

  // 10. T7 — sharp override removed → fails (fails-on-revert for the rescue).
  const noSharpPkg = { dependencies: { "@vercel/og": "^0.11.1" }, overrides: { "@vercel/og": "^0.11.1" } };
  const fT7a = checkSharpOverride(noSharpPkg);
  ok(
    "T7 sharp revert: missing sharp override fails with DO NOT REMOVE",
    fT7a.length === 1 && /DO NOT REMOVE THE OVERRIDE/.test(fT7a[0]) && /GHSA-f88m-g3jw-g9cj/.test(fT7a[0]),
  );

  // 11. T7b — a resolved sharp node regressed below 0.35.0 fails.
  const sharpVulnLock = structuredClone(goodLock);
  sharpVulnLock.packages["node_modules/sharp"].version = "0.34.5";
  const fT7b = checkSharpLockfile(sharpVulnLock);
  ok(
    "T7b sharp revert: lockfile sharp 0.34.5 fails below the 0.35.0 floor",
    fT7b.length === 1 && /BELOW 0\.35\.0/.test(fT7b[0]) && /0\.34\.5/.test(fT7b[0]),
  );

  // 12. sharp override floor below 0.35.0 fails.
  ok(
    "sharp override 0.34.5 fails below the advisory floor",
    checkSharpOverride({ overrides: { sharp: "0.34.5" } }).some((f) => /BELOW 0\.35\.0/.test(f)),
  );

  // 13. anti-vacuous: zero sharp nodes (the 1.0.0 drag drops sharp) fails.
  ok(
    "anti-vacuous: lockfile with zero sharp nodes fails",
    checkSharpLockfile({ packages: { "": {}, "node_modules/lodash": { version: "4.17.21" } } }).some((f) =>
      /ZERO sharp nodes/.test(f),
    ),
  );

  // 14. lockPathName + resolvedNodes attribute to the last node_modules segment.
  ok(
    "lockPathName + resolvedNodes resolve the last node_modules segment",
    lockPathName("node_modules/@some/tool/node_modules/@vercel/og") === "@vercel/og" &&
      resolvedNodes(goodLock, "@vercel/og").length === 1 &&
      resolvedNodes(goodLock, "sharp").length === 1,
  );

  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
  }
  if (failed.length > 0) {
    console.error(
      `ISSUE-1158 vercel-og-semver-trap-pin-check self-test FAIL (${failed.length}/${results.length}).`,
    );
    process.exit(2);
  }
  console.log(
    `ISSUE-1158 vercel-og-semver-trap-pin-check self-test PASS (${results.length}/${results.length} cases).`,
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
          `ISSUE-1158 vercel-og-semver-trap-pin-check FAIL (${failures.length} violation(s)):\n`,
        );
        for (const f of failures) console.error("  - " + f);
        console.error(
          "\n@vercel/og must stay pinned to the 0.x line via overrides in mingla-business/package.json (byte-identical to " +
            "the direct dep, EOVERRIDE-safe) and every resolved @vercel/og lockfile node must stay < 1.0.0, so no sharp-driven " +
            "parent-unlock can drag it to the 1.0.0 mispublish that renders zero OG images. sharp must stay >= 0.35.0 to close " +
            "the 2026 libvips advisory GHSA-f88m-g3jw-g9cj. See the header of " +
            ".github/scripts/strict-grep/issue-1158-vercel-og-semver-trap-pin-check.mjs. Issue #1158.",
        );
        process.exit(1);
      }
      console.log(
        "ISSUE-1158 vercel-og-semver-trap-pin-check PASS — overrides pin @vercel/og to the 0.x line (byte-identical, EOVERRIDE-safe), " +
          "every resolved @vercel/og node stays < 1.0.0, and sharp is forced >= 0.35.0 (GHSA-f88m-g3jw-g9cj closed).",
      );
    }
  } catch (err) {
    console.error(`ISSUE-1158 vercel-og-semver-trap-pin-check script error: ${err.stack}`);
    process.exit(2);
  }
}
