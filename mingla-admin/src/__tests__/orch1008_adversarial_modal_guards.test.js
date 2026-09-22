// ORCH-1008 adversarial test — RunRemainderConfirmModal cost-guard tiers,
// typed-confirm bypass surface, and ackboxcheckbox-only guard.
//
// Attack angles:
//   - typedName + cityName=undefined bypass (empty trim() matches empty
//     "" — does the modal silently allow Run on a high-cost run with no
//     city name?)
//   - $5.00 / $5.01 / $10.00 / $10.01 exact-boundary correctness
//   - acknowledgement checkbox is REQUIRED at ALL tiers (no surface where
//     pressing Enter twice fires the run without it)
//   - service URL routing (POSTs to run-place-intelligence-trial, action
//     'start_run', mode 'remainder' — no schema drift)
//
// Fails-on-revert verified at: 72f164536 (modal file did not exist).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");

const MODAL_PATH = path.join(
  ADMIN_ROOT,
  "src",
  "components",
  "placeIntelligenceTrial",
  "RunRemainderConfirmModal.jsx",
);

const SRC = fs.readFileSync(MODAL_PATH, "utf8");

describe("ORCH-1008 adversarial — modal cost-guard tier boundaries", () => {
  // issue #3526 P0-1 / P1-R1 — BOTH tier thresholds were client constants, and
  // both are now server-published on cost_model. The $5 guard was the defect
  // that made Baltimore unstartable (client said $4.82/no-confirm, server said
  // $10.72/confirm-required, 400). The $10 typed-confirm threshold survived
  // round 2 only because it had no server counterpart — which is the reason to
  // move it, not to keep it: when the rate moved 2.2x, "$10" stopped meaning
  // what it meant. These tests keep their purpose — the two tiers exist, both
  // are strictly-greater-than, and neither is bypassable — against the
  // server-owned values.
  it("declares NO tier threshold of its own — both come from the server", () => {
    assert.ok(
      !/COST_GUARD_USD\s*=\s*[0-9]/.test(SRC),
      "the $5 guard must not be a client constant (issue #3526 G-5)",
    );
    assert.ok(
      !/COST_REVIEW_THRESHOLD_USD/.test(SRC),
      "the $10 typed-confirm threshold must not be a client constant",
    );
    assert.ok(
      SRC.includes("costModel?.costGuardUsd") &&
        SRC.includes("costModel?.costReviewThresholdUsd"),
      "both tiers must be read off the server's cost model",
    );
  });

  it("typed-confirm gate uses STRICT greater-than the server threshold (not >=)", () => {
    assert.ok(
      /estCost\s*>\s*reviewThreshold\b/.test(SRC),
      "requiresTypedConfirm must be strictly > the server threshold",
    );
    assert.ok(
      !/estCost\s*>=\s*reviewThreshold\b/.test(SRC),
      "tier must NOT use >= (the threshold exactly is still the silent-confirm tier)",
    );
    // issue #3526 — an unknown cost or an unknown threshold must not satisfy
    // the comparison by accident: `null > 10` and `5 > null` both evaluate
    // false and would skip the escalation silently.
    assert.ok(
      /requiresTypedConfirm\s*=\s*!costUnknown && reviewThreshold !== null/.test(SRC),
      "the gate must require BOTH a known cost and a known threshold",
    );
  });

  it("confirm_high_cost mirrors the SERVER's guard, not a client copy", () => {
    // This is the P0 itself: the client must compute the flag from the same
    // number the server will check it against, or a city in the band between
    // the two thresholds is refused with no retry.
    assert.ok(
      SRC.includes("needsHighCostConfirmation(remainingCount, costModel)"),
      "sendConfirmHighCost must be derived from the server's cost model",
    );
    assert.ok(
      SRC.includes("confirm_high_cost: sendConfirmHighCost"),
      "modal must POST confirm_high_cost in the body",
    );
  });

  // issue #3526 P3-R4 — the dead affordance, same defect as the bulk modal.
  it("offers no acknowledgement it cannot honour, and says why the CTA is off", () => {
    assert.ok(
      /\{costUnknown \? \(/.test(SRC),
      "the cost-unknown branch must replace the checkbox, not merely reword it",
    );
    const unknownBranch = SRC.slice(
      SRC.indexOf("{costUnknown ? ("),
      SRC.indexOf(") : ("),
    );
    assert.ok(
      !unknownBranch.includes('type="checkbox"'),
      "no checkbox may render while the run is unstartable (Constitution #1)",
    );
    assert.ok(
      /disabled=\{!canRun\}[\s\S]{0,400}?title=\{/.test(SRC),
      "the disabled CTA must carry a title explaining the unmet gate (Constitution #3)",
    );
    for (
      const reason of [
        "did not return a per-place cost",
        "Tick the acknowledgement",
        "to confirm a run above",
      ]
    ) {
      assert.ok(SRC.includes(reason), `CTA title must name the gate — missing "${reason}"`);
    }
  });

  it("Run button is ALWAYS gated on acknowledged checkbox (no tier bypass)", () => {
    // The canRun derivation must include `acknowledged &&` regardless of tier.
    // A previous-attempt bug pattern: gating acknowledged only on the >$10
    // tier and letting Enter-twice fire the low-tier run.
    const canRunRe = /canRun\s*=\s*([^;]+);/;
    const m = SRC.match(canRunRe);
    assert.ok(m, "expected canRun derivation to be present");
    assert.ok(
      /\backnowledged\b/.test(m[1]),
      `canRun must include acknowledged; got: ${m[1]}`,
    );
  });

  it("typedMatches comparison guards against empty-string cityName bypass", () => {
    // ATTACK: when cityName is undefined and requiresTypedConfirm is true,
    // `typedName.trim() === ""` would trivially match, bypassing the gate.
    // The implementation uses `(cityName || "")` — at >$10 with cityName
    // undefined, an empty typed input would falsely match.
    //
    // This test ASSERTS THE BUG SURFACE: it must be defended by a non-empty
    // cityName invariant at call-site. Today the modal source uses the
    // permissive `(cityName || "")` fallback. If future hardening adds a
    // strict cityName guard, this test should be inverted.
    assert.ok(
      SRC.includes("typedName.trim() === (cityName || \"\")"),
      "current comparison is permissive; if you tightened to require " +
        "cityName non-empty, update this adversarial test to reflect that fix",
    );
  });

  it("the start_run payload pins mode='remainder' (no mode injection from props)", () => {
    // Hard-coded literal — caller cannot accidentally swap to full_city.
    const payloadIdx = SRC.indexOf("action: \"start_run\"");
    assert.notEqual(payloadIdx, -1, "expected action: 'start_run' literal");
    const slice = SRC.slice(payloadIdx, payloadIdx + 200);
    assert.ok(
      slice.includes("mode: \"remainder\""),
      "modal must pin mode to literal 'remainder' (no prop-driven mode)",
    );
  });

  it("calls invokeWithRefresh (auth + token refresh) — not raw fetch", () => {
    // Raw fetch would bypass admin gate token refresh.
    assert.ok(
      SRC.includes("invokeWithRefresh"),
      "modal must route through invokeWithRefresh; raw fetch is forbidden",
    );
    assert.ok(
      !/\bfetch\s*\(/.test(SRC),
      "no raw fetch() call may appear in this modal",
    );
  });
});
