#!/usr/bin/env node

/**
 * I-MARKETING-PERFORMANCE-BUDGET (ORCH-0891 §4 SC-36 + SC-37).
 *
 * Builds the mingla-business web bundle and verifies:
 *   1. The composer route chunk is ≤ 280 KB gzipped (SC-36).
 *   2. Each other Marketing route chunk's gzipped size is ≤ 80 KB above
 *      its baseline (SC-37). The baseline file is committed at
 *      `.github/scripts/strict-grep/.orch-0891-bundle-baseline.json` and
 *      stored as gzipped bytes per chunk identifier.
 *
 * # How the chunk identifier is derived
 * Expo Router emits a hashed filename per route at
 *   `mingla-business/dist/_expo/static/js/<platform>/<route>-<hash>.js`
 * The gate maps each `dist/_expo/static/js/**\/*.js` file to its
 * basename minus the hash via the regex `^(.+?)-[0-9a-f]{8,}.js$`. If
 * the basename is one of the Marketing routes (`compose`, `campaigns`,
 * `audiences`, `templates`, or the bare `marketing` entry) the chunk is
 * measured.
 *
 * # Why a separate baseline file
 * Bundle sizes drift naturally with dep upgrades. SC-37 specifies an
 * INCREMENTAL budget, so the gate compares against a checked-in baseline
 * rather than a hard absolute number. Operators bump the baseline via
 * `node .github/scripts/strict-grep/orch-0891-marketing-performance-budget.mjs --update-baseline`
 * when intentional bundle changes ship.
 *
 * # Skipping the build
 * Pass `--from-dist` to skip the `expo export` step and measure an
 * existing `mingla-business/dist/` (useful in CI where a separate job
 * already built the bundle).
 *
 * # Modes
 *   default            — build then verify; exits 1 on any violation
 *   --update-baseline  — build, write the baseline file with current
 *                        sizes, then exit 0 (operator-only path)
 *   --self-test        — run inline self-tests against synthetic fixtures
 *                        without touching the real build; exits 0 on pass
 *
 * Cross-references:
 *   - SPEC_ORCH-0891 §4 SC-36 / SC-37
 *   - DESIGN_SPEC §11 (bundle-size budget)
 *   - feedback_strict_grep_registry_pattern.md (one script + one job)
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const BUSINESS_ROOT = path.join(repoRoot, "mingla-business");
const DIST_DIR = path.join(BUSINESS_ROOT, "dist");
const STATIC_JS_DIR = path.join(DIST_DIR, "_expo", "static", "js");
const BASELINE_FILE = path.join(__dirname, ".orch-0891-bundle-baseline.json");

const COMPOSER_LIMIT_BYTES_GZ = 280 * 1024; // SC-36
const OTHER_INCREMENTAL_BYTES_GZ = 80 * 1024; // SC-37

// Chunk-name normalisation: Expo Router hashes filenames with an 8+ hex
// suffix. We strip it. Anything matching these basenames is measured.
const MARKETING_BASENAMES = new Set([
  "compose",
  "campaigns",
  "audiences",
  "templates",
  "marketing",
]);

const HASH_SUFFIX_RE = /^(.+?)-[0-9a-f]{8,}\.js$/;

function stripHash(filename) {
  const m = HASH_SUFFIX_RE.exec(filename);
  if (m !== null) return m[1];
  return filename.replace(/\.js$/, "");
}

function isMarketingChunk(filename) {
  const basename = stripHash(filename);
  return MARKETING_BASENAMES.has(basename);
}

function gzippedSize(filePath) {
  const raw = fs.readFileSync(filePath);
  return gzipSync(raw).length;
}

/**
 * Walk a dist directory and produce a map: basename → gzipped bytes.
 * If multiple files map to the same basename (shouldn't happen post-hash
 * but defensive), the largest wins.
 */
export function measureBundle(distRoot) {
  const result = {};
  if (!fs.existsSync(distRoot)) return result;
  const stack = [distRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_err) {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".js")) continue;
      if (!isMarketingChunk(entry.name)) continue;
      const basename = stripHash(entry.name);
      const sizeGz = gzippedSize(full);
      const existing = result[basename];
      if (existing === undefined || existing.size < sizeGz) {
        result[basename] = { size: sizeGz, file: full };
      }
    }
  }
  return result;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
  } catch (_err) {
    return {};
  }
}

function fmtKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function runExpoExport() {
  // eslint-disable-next-line no-console
  console.log("[orch-0891-budget] running `npx expo export --platform web` ...");
  execSync("npx expo export --platform web", {
    cwd: BUSINESS_ROOT,
    stdio: "inherit",
  });
}

