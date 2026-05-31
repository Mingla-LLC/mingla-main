// ORCH-1015 ADVERSARIAL — readiness badge helper edge cases the implementor
// tests miss. Hard-locks the contracts:
//   1. Both helpers stable when given undefined/missing/extra props
//   2. Very large needs_refresh_count (10M) → thousands sep holds
//   3. refreshed: false + needs_refresh_count: 0 (logically impossible per
//      SPEC §3 A.2 — but defense-in-depth) still produces a stable shape
//   4. Helpers don't mutate args + return NEW object per call
//   5. Both helpers exported from readinessBadgeContent.js
//   6. boundaryStatus tolerates non-boolean truthy/falsy regeocoded value
//      (e.g. a bug ships row.regeocoded as null instead of false)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  boundaryStatus,
  detailsStatus,
} from "../components/placeIntelligenceTrial/readinessBadgeContent.js";

describe("ORCH-1015 ADVERSARIAL — readiness badge helper edge cases", () => {
  it("readinessBadgeContent.js exports both named symbols", () => {
    assert.equal(typeof boundaryStatus, "function");
    assert.equal(typeof detailsStatus, "function");
  });

  it("boundaryStatus({}) defaults to ⚠ reseed (regeocoded undefined ≠ true)", () => {
    const c = boundaryStatus({});
    assert.equal(c.state, "needs-reseed");
    assert.equal(c.label, "⚠ reseed");
  });

  it("boundaryStatus treats null regeocoded as ⚠ reseed (strict equality with true)", () => {
    const c = boundaryStatus({ regeocoded: null });
    assert.equal(c.state, "needs-reseed");
  });

  it("detailsStatus formats 10,000,000 with thousands separator", () => {
    const c = detailsStatus({ refreshed: false, needs_refresh_count: 10_000_000 });
    assert.ok(
      /^⚠ 10[,.]000[,.]000 places need refresh$/.test(c.label),
      `expected 10,000,000 formatted (got: ${c.label})`,
    );
  });

  it("detailsStatus({refreshed: false, needs_refresh_count: 0}) is impossible but stable", () => {
    // SPEC §3 A.2 edge case — if refreshed === false then count > 0 logically.
    // Defense-in-depth: still produce a coherent ⚠ shape.
    const c = detailsStatus({ refreshed: false, needs_refresh_count: 0 });
    assert.equal(c.state, "needs-refresh");
    assert.equal(c.label, "⚠ 0 places need refresh");
    assert.ok(c.tooltip, "tooltip must still render");
  });

  it("detailsStatus({}) defaults to ⚠ 0 places need refresh (refreshed undefined ≠ true)", () => {
    const c = detailsStatus({});
    assert.equal(c.state, "needs-refresh");
    assert.equal(c.label, "⚠ 0 places need refresh");
  });

  it("detailsStatus tolerates non-numeric needs_refresh_count (NaN → 0)", () => {
    const c = detailsStatus({ refreshed: false, needs_refresh_count: NaN });
    assert.equal(c.label, "⚠ 0 places need refresh");
  });

  it("both helpers return NEW object per call (no shared singleton)", () => {
    const b1 = boundaryStatus({ regeocoded: true });
    const b2 = boundaryStatus({ regeocoded: true });
    assert.notEqual(b1, b2, "boundaryStatus must not return same object reference");

    const d1 = detailsStatus({ refreshed: true, needs_refresh_count: 0 });
    const d2 = detailsStatus({ refreshed: true, needs_refresh_count: 0 });
    assert.notEqual(d1, d2, "detailsStatus must not return same object reference");
  });

  it("both helpers do NOT mutate args (defensive snapshot equality)", () => {
    const boundaryArgs = { regeocoded: true };
    const bSnap = JSON.stringify(boundaryArgs);
    boundaryStatus(boundaryArgs);
    assert.equal(JSON.stringify(boundaryArgs), bSnap, "boundary args must be unchanged");

    const detailsArgs = { refreshed: false, needs_refresh_count: 42 };
    const dSnap = JSON.stringify(detailsArgs);
    detailsStatus(detailsArgs);
    assert.equal(JSON.stringify(detailsArgs), dSnap, "details args must be unchanged");
  });

  it("no helper exposes onClick, href, or function-typed field on its descriptor", () => {
    const cases = [
      boundaryStatus({ regeocoded: true }),
      boundaryStatus({ regeocoded: false }),
      detailsStatus({ refreshed: true, needs_refresh_count: 0 }),
      detailsStatus({ refreshed: false, needs_refresh_count: 5 }),
    ];
    for (const c of cases) {
      for (const k of Object.keys(c)) {
        assert.notEqual(typeof c[k], "function", `field ${k} must not be a function`);
      }
      assert.equal(c.onClick, undefined);
      assert.equal(c.href, undefined);
    }
  });
});
