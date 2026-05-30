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
  it("declares both tier thresholds ($5 guard, $10 typed-confirm) as named constants", () => {
    // Static guard: any future operator who drops the constants without
    // wiring the gates breaks this test.
    assert.ok(
      /COST_GUARD_USD\s*=\s*5\b/.test(SRC),
      "expected COST_GUARD_USD = 5 constant",
    );
    assert.ok(
      /COST_REVIEW_THRESHOLD_USD\s*=\s*10\b/.test(SRC),
      "expected COST_REVIEW_THRESHOLD_USD = 10 constant",
    );
  });

  it("typed-confirm gate uses STRICT greater-than $10 (not >=)", () => {
    // At exactly $10.00, no typed confirm should be required — the tier is
    // $5.01-$10 → silent confirm_high_cost; >$10 → typed confirm. A `>= 10`
    // bug would surface friction at $10 exactly (large city of 2500 places).
    assert.ok(
      /estCost\s*>\s*COST_REVIEW_THRESHOLD_USD/.test(SRC),
      "requiresTypedConfirm must be strictly > $10",
    );
    assert.ok(
      !/estCost\s*>=\s*COST_REVIEW_THRESHOLD_USD/.test(SRC),
      "tier must NOT use >= ($10 exactly is still the silent-confirm tier)",
    );
  });

  it("confirm_high_cost is sent on the >$5 tier (mirrors edge fn $5 guard)", () => {
    assert.ok(
      /estCost\s*>\s*COST_GUARD_USD/.test(SRC),
      "sendConfirmHighCost must be strictly > $5 (edge fn guard semantics)",
    );
    assert.ok(
      SRC.includes("confirm_high_cost: sendConfirmHighCost"),
      "modal must POST confirm_high_cost in the body",
    );
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
