#!/usr/bin/env node
/**
 * Business-web boot-payload gate.
 *
 * Origin: ORCH-1083 (M-3 / SC-3 / I-PROPOSED-1083-A). Rebuilt by issue #1509.
 *
 * Run AFTER `npm run web:export` (from mingla-business/).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE WAS REBUILT — read before changing anything (issue #1509)
 * ─────────────────────────────────────────────────────────────────────────────
 * The original gate protected the eager `__common` chunk with a single
 * hand-edited constant sitting ~10 KB above wherever main last landed. Several
 * PRs merge per day and each adds a few KB, so the headroom was consumed in
 * days and the only available action at the gate was to edit the number upward.
 * That happened five times — 2026-07-18, 07-30, 08-03, 08-10, 08-11 — with the
 * interval collapsing from twelve days to one. Every individual raise was
 * measured and honestly documented. That was never the problem. The problem is
 * that a number which can only move up is not a budget; it is a changelog.
 *
 * Two further defects were found while rebuilding it:
 *
 *   - The total-payload ceiling (9,405,478 B) was measured in June 2026 when the
 *     whole app was eager. Route splitting (ORCH-1085/1098) later cut the real
 *     payload to ~3.35 MB and the ceiling was never rebaselined, leaving it 2.8x
 *     above reality. It could not fail. Same for `chunkCount >= 3` against an
 *     export that emits ~180 chunks. Two of the four original checks had been
 *     silently vacuous for months while being cited as live protection.
 *
 *   - Every number was RAW bytes. Vercel serves brotli, so the figure a guest on
 *     mobile data actually waits for had never once been recorded.
 *
 * The mechanism below separates three things the old constant conflated:
 *
 *   1. BASELINE — what main measured last (bundle-baseline.json). Machine-
 *      maintained. Ratchets DOWN automatically after every merge that shrinks
 *      the payload, so improvements are banked instead of evaporating.
 *   2. PR_DELTA_ALLOWANCE — how much ONE pull request may add on top of the
 *      baseline. This is the tripwire: it catches a heavy eager import, and it
 *      names the offending delta instead of demanding a number be edited.
 *   3. HARD_CEILING — the product limit. An absolute constant. Nothing automated
 *      may move it and no PR should; it is Seth's decision in its own commit.
 *
 * Net effect: a sixth quiet bump is structurally impossible. Growth is loud,
 * reduction is permanent, and the ceiling that represents a product judgement is
 * the only number a human touches.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CHECKS
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. HARD CEILING — eager payload and `__common` are under the product limit,
 *      in BOTH raw bytes and brotli (the customer-felt number).
 *   2. PER-PR DELTA — neither eager nor `__common` exceeds baseline + allowance.
 *   3. CODE-SPLIT POINTS still exist (the export is genuinely chunked).
 *   4. DEFERRED SPECIFIERS — the Stripe Connect web SDK, the QR renderer and the
 *      14 @expo-google-fonts/* families are not statically reachable from the
 *      MAIN entry chunk, nor from ANY eager script. UNCHANGED by #1509: this
 *      half of the gate works and has caught real regressions.
 *   5. RATCHET NOTICE — if the payload shrank meaningfully below the baseline,
 *      say so. Informational on a PR (never fail a PR for being better); the
 *      post-merge workflow is what actually banks it.
 *
 * Self-test: pass `--self-test`.
 *
 * Refs: SPEC §6 M-3, §8 I-PROPOSED-1083-A; issue #1509; issue #943 (attribution).
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFERRED_SPECIFIERS,
  measureWebBuild,
  fmtTriple,
  fmtDelta,
} from "./bundle-budget-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_BUILD = process.env.ORCH_1083_WEB_BUILD ?? "web-build";

// ═══════════════════════════════════════════════════════════════════════════
// HARD CEILING — THE PRODUCT LIMIT. DO NOT RAISE TO UNBLOCK A PULL REQUEST.
//
// These are the only numbers in the boot-budget system that represent a
// judgement rather than a measurement, and moving one is Seth's call, made
// deliberately, in a commit that does nothing else.
//
// If your PR trips a HARD CEILING, the boot payload has grown ~11-14% since
// 2026-08-11 without anyone deciding that was acceptable. That is a product
// conversation (issue #943 owns the trim, and the parked audience-split issue
// owns the permanent cure), not a one-line edit.
//
// Seeded 2026-08-11 from a measured main (see bundle-baseline.json), with
// deliberate runway above it so the DELTA gate — not this one — is what a
// normal PR ever meets:
//   __common  brotli 439,775 → ceiling 500,000   (~14% runway)
//   __common  raw    2,341,978 → ceiling 2,600,000 (~11% runway)
//   eager     brotli 660,678 → ceiling 750,000   (~14% runway)
//   eager     raw    3,349,598 → ceiling 4,000,000 (~19% runway)
//
// The eager raw ceiling REPLACES the old 9,405,478 B constant, which had been
// unfailable since route splitting landed. This is a tightening, not a
// relaxation: 4,000,000 is 57% below the number it replaces.
// ═══════════════════════════════════════════════════════════════════════════
const HARD_CEILING = {
  common: { raw: 2_600_000, brotli: 500_000 },
  eager: { raw: 4_000_000, brotli: 750_000 },
};

// How much ONE pull request may add on top of main's measured baseline.
//
// Calibrated against every real delta on record: #1503 added 3,870 B, #871 about
// 3 KB, #1835 3,660 B. 12 KB is roughly three times the largest legitimate
// single-PR growth ever observed, while an actual regression — a heavy library
// pulled into the boot path — is tens to hundreds of KB and trips instantly.
//
// It also ends the macOS/Linux variance failure mode for good. The #871 raise
// was forced by a 149 B platform difference against ~9.9 KB of headroom; this
// allowance is 80x that variance, so where the baseline was measured no longer
// matters.
const PR_DELTA_ALLOWANCE = { common: 12_000, eager: 25_000 };

// The 2026-08-11 measurement the ceilings were set against. FIXED — this is the
// origin point that makes "% of runway consumed" mean something over time. It is
// deliberately NOT read from bundle-baseline.json (which tracks main and moves);
// if it moved with the baseline, drift would always read as 0% consumed, which
// is precisely the blindness that let five raises pass unremarked.
const SEED = {
  date: "2026-08-11",
  common: { raw: 2_341_978, brotli: 439_775 },
  eager: { raw: 3_349_598, brotli: 660_678 },
};

// Below this, a shrink is measurement noise and not worth a ratchet PR.
const RATCHET_NOTICE_THRESHOLD = 2_048;

const MIN_CHUNKS = 3;

function fail(msg) {
  console.error(`\nbundle-budget FAIL: ${msg}\n`);
  process.exit(1);
}

// ── Self-test ───────────────────────────────────────────────────────────────
// Proves the three mechanisms this gate depends on actually discriminate,
// without needing a web export. Each assertion is written so that breaking the
// corresponding production check breaks the self-test too.
if (process.argv.includes("--self-test")) {
  const checks = [];

  // 1 — the deferred-specifier detector still detects.
  const fixture = 'import x from "@stripe/connect-js"; const y = "ok";';
  checks.push([
    "deferred-specifier detector",
    DEFERRED_SPECIFIERS.find((s) => fixture.includes(s)) === "@stripe/connect-js",
  ]);
  checks.push([
    "deferred-specifier detector does not false-positive",
    DEFERRED_SPECIFIERS.every((s) => !'import y from "react";'.includes(s)),
  ]);

  // 2 — the baseline file is present, parseable, and complete. A missing or
  // malformed baseline must be a hard error, never a silently-skipped check.
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(join(HERE, "bundle-baseline.json"), "utf8"));
  } catch (err) {
    console.error(`bundle-budget self-test FAILED: baseline unreadable: ${err.message}`);
    process.exit(1);
  }
  for (const scope of ["common", "eager"]) {
    for (const unit of ["raw", "gzip", "brotli"]) {
      checks.push([
        `baseline.${scope}.${unit} is a positive number`,
        Number.isFinite(baseline?.[scope]?.[unit]) && baseline[scope][unit] > 0,
      ]);
    }
  }

  // 3 — the ordering invariant that makes the whole design work: every hard
  // ceiling must sit ABOVE baseline + allowance, or the delta gate is dead code
  // and we are back to a single conflated number.
  for (const scope of ["common", "eager"]) {
    checks.push([
      `${scope}: hard ceiling is above baseline + allowance (delta gate is reachable)`,
      HARD_CEILING[scope].raw > baseline[scope].raw + PR_DELTA_ALLOWANCE[scope],
    ]);
    checks.push([
      `${scope}: baseline is under the hard ceiling (main is currently legal)`,
      baseline[scope].raw < HARD_CEILING[scope].raw &&
        baseline[scope].brotli < HARD_CEILING[scope].brotli,
    ]);
    checks.push([
      `${scope}: compression ordering holds (brotli < gzip < raw)`,
      baseline[scope].brotli < baseline[scope].gzip &&
        baseline[scope].gzip < baseline[scope].raw,
    ]);
  }

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}`);
  }
  if (failed.length > 0) {
    console.error(`\nbundle-budget self-test FAILED (${failed.length}/${checks.length}).`);
    process.exit(1);
  }
  console.log(`\nbundle-budget self-test PASS (${checks.length} assertions).`);
  process.exit(0);
}

// ── Measure ─────────────────────────────────────────────────────────────────
let measured;
try {
  measured = measureWebBuild(WEB_BUILD);
} catch (err) {
  fail(err.message);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(join(HERE, "bundle-baseline.json"), "utf8"));
} catch (err) {
  // A missing baseline must never degrade into "no budget enforced".
  fail(
    `cannot read scripts/ci/bundle-baseline.json: ${err.message}\n` +
      `  Without a baseline this gate cannot tell growth from drift. Restore the file ` +
      `rather than removing the check.`,
  );
}

const scopes = [
  { key: "common", label: "__common (eager shared chunk)", got: measured.common },
  { key: "eager", label: "eager payload (all boot <script>s)", got: measured.eager },
];

// ── Report every run, pass or fail. A gate that only speaks when angry leaves
//    no record of drift, which is how the last five raises crept up unnoticed.
console.log("\nbusiness-web boot payload");
console.log("─".repeat(78));
for (const { key, label, got } of scopes) {
  if (!got) continue;
  const base = baseline[key];
  console.log(`  ${label}`);
  console.log(`    measured   ${fmtTriple(got)}`);
  console.log(`    baseline   ${fmtTriple(base)}`);
  console.log(
    `    delta      raw ${fmtDelta(got.raw - base.raw)} · brotli ${fmtDelta(
      got.brotli - base.brotli,
    )}`,
  );
  console.log(
    `    ceiling    raw ${HARD_CEILING[key].raw.toLocaleString(
      "en-US",
    )} · brotli ${HARD_CEILING[key].brotli.toLocaleString("en-US")}`,
  );
  // Runway is printed on EVERY run, passing or failing. Slow drift is what
  // produced five raises in four weeks, and it is invisible unless something
  // states it out loud while everything is still green.
  const runway = HARD_CEILING[key].brotli - got.brotli;
  const consumed = (
    ((got.brotli - SEED[key].brotli) / (HARD_CEILING[key].brotli - SEED[key].brotli)) *
    100
  ).toFixed(1);
  console.log(
    `    runway     ${runway.toLocaleString("en-US")} B brotli to the product ceiling ` +
      `(${consumed}% consumed since ${SEED.date})`,
  );
}
console.log(`  chunk files: ${measured.chunkCount}`);
console.log("─".repeat(78));

// ── 1. HARD CEILING ─────────────────────────────────────────────────────────
for (const { key, label, got } of scopes) {
  if (!got) continue;
  for (const unit of ["raw", "brotli"]) {
    if (got[unit] > HARD_CEILING[key][unit]) {
      fail(
        `${label} is ${got[unit].toLocaleString("en-US")} B ${unit}, over the PRODUCT ` +
          `CEILING of ${HARD_CEILING[key][unit].toLocaleString("en-US")} B.\n\n` +
          `  This ceiling is not a build detail — it is the boot cost we decided a guest ` +
          `arriving on a public event, trip or Stay page should pay.\n` +
          `  Do NOT raise it to land this PR. Either bring the payload back under it, or ` +
          `take it to Seth as an explicit product decision.\n` +
          `  Attribution tooling: node scripts/ci/bundle-attribute.mjs (issue #943).`,
      );
    }
  }
}

// ── 2. PER-PR DELTA ─────────────────────────────────────────────────────────
for (const { key, label, got } of scopes) {
  if (!got) continue;
  const base = baseline[key];
  const delta = got.raw - base.raw;
  if (delta > PR_DELTA_ALLOWANCE[key]) {
    fail(
      `${label} grew ${delta.toLocaleString("en-US")} B in this branch — over the ` +
        `${PR_DELTA_ALLOWANCE[key].toLocaleString("en-US")} B a single PR may add.\n\n` +
        `  baseline (main) ${base.raw.toLocaleString("en-US")} B → this branch ` +
        `${got.raw.toLocaleString("en-US")} B\n\n` +
        `  This is the tripwire. It means one change put a meaningful amount of new ` +
        `JavaScript into the payload every visitor downloads before anything renders.\n` +
        `  Find out what: node scripts/ci/bundle-attribute.mjs --compare\n\n` +
        `  Note that ${key === "common" ? "__common" : "the eager payload"} also grows when ` +
        `a module is shared between two LAZY chunks — Metro hoists it into the boot path ` +
        `even though no boot screen uses it. If that is what happened, say so in the PR ` +
        `with the measurement; do not split a cohesive module purely to dodge this gate ` +
        `(issue #1509 rejects that by default).\n\n` +
        `  Editing bundle-baseline.json to make this pass is the specific habit issue ` +
        `#1509 exists to end.`,
    );
  }
}

// ── 3. CODE-SPLIT POINTS ────────────────────────────────────────────────────
if (measured.chunkCount < MIN_CHUNKS) {
  fail(
    `expected >= ${MIN_CHUNKS} chunk files under the web export, found ` +
      `${measured.chunkCount} (code-split points missing — the whole app would be eager).`,
  );
}

// ── 4. DEFERRED SPECIFIERS (unchanged by #1509) ─────────────────────────────
const mainSrc = readFileSync(join(WEB_BUILD, measured.mainEntryRel.replace(/^\//, "")), "utf8");
const mainOffenders = DEFERRED_SPECIFIERS.filter((s) => mainSrc.includes(s));
if (mainOffenders.length > 0) {
  fail(
    `deferred specifier(s) leaked back into the MAIN entry chunk ` +
      `${measured.mainEntryRel}:\n  ${mainOffenders.join("\n  ")}`,
  );
}

// ORCH-1085: async route splitting can legitimately create a larger shared
// runtime chunk, so protect ORCH-1083's original deferrals across EVERY eager
// script rather than relying only on the main-entry check above.
const eagerOffenders = [];
for (const rel of measured.scriptRels) {
  const src = readFileSync(join(WEB_BUILD, rel.replace(/^\//, "")), "utf8");
  for (const specifier of DEFERRED_SPECIFIERS) {
    if (src.includes(specifier)) eagerOffenders.push(`${rel}: ${specifier}`);
  }
}
if (eagerOffenders.length > 0) {
  fail(`deferred specifier(s) leaked back into eager script(s):\n  ${eagerOffenders.join("\n  ")}`);
}

// ── 5. RATCHET NOTICE ───────────────────────────────────────────────────────
const shrunk = scopes
  .filter(({ key, got }) => got && baseline[key].raw - got.raw >= RATCHET_NOTICE_THRESHOLD)
  .map(({ key, got }) => `${key} −${(baseline[key].raw - got.raw).toLocaleString("en-US")} B`);
if (shrunk.length > 0) {
  console.log(
    `\nNOTICE — boot payload is SMALLER than the recorded baseline (${shrunk.join(", ")}).\n` +
      `  Not a failure. The post-merge ratchet (.github/workflows/bundle-baseline-ratchet.yml)\n` +
      `  will lower bundle-baseline.json once this lands on main, so the improvement is kept.`,
  );
}

console.log(
  `\nbundle-budget PASS — ${measured.chunkCount} chunks, 0 deferred specifiers in any ` +
    `eager script, both scopes within baseline+allowance and under the product ceiling.\n`,
);
