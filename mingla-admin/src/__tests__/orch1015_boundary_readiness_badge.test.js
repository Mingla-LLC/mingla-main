// ORCH-1015 Finding A regression test — BoundaryReadinessBadge content
// contract (binary pill: ✓ current / ⚠ reseed).
//
// Targets the pure-JS helper boundaryStatus() from readinessBadgeContent.js
// (extracted so node --test can exercise the visual contract without JSDOM
// or a JSX loader; hard guard: no new deps). The .jsx wrapper is a thin
// renderer over this helper.
//
// Covers SPEC §3 A.1 cases:
//   - regeocoded: true  → "✓ current" in success color
//   - regeocoded: false → "⚠ reseed" in warning color
//   - tooltip mentions "bbox model" when ✓, "deprecated radius" + "Place Pool" when ⚠
//   - read-only (no onClick/href/function fields)
//   - pure (no mutation, new object per call)
//   - all color tokens are var(--color-...) for dark+light coherence
//
// Fails-on-revert: if the binary contract regresses to count-based or the
// pill text/state/tokens drift, this test FAILS.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { boundaryStatus } from "../components/placeIntelligenceTrial/readinessBadgeContent.js";

describe("ORCH-1015 — BoundaryReadinessBadge content (boundaryStatus)", () => {
  it("returns ✓ current in success color when regeocoded: true", () => {
    const c = boundaryStatus({ regeocoded: true });
    assert.equal(c.state, "current");
    assert.equal(c.label, "✓ current");
    assert.equal(c.bgVar, "var(--color-success-50)");
    assert.equal(c.fgVar, "var(--color-success-700)");
  });

  it("returns ⚠ reseed in warning color when regeocoded: false", () => {
    const c = boundaryStatus({ regeocoded: false });
    assert.equal(c.state, "needs-reseed");
    assert.equal(c.label, "⚠ reseed");
    assert.equal(c.bgVar, "var(--color-warning-50)");
    assert.equal(c.fgVar, "var(--color-warning-700)");
  });

  it("tooltip mentions 'bbox model' when ✓ current", () => {
    const c = boundaryStatus({ regeocoded: true });
    assert.ok(
      c.tooltip.includes("bbox model"),
      `tooltip must mention 'bbox model' (got: ${c.tooltip})`,
    );
  });

  it("tooltip mentions 'deprecated radius' AND 'Place Pool' when ⚠ reseed", () => {
    const c = boundaryStatus({ regeocoded: false });
    assert.ok(
      c.tooltip.includes("deprecated radius"),
      `tooltip must mention 'deprecated radius' (got: ${c.tooltip})`,
    );
    assert.ok(
      c.tooltip.includes("Place Pool"),
      `tooltip must mention 'Place Pool' (got: ${c.tooltip})`,
    );
  });

  it("returns NEW object instance per call (defensive — no shared singleton)", () => {
    const a = boundaryStatus({ regeocoded: true });
    const b = boundaryStatus({ regeocoded: true });
    assert.notEqual(a, b, "must not return same object reference");
  });

  it("does NOT mutate input args", () => {
    const args = { regeocoded: true };
    const snapshot = JSON.stringify(args);
    boundaryStatus(args);
    assert.equal(JSON.stringify(args), snapshot, "args must not be mutated");
  });

  it("descriptor exposes no onClick, href, or function-typed field (read-only)", () => {
    for (const reg of [true, false]) {
      const c = boundaryStatus({ regeocoded: reg });
      for (const key of Object.keys(c)) {
        assert.notEqual(
          typeof c[key],
          "function",
          `field ${key} must not be a function (read-only)`,
        );
      }
      assert.equal(c.onClick, undefined, "must not expose onClick");
      assert.equal(c.href, undefined, "must not expose href");
    }
  });

  it("all color tokens start with var(--color- (Tailwind v4, dark+light coherent)", () => {
    for (const reg of [true, false]) {
      const c = boundaryStatus({ regeocoded: reg });
      assert.ok(
        c.bgVar.startsWith("var(--color-"),
        `bgVar must be a var(--color- token (got: ${c.bgVar})`,
      );
      assert.ok(
        c.fgVar.startsWith("var(--color-"),
        `fgVar must be a var(--color- token (got: ${c.fgVar})`,
      );
    }
  });
});