export function verifyAgainstBaseline(measured, baseline) {
  const violations = [];
  const composer = measured["compose"];
  if (composer !== undefined) {
    if (composer.size > COMPOSER_LIMIT_BYTES_GZ) {
      violations.push({
        chunk: "compose",
        kind: "absolute",
        current: composer.size,
        limit: COMPOSER_LIMIT_BYTES_GZ,
        message: `Composer chunk ${fmtKb(composer.size)} > ${fmtKb(COMPOSER_LIMIT_BYTES_GZ)} (SC-36).`,
      });
    }
  }
  for (const [basename, info] of Object.entries(measured)) {
    if (basename === "compose") continue;
    const baselineSize = typeof baseline[basename] === "number" ? baseline[basename] : null;
    if (baselineSize === null) continue;
    const diff = info.size - baselineSize;
    if (diff > OTHER_INCREMENTAL_BYTES_GZ) {
      violations.push({
        chunk: basename,
        kind: "incremental",
        current: info.size,
        baseline: baselineSize,
        delta: diff,
        message: `Chunk \`${basename}\` grew ${fmtKb(diff)} over baseline (SC-37 cap ${fmtKb(OTHER_INCREMENTAL_BYTES_GZ)}).`,
      });
    }
  }
  return violations;
}

function reportMeasured(measured) {
  if (Object.keys(measured).length === 0) {
    // eslint-disable-next-line no-console
    console.warn("[orch-0891-budget] No Marketing chunks measured. Did the build run?");
    return;
  }
  // eslint-disable-next-line no-console
  console.log("[orch-0891-budget] Measured Marketing chunks (gzipped):");
  for (const [basename, info] of Object.entries(measured).sort()) {
    // eslint-disable-next-line no-console
    console.log(`  ${basename.padEnd(14)} ${fmtKb(info.size).padStart(10)}  ${path.relative(repoRoot, info.file)}`);
  }
}

function writeBaseline(measured) {
  const next = {};
  for (const [basename, info] of Object.entries(measured)) {
    next[basename] = info.size;
  }
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(next, null, 2) + "\n");
  // eslint-disable-next-line no-console
  console.log(`[orch-0891-budget] Baseline written to ${path.relative(repoRoot, BASELINE_FILE)}`);
}

async function selfTest() {
  // Synthetic fixture verification — proves the size detector exits 1
  // on a real over-budget chunk and exits 0 when under budget.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-0891-budget-selftest-"));
  try {
    const fakeStatic = path.join(tmpDir, "_expo", "static", "js", "web");
    fs.mkdirSync(fakeStatic, { recursive: true });
    // 350 KB worth of incompressible-ish content (random bytes) so
    // gzipped size exceeds the 280 KB composer cap.
    const huge = Buffer.alloc(350 * 1024);
    for (let i = 0; i < huge.length; i += 1) {
      huge[i] = Math.floor(Math.random() * 256);
    }
    fs.writeFileSync(path.join(fakeStatic, "compose-abcdef1234.js"), huge);
    const measured = measureBundle(tmpDir);
    const violations = verifyAgainstBaseline(measured, {});
    if (violations.length === 0) {
      throw new Error("self-test: expected a violation for the over-budget composer fixture");
    }
    if (violations[0].chunk !== "compose" || violations[0].kind !== "absolute") {
      throw new Error("self-test: violation does not match the over-budget composer fixture");
    }
    // Now under-budget fixture: a small composer chunk should not trigger.
    fs.rmSync(path.join(fakeStatic, "compose-abcdef1234.js"));
    const small = Buffer.from("// tiny composer chunk\nexport default 1;\n");
    fs.writeFileSync(path.join(fakeStatic, "compose-deadbeef00.js"), small);
    const measuredSmall = measureBundle(tmpDir);
    const violationsSmall = verifyAgainstBaseline(measuredSmall, {});
    if (violationsSmall.length !== 0) {
      throw new Error("self-test: expected no violations for the small composer fixture");
    }
    // eslint-disable-next-line no-console
    console.log("[orch-0891-budget] self-test PASSED (over-budget detected, under-budget cleared)");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    await selfTest();
    return;
  }

  if (!args.includes("--from-dist")) {
    runExpoExport();
  }

  const measured = measureBundle(STATIC_JS_DIR);
  reportMeasured(measured);

  if (args.includes("--update-baseline")) {
    writeBaseline(measured);
    return;
  }

  const baseline = loadBaseline();
  const violations = verifyAgainstBaseline(measured, baseline);

  if (violations.length === 0) {
    // eslint-disable-next-line no-console
    console.log("[orch-0891-budget] PASS — bundle budget within limits.");
    return;
  }

  for (const v of violations) {
    // eslint-disable-next-line no-console
    console.error(`[orch-0891-budget] FAIL: ${v.message}`);
  }
  process.exit(1);
}

// Allow `import { measureBundle, verifyAgainstBaseline }` from the
// adversarial test without running main(). When invoked directly via
// `node ...mjs`, `process.argv[1]` ends with this file name; in that
// case run main().
//
// On macOS, `/tmp` symlinks to `/private/tmp`. `import.meta.url` uses
// the resolved real path while `process.argv[1]` keeps the symlink.
// Compare via `fs.realpathSync` on both to handle the divergence.
const isDirectInvocation = (() => {
  try {
    const importPath = fs.realpathSync(fileURLToPath(import.meta.url));
    const argvPath = fs.realpathSync(path.resolve(process.argv[1] ?? ""));
    return importPath === argvPath;
  } catch (_err) {
    return false;
  }
})();

if (isDirectInvocation) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err.stack ?? err.message ?? String(err));
    process.exit(1);
  });
}
