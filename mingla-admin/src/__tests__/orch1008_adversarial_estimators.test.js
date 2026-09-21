// ORCH-1008 adversarial tests — boundary + adversarial input on the
// cost/time estimators that drive the Run-Remainder modal cost preview.
//
// Attack angles:
//   - Floating-point precision at large N (1,234,567 places)
//   - Negative / Infinity / NaN / string inputs (modal MUST NOT bill negative)
//   - perPlace override with adversarial values (0, negative, Infinity)
//   - rounding to 4dp boundary cases
//   - estMinutes ceiling at fractional minutes
//
// Fails-on-revert verified at: 72f164536 (pre-implementation SPEC commit;
// estimator file did not exist).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  estimateRemainderCostUsd,
  estimateRemainderMinutes,
} from "../services/intelligenceCoverageEstimators.js";

describe("ORCH-1008 adversarial — estimateRemainderCostUsd boundaries", () => {
  // issue #3526 P0-1 — every case now passes the rate explicitly. The implicit
  // $0.0040 these used to lean on was the defect (see the P0 in the #3526 test
  // verdict); a missing rate is its own case at the bottom of this block.
  it("does not return a negative cost for any negative input", () => {
    assert.equal(estimateRemainderCostUsd(-1, 0.0089), 0);
    assert.equal(estimateRemainderCostUsd(-1_000_000, 0.0089), 0);
    assert.equal(estimateRemainderCostUsd(Number.MIN_SAFE_INTEGER, 0.0089), 0);
  });

  it("rejects Infinity / -Infinity / NaN", () => {
    assert.equal(estimateRemainderCostUsd(Infinity, 0.0089), 0);
    assert.equal(estimateRemainderCostUsd(-Infinity, 0.0089), 0);
    assert.equal(estimateRemainderCostUsd(NaN, 0.0089), 0);
  });

  it("rejects non-numeric inputs (string, object, null) without throwing", () => {
    assert.equal(estimateRemainderCostUsd("100", 0.0089), 0);
    assert.equal(estimateRemainderCostUsd({}, 0.0089), 0);
    assert.equal(estimateRemainderCostUsd(null, 0.0089), 0);
  });

  it("rounds to 4 decimal places (no floating-point smear)", () => {
    // 1234 * 0.0089 = 10.9826
    assert.equal(estimateRemainderCostUsd(1234, 0.0089), 10.9826);
    // 1_234_567 places — large but realistic upper bound on city count.
    const big = estimateRemainderCostUsd(1_234_567, 0.0089);
    assert.equal(big, 10987.6463);
    assert.ok(Number.isFinite(big));
  });

  // issue #3526 P0-1 — the old version of this case DOCUMENTED that a negative
  // rate "currently passes through" and showed the operator a negative cost.
  // A cost model that can produce a negative price is not a cost model; the
  // function refuses the rate outright now.
  it("refuses a missing, zero or negative rate rather than inventing one", () => {
    assert.equal(estimateRemainderCostUsd(100), null);
    assert.equal(estimateRemainderCostUsd(100, 0), null);
    assert.equal(estimateRemainderCostUsd(100, -0.001), null);
    assert.equal(estimateRemainderCostUsd(100, "0.0089"), null);
    assert.equal(estimateRemainderCostUsd(100, null), null);
  });

  it("zero remainingCount returns 0", () => {
    assert.equal(estimateRemainderCostUsd(0, 0.0089), 0);
    assert.equal(estimateRemainderCostUsd(0, 0.999), 0);
  });
});

describe("ORCH-1008 adversarial — estimateRemainderMinutes boundaries", () => {
  it("returns 0 for 0/negative/NaN/Infinity (never negative time)", () => {
    assert.equal(estimateRemainderMinutes(0), 0);
    assert.equal(estimateRemainderMinutes(-5), 0);
    assert.equal(estimateRemainderMinutes(NaN), 0);
    assert.equal(estimateRemainderMinutes(Infinity), 0);
  });

  it("rounds up sub-minute estimates (1 place = 30s = 1 min ceiling)", () => {
    assert.equal(estimateRemainderMinutes(1), 1);
    assert.equal(estimateRemainderMinutes(2), 1); // 60s = 1 min
    assert.equal(estimateRemainderMinutes(3), 2); // 90s → 1.5 → 2
  });

  it("is monotonically non-decreasing", () => {
    let prev = -1;
    for (let n = 0; n < 200; n += 7) {
      const v = estimateRemainderMinutes(n);
      assert.ok(v >= prev, `monotonicity broken at n=${n}: ${prev} → ${v}`);
      prev = v;
    }
  });

  it("matches the documented Math.ceil(N * 30 / 60) contract at large N", () => {
    for (const n of [1234, 5678, 11_344, 100_000]) {
      assert.equal(estimateRemainderMinutes(n), Math.ceil((n * 30) / 60));
    }
  });
});
