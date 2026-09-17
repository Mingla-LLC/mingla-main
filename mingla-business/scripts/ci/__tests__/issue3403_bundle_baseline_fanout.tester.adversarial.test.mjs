/**
 * Issue #3403 tester adversarial guard.
 *
 * The implementor guard derives a count from the current KEEP workflow YAML.
 * This independent angle pins the automation's public decision and diagnostic
 * against the observed production sequence, so a stale ceiling cannot make a
 * healthy recording merge look like a new scoping regression again.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHECK_FANOUT_CEILING,
  assessCheckFanout,
  renderSummary,
} from "../bundle-baseline-automerge.mjs";

const OBSERVED_RECORDING_PULLS = Object.freeze([
  { number: 3324, checkRuns: 22 },
  { number: 3338, checkRuns: 26 },
  { number: 3356, checkRuns: 26 },
  { number: 3368, checkRuns: 26 },
  { number: 3400, checkRuns: 26 },
]);

test("#3403 — every observed recording PR is accepted while the next check above the bounded room is rejected", () => {
  assert.equal(CHECK_FANOUT_CEILING, 32, "26 measured checks plus #2885's six-check room is the bounded ceiling");

  for (const sample of OBSERVED_RECORDING_PULLS) {
    assert.deepEqual(
      assessCheckFanout(sample.checkRuns),
      {
        ok: true,
        count: sample.checkRuns,
        ceiling: 32,
        reason: "FANOUT_SCOPED",
      },
      `recording PR #${sample.number} must not turn main red`,
    );
  }

  assert.deepEqual(
    assessCheckFanout(33),
    { ok: false, count: 33, ceiling: 32, reason: "FANOUT_REGRESSED" },
    "the correction must stay bounded: the first check above the six-check room is still a regression",
  );
});

test("#3403 — the operator summary tells the truth at the stable 26-check shape and at a real regression", () => {
  const stable = renderSummary({
    state: "MERGED",
    reason: "GUARDS_SATISFIED",
    checkCount: 26,
    fanout: assessCheckFanout(26),
  });
  assert.match(stable, /checks reported on the candidate: 26 \(ceiling 32, FANOUT_SCOPED\)/);
  assert.doesNotMatch(stable, /FANOUT_REGRESSED/, "the known-good production shape must not send a false alarm");

  const regression = renderSummary({
    state: "MERGED",
    reason: "GUARDS_SATISFIED",
    checkCount: 33,
    fanout: assessCheckFanout(33),
  });
  assert.match(regression, /checks reported on the candidate: 33 \(ceiling 32, FANOUT_REGRESSED\)/);
});
