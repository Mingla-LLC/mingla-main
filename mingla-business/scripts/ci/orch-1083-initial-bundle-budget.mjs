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
 *      ONE-TIME ALLOWANCE (issue #4522): a single, named pull request may be
 *      granted a larger `__common` delta (and, when the entry carries `eager`, a larger eager delta) by an entry in ONE_TIME_PR_ALLOWANCE
 *      (bundle-budget-lib.mjs; the movement gate reads the same table).
 *      It never touches the general allowance or the product ceiling, it is
 *      printed on every run it applies to, and it expires by itself. See the
 *      comment on that table before adding to it.
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
  BASELINE_MOVEMENT_THRESHOLD_BYTES,
  ONE_TIME_PR_ALLOWANCE,
  resolveOneTimeAllowance,
  effectivePerPrAllowance,
  gitSubjectsSince,
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
// If your PR trips a HARD CEILING, the boot payload has grown ~20-25% since
// 2026-08-11 without anyone deciding that was acceptable. That is a product
// conversation (issue #943 owns the trim, and the parked audience-split issue
// owns the permanent cure), not a one-line edit.
//
// Seeded 2026-08-11 from a measured main (see bundle-baseline.json), with
// deliberate runway above it so the DELTA gate — not this one — is what a
// normal PR ever meets:
//   __common  brotli 439,775 → ceiling 597,000   (raised 2026-09-20, 2026-10-27, 2026-11-24)
//   __common  raw    2,341,978 → ceiling 2,940,000 (raised 2026-09-20, 2026-11-24)
//   eager     brotli 660,678 → ceiling 838,000   (raised 2026-10-17, 2026-11-24)
//   eager     raw    3,349,598 → ceiling 4,000,000 (~19% runway)
//
// RAISED 2026-09-20 — __common ONLY, from raw 2,600,000 / brotli 500,000 to raw
// 2,800,000 / brotli 550,000. Seth's call (#3493), in the open, for a reason the
// rest of this header already anticipated: main's measured baseline had crept to
// 490,955 B brotli, which leaves 9,045 B beneath the old ceiling where the
// baseline auto-merge insists on a full 12,000 B per-PR allowance. That refusal
// turned main red and blocked every pull request in every chat, so the ceiling
// moved rather than the measurement. This buys room; it settles nothing. The
// trim that brings __common back under the old numbers is tracked on the same
// issue.
//
// RAISED 2026-10-11 — eager brotli ONLY, from 750,000 to 775,000. After #3785
// recorded eager.brotli at 731,271 B, less than one 25,000 B PR allowance
// remained under 750,000 and #2524 guard 4 reded every PR. Same shape as the
// 2026-09-20 __common raise: the ceiling moved rather than the measurement.
//
// RAISED 2026-10-17 — eager brotli ONLY, from 775,000 to 800,000. After #3937
// recorded eager.brotli at 750,291 B, only 24,709 B remained and #2524 guard 4
// again reded every PR because the protected runway is one full 25,000 B
// allowance. Seth approved the product-limit move; the per-PR allowance and
// machine-maintained baseline remain unchanged.
//
// RAISED 2026-10-27 — __common brotli ONLY, from 550,000 to 560,000. After
// #4133 recorded common.brotli at 538,311 B, less than one 12,000 B PR
// allowance remained under 550,000 and #2524 guard 4 reded every PR that
// touches a workflow (first seen on #4139). Seth approved the product-limit
// move; the per-PR allowance and the machine-maintained baseline are unchanged.
//
// RAISED 2026-11-24 — __common raw 2,800,000 → 2,940,000, __common brotli
// 560,000 → 597,000 and eager brotli 800,000 → 838,000, for issue #4490 (venue
// features: the Till, Close the day, offers and the guest venue pages, whose
// Host and guest routes genuinely share code). Measured on the #4490 head
// (commit 5c991e98fe, web:export): __common 2,927,623 B raw / 584,172 B brotli
// and eager 3,969,383 B raw / 812,308 B brotli. The ceilings are set so that,
// once that measurement is recorded as the baseline, the baseline auto-merge
// still finds one full per-PR allowance beneath every ceiling (its refusal
// runway: __common 12,000 B, eager 25,000 B): 2,927,623 + 12,000 <= 2,940,000;
// 584,172 + 12,000 <= 597,000; 812,308 + 25,000 <= 838,000; eager raw
// 3,969,383 + 25,000 <= 4,000,000, so eager raw stays 4,000,000. Seth approved
// 2026-11-24 (issue #4490, comment 7140373865; raised in chat the same day to
// these figures). The per-PR allowance and the machine-maintained baseline are
// unchanged.
//
// The eager raw ceiling REPLACES the old 9,405,478 B constant, which had been
// unfailable since route splitting landed. This is a tightening, not a
// relaxation: 4,000,000 is 57% below the number it replaces.
// ═══════════════════════════════════════════════════════════════════════════
const HARD_CEILING = {
  // 2026-11-24 — __common raw 2_800_000 → 2_940_000 and brotli 560_000 →
  // 597_000, eager brotli 800_000 → 838_000 (issue #4490; Seth approved).
  common: { raw: 2_940_000, brotli: 597_000 },
  // 2026-10-17 — eager brotli 775_000 → 800_000 after #3937 recorded
  // eager.brotli at 750,291 B, which left only 24,709 B beneath the old
  // ceiling. Human limit move only; automation still cannot raise this.
  eager: { raw: 4_000_000, brotli: 838_000 },
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

// ONE-TIME ALLOWANCE (issue #4522) — the table and its resolver live in
// bundle-budget-lib.mjs (ONE_TIME_PR_ALLOWANCE, resolveOneTimeAllowance), the
// single source both `__common` gates read: this gate (against the 12,000 B
// per-PR allowance) and bundle-baseline-movement.mjs (against the 1,024 B
// movement threshold). Read the comment on that table before adding to it.
// This gate passes PR_DELTA_ALLOWANCE.common as its normal limit, so an entry
// only ever widens `common` here, never `eager` or a product ceiling.

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

// The ratchet and PR/main parity guard share one movement authority (#3493).
const RATCHET_NOTICE_THRESHOLD = BASELINE_MOVEMENT_THRESHOLD_BYTES;

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

  // 4 — the one-time allowances for #4596 and #4490 are exactly two named
  // entries. Each matches exactly one pull request; everyone else keeps the
  // normal limit. Adding an entry, widening a cap or loosening a match fails.
  {
    const E = ONE_TIME_PR_ALLOWANCE;
    const only = E[0] ?? {};
    checks.push(["one-time allowance: the general allowance is still 12,000 / 25,000",
      PR_DELTA_ALLOWANCE.common === 12_000 && PR_DELTA_ALLOWANCE.eager === 25_000]);
    checks.push(["one-time allowance: the table holds exactly two entries (#4596, #4490)", E.length === 2]);
    checks.push(["one-time allowance: that entry is PR #4601 / issue #4596 on its own branch, capped at 3,300 B, dated",
      only.pr === 4601 && only.issue === 4596 &&
        only.headRef === "4596-rsvp-event-blast-audience" &&
        only.common === 3_300 && only.expiresAfter === "2026-12-08" &&
        only.approvedBy === "Seth, 2026-11-24" &&
        typeof only.reason === "string" && only.reason.length > 40]);
    checks.push(["one-time allowance: the entry raises __common only (no eager, no ceiling)",
      Object.keys(only).sort().join(",") === "approvedBy,common,expiresAfter,headRef,issue,pr,reason"]);
    checks.push(["one-time allowance: the table and its entry are frozen",
      Object.isFrozen(E) && Object.isFrozen(only)]);

    const SHA = "a".repeat(40);
    const none = () => [];
    const merged = () => ["Unrelated change (#3900)", "toward #4596: RSVP guests in event blasts (#4601)"];
    const prEnv = (headRef, ref) => ({ GITHUB_EVENT_NAME: "pull_request", GITHUB_HEAD_REF: headRef, GITHUB_REF: ref });
    // #4596: the cap sits under the 12,000 B per-PR limit, so the entry is read by
    // the 1,024 B movement gate; these checks decide at that gate's normal limit.
    const N = BASELINE_MOVEMENT_THRESHOLD_BYTES;
    const decide = (env, subjects = none, today = "2026-11-24", commit = SHA) =>
      resolveOneTimeAllowance({ env, today, baselineCommit: commit, subjectsSinceBaseline: subjects, normalLimit: N }).entry;
    const HEAD = "4596-rsvp-event-blast-audience";

    checks.push(["one-time allowance: applies to PR #4601 from its branch",
      decide(prEnv(HEAD, "refs/pull/4601/merge")) === only]);
    const second = E[1] ?? {};
    checks.push(["one-time allowance: the second one-time entry is PR #4600 / issue #4490 on its own branch, capped at 162,000 B (eager 165,000 B), dated",
      second.pr === 4600 && second.issue === 4490 &&
        second.headRef === "4490-venue-features" &&
        second.common === 162_000 && second.eager === 165_000 && second.expiresAfter === "2026-12-08" &&
        second.approvedBy === "Seth, 2026-11-24" &&
        typeof second.reason === "string" && second.reason.length > 40 &&
        Object.keys(second).sort().join(",") === "approvedBy,common,eager,expiresAfter,headRef,issue,pr,reason" &&
        Object.isFrozen(second)]);
    checks.push(["one-time allowance: PR #4490 from its branch gets its cap, while #4596 keeps its own",
      decide(prEnv("4490-venue-features", "refs/pull/4600/merge")) === second &&
        decide(prEnv("4490-venue-features", "refs/pull/4601/merge")) === null &&
        decide(prEnv("4522-young-polish", "refs/pull/4600/merge")) === null]);
    const strangers = [
      prEnv("3697-host-ads", "refs/pull/4600/merge"),
      prEnv(HEAD, "refs/pull/4600/merge"), // same branch name, another pull request
      prEnv("3697-host-ads", "refs/pull/4601/merge"),
      prEnv(`${HEAD}-2`, "refs/pull/4601/merge"),
      prEnv(`x${HEAD}`, "refs/pull/4601/merge"),
      prEnv(HEAD.toUpperCase(), "refs/pull/4601/merge"),
      prEnv("", "refs/pull/4601/merge"),
      prEnv(HEAD, "refs/pull/46010/merge"),
      prEnv(HEAD, ""),
      {},
      { GITHUB_HEAD_REF: HEAD, GITHUB_REF: "refs/pull/4601/merge" }, // no event
      { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: `refs/heads/${HEAD}` },
      { GITHUB_EVENT_NAME: "merge_group", GITHUB_HEAD_REF: HEAD, GITHUB_REF: "refs/pull/4601/merge" },
    ];
    checks.push(["one-time allowance: every other branch, pull request or missing value gets the normal limit",
      strangers.every((env) => decide(env, merged) === null)]);

    const mainPush = { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" };
    checks.push(["one-time allowance: applies on main while the merge of #4601 is not in the baseline",
      decide(mainPush, merged) === only]);
    checks.push(["one-time allowance: dead on main once the baseline includes the merge",
      decide(mainPush, none) === null &&
        decide(mainPush, () => ["Other work (#4595)", "Mentions (#4601) mid-subject (#3901)", "x (#46011)", "(#4601) first"]) === null]);
    checks.push(["one-time allowance: never applies to a push on another branch",
      decide({ GITHUB_EVENT_NAME: "push", GITHUB_REF: `refs/heads/${HEAD}` }, merged) === null]);
    checks.push(["one-time allowance: unreadable history or an unstamped baseline is a refusal",
      decide(mainPush, () => { throw new Error("not a git repository"); }) === null &&
        decide(mainPush, merged, "2026-11-24", "unknown") === null &&
        resolveOneTimeAllowance({ env: mainPush, today: "2026-11-24", baselineCommit: undefined, subjectsSinceBaseline: merged, normalLimit: N }).entry === null]);
    checks.push(["one-time allowance: inert after its end date, on every path",
      decide(prEnv(HEAD, "refs/pull/4601/merge"), none, "2026-12-08") === only &&
        decide(prEnv(HEAD, "refs/pull/4601/merge"), none, "2026-12-09") === null &&
        decide(mainPush, merged, "2026-12-09") === null &&
        resolveOneTimeAllowance({ env: prEnv(HEAD, "refs/pull/4601/merge"), today: undefined, baselineCommit: SHA, subjectsSinceBaseline: none, normalLimit: N }).entry === null]);
    checks.push(["one-time allowance: never applies inside a test harness (fixtures meet the normal limit)",
      decide({ ...prEnv(HEAD, "refs/pull/4601/merge"), NODE_TEST_CONTEXT: "child-v8" }) === null &&
        decide({ ...mainPush, NODE_TEST_CONTEXT: "child-v8" }, merged) === null]);
    checks.push(["one-time allowance: an entry that grants nothing above the normal limit is refused",
      resolveOneTimeAllowance({
        env: prEnv(HEAD, "refs/pull/4601/merge"), today: "2026-11-24", baselineCommit: SHA, subjectsSinceBaseline: none,
        normalLimit: N, table: [{ ...only, common: N }, { ...only, common: Infinity }],
      }).entry === null]);
    checks.push(["one-time allowance: a caller that passes no normal limit gets no grant",
      [undefined, 0, -1, 1.5].every((normalLimit) => resolveOneTimeAllowance({
        env: prEnv(HEAD, "refs/pull/4601/merge"), today: "2026-11-24", baselineCommit: SHA, subjectsSinceBaseline: none, normalLimit,
      }).entry === null)]);
    checks.push(["one-time allowance: absent `eager` means the normal 25,000 B; a stranger or expired run gets nothing for eager either",
      (() => {
        const venue = prEnv("4490-venue-features", "refs/pull/4600/merge");
        const grant = (env, today = "2026-11-24", table = E) =>
          effectivePerPrAllowance(
            resolveOneTimeAllowance({ env, today, baselineCommit: SHA, subjectsSinceBaseline: none, normalLimit: N, table }).entry,
            PR_DELTA_ALLOWANCE,
          );
        return effectivePerPrAllowance(only, PR_DELTA_ALLOWANCE).eager === 25_000 &&
          grant(venue).eager === 165_000 && grant(venue).common === 162_000 &&
          grant(prEnv(HEAD, "refs/pull/4600/merge")).eager === 25_000 &&
          grant(prEnv("other-branch", "refs/pull/4600/merge")).eager === 25_000 &&
          grant(venue, "2026-12-09").eager === 25_000 &&
          grant({ ...venue, NODE_TEST_CONTEXT: "x" }).eager === 25_000 &&
          effectivePerPrAllowance({ ...second, eager: 25_000 }, PR_DELTA_ALLOWANCE).eager === 25_000 &&
          effectivePerPrAllowance({ ...second, eager: Infinity }, PR_DELTA_ALLOWANCE).eager === 25_000 &&
          effectivePerPrAllowance(null, PR_DELTA_ALLOWANCE).eager === 25_000;
      })()]);
    checks.push(["one-time allowance: the same entry serves the 1,024 B movement gate (one table, two gates)",
      resolveOneTimeAllowance({
        env: prEnv(HEAD, "refs/pull/4601/merge"), today: "2026-11-24", baselineCommit: SHA, subjectsSinceBaseline: none,
        normalLimit: BASELINE_MOVEMENT_THRESHOLD_BYTES,
      }).entry === only]);
    checks.push(["one-time allowance: under the 12,000 B per-PR limit the #4601 entry grants nothing (that gate keeps its normal limit)",
      resolveOneTimeAllowance({
        env: prEnv(HEAD, "refs/pull/4601/merge"), today: "2026-11-24", baselineCommit: SHA, subjectsSinceBaseline: none,
        normalLimit: PR_DELTA_ALLOWANCE.common,
      }).entry === null]);
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
// The one-time allowance (issue #4522) is resolved here, AFTER the product
// ceilings above have already been enforced, and it can only widen `common`.
const oneTime = resolveOneTimeAllowance({
  env: process.env,
  today: new Date().toISOString().slice(0, 10),
  baselineCommit: baseline?.measuredOn?.commit,
  subjectsSinceBaseline: gitSubjectsSince,
  normalLimit: PR_DELTA_ALLOWANCE.common,
});
const allowance = { ...PR_DELTA_ALLOWANCE };
const fmtB = (n) => n.toLocaleString("en-US");
if (oneTime.entry) {
  const e = oneTime.entry;
  const commonDelta = measured.common ? measured.common.raw - baseline.common.raw : 0;
  const used = commonDelta > PR_DELTA_ALLOWANCE.common;
  const granted = effectivePerPrAllowance(e, PR_DELTA_ALLOWANCE);
  allowance.common = granted.common;
  allowance.eager = granted.eager;
  console.log(
    `\nNOTICE — ONE-TIME ALLOWANCE IN EFFECT for __common (issue #${e.issue}, PR #${e.pr}).\n` +
      `  normal per-PR limit   ${fmtB(PR_DELTA_ALLOWANCE.common)} B\n` +
      `  granted for this run  ${fmtB(e.common)} B (a cap, not an exemption)\n` +
      `  measured delta        ${fmtDelta(commonDelta)} B\n` +
      `  verdict it changes    ${
        used
          ? commonDelta > e.common
            ? "none: the delta is over the granted cap too, so this run FAILS below"
            : `the normal limit would have FAILED this run by ${fmtB(commonDelta - PR_DELTA_ALLOWANCE.common)} B`
          : "none: the delta is inside the normal limit, the exception is unused"
      }\n` +
      `  applies because       ${oneTime.via}\n` +
      `  reason                ${e.reason}\n` +
      `  approved by           ${e.approvedBy}\n` +
      `  expires               by itself: on main once the baseline records the merge, and everywhere after ${e.expiresAfter}\n` +
      `  eager payload         ${
        granted.eager > PR_DELTA_ALLOWANCE.eager
          ? `granted for this run ${fmtB(granted.eager)} B (a cap, not an exemption; normal ${fmtB(PR_DELTA_ALLOWANCE.eager)} B)`
          : `unchanged at ${fmtB(PR_DELTA_ALLOWANCE.eager)} B`
      }\n` +
      `  unchanged             both product ceilings`,
  );
} else {
  for (const why of oneTime.refusals) {
    console.log(`one-time allowance not applied (normal ${fmtB(PR_DELTA_ALLOWANCE.common)} B limit stands) — ${why}`);
  }
}

for (const { key, label, got } of scopes) {
  if (!got) continue;
  const base = baseline[key];
  const delta = got.raw - base.raw;
  if (delta > allowance[key]) {
    fail(
      `${label} grew ${delta.toLocaleString("en-US")} B in this branch — over the ` +
        `${allowance[key].toLocaleString("en-US")} B ${
          allowance[key] === PR_DELTA_ALLOWANCE[key]
            ? "a single PR may add"
            : `this run was granted (one-time cap; the normal limit is ${fmtB(PR_DELTA_ALLOWANCE[key])} B)`
        }.\n\n` +
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
