#!/usr/bin/env node
/**
 * Issue #3493 — identical raw `__common` movement verdict on PRs and main.
 *
 * Run after `npm run web:export`. This has no changed-path branch: the
 * workflow decides when a build can affect the Business bundle, and every such
 * build is measured here the same way, on pull requests and on main.
 *
 * The one exception path is the named ONE_TIME_PR_ALLOWANCE table in
 * bundle-budget-lib.mjs, the same table orch-1083 reads (issue #4522: Seth
 * extended the #4594 entry to this gate on 2026-11-24). resolveOneTimeAllowance
 * is the only code here that reads the run's event, ref and head branch; it
 * grants the entry's `common` cap in place of the 1,024 B threshold only for
 * that pull request on its branch, or on main until the recorded baseline
 * includes its merge, never after the entry's end date and never inside a test
 * harness. The threshold itself never changes. Every run the entry touches
 * prints the normal threshold, the granted cap, the delta, the reason and the
 * approver; every run it does not touch says so in one line.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASELINE_MOVEMENT_THRESHOLD_BYTES,
  assessCommonBaselineMovement,
  gitSubjectsSince,
  measureWebBuild,
  resolveOneTimeAllowance,
} from "./bundle-budget-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_BUILD = process.env.ORCH_1083_WEB_BUILD ?? "web-build";

function fail(message) {
  console.error(`\nbundle-baseline-movement FAIL: ${message}\n`);
  process.exit(1);
}

let baseline;
try {
  baseline = JSON.parse(
    readFileSync(join(HERE, "bundle-baseline.json"), "utf8"),
  );
} catch (error) {
  fail(`baseline is unreadable: ${error.message}`);
}

let measured;
try {
  measured = measureWebBuild(WEB_BUILD);
} catch (error) {
  fail(`web export is unreadable: ${error.message}`);
}

if (measured.common === null) {
  fail("the web export has no eager __common chunk");
}

const fmtB = (n) => n.toLocaleString("en-US");
const fmtSigned = (n) => `${n >= 0 ? "+" : ""}${fmtB(n)}`;

const oneTime = resolveOneTimeAllowance({
  env: process.env,
  today: new Date().toISOString().slice(0, 10),
  baselineCommit: baseline?.measuredOn?.commit,
  subjectsSinceBaseline: gitSubjectsSince,
  normalLimit: BASELINE_MOVEMENT_THRESHOLD_BYTES,
});

let verdict;
try {
  verdict = assessCommonBaselineMovement(
    baseline?.common?.raw,
    measured.common.raw,
    oneTime.entry ? { oneTimeCap: oneTime.entry.common } : {},
  );
} catch (error) {
  fail(error.message);
}

if (oneTime.entry) {
  const e = oneTime.entry;
  console.log(
    `NOTICE — ONE-TIME ALLOWANCE IN EFFECT for the __common movement threshold (issue #${e.issue}, PR #${e.pr}).\n` +
      `  normal threshold      +${fmtB(BASELINE_MOVEMENT_THRESHOLD_BYTES)} B (unchanged)\n` +
      `  granted for this run  +${fmtB(e.common)} B (a cap, not an exemption)\n` +
      `  measured delta        ${fmtSigned(verdict.delta)} B\n` +
      `  verdict it changes    ${
        verdict.normalOk
          ? "none: the delta is inside the normal threshold, the exception is unused"
          : verdict.ok
            ? `the normal threshold would have FAILED this run by ${fmtB(verdict.delta - BASELINE_MOVEMENT_THRESHOLD_BYTES)} B`
            : "none: the delta is over the granted cap too, so this run FAILS below"
      }\n` +
      `  applies because       ${oneTime.via}\n` +
      `  reason                ${e.reason}\n` +
      `  approved by           ${e.approvedBy}\n` +
      `  expires               by itself: on main once the baseline records the merge, and everywhere after ${e.expiresAfter}`,
  );
} else {
  console.log(
    `one-time allowance not applied (normal +${fmtB(BASELINE_MOVEMENT_THRESHOLD_BYTES)} B threshold stands) — ` +
      (oneTime.refusals.join("; ") || "no entry"),
  );
}

console.log(
  `__common raw: baseline ${fmtB(baseline.common.raw)} B -> ` +
    `measured ${fmtB(measured.common.raw)} B ` +
    `(delta ${fmtSigned(verdict.delta)} B; ` +
    `limit +${fmtB(verdict.threshold)} B${oneTime.entry ? `, one-time cap; normal +${fmtB(BASELINE_MOVEMENT_THRESHOLD_BYTES)} B` : ""})`,
);

if (!verdict.ok) {
  fail(
    `eager __common grew ${fmtB(verdict.delta)} B, above the ` +
      (oneTime.entry
        ? `${fmtB(verdict.threshold)} B one-time cap granted to PR #${oneTime.entry.pr} (the shared movement threshold is ${fmtB(BASELINE_MOVEMENT_THRESHOLD_BYTES)} B). `
        : `shared ${fmtB(verdict.threshold)} B movement threshold. `) +
      "Move host-only code behind an on-intent chunk. Do not edit the baseline or threshold to " +
      "clear this; a one-pull-request exception is a named ONE_TIME_PR_ALLOWANCE entry Seth approves.",
  );
}

console.log("bundle-baseline-movement PASS");
