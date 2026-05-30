// ORCH-1015 Finding A regression test — DetailsReadinessBadge content
// contract (binary pill: ✓ current / ⚠ N places need refresh).
//
// Covers SPEC §3 A.2 cases:
//   - refreshed: true                  → "✓ current" in success color
//   - refreshed: false + count         → "⚠ N places need refresh" with thousands sep
//   - tooltip mentions cutover 2026-03-19 + DETAIL_FIELD_MASK + Place Pool
//   - defensive undefined count → 0
//   - read-only, pure, var(--color- tokens
//
// Fails-on-revert: any regression of the binary contract or thousands-sep
// formatting FAILS.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detailsStatus } from "../components/placeIntelligenceTrial/readinessBadgeContent.js";

describe("ORCH-1015 — DetailsReadinessBadge content (detailsStatus)", () => {
  it("returns ✓ current in success color when refreshed: true", () => {
    const c = detailsStatus({ refreshed: true, needs_refresh_count: 0 });
    assert.equal(c.state, "current");
    assert.equal(c.label, "✓ current");
    assert.equal(c.bgVar, "var(--color-success-50)");
    assert.equal(c.fgVar, "var(--color-success-700)");
    assert.ok(
      c.tooltip.includes("48-field"),
      `tooltip must mention '48-field' (got: ${c.tooltip})`,
    );
    assert.ok(
      c.tooltip.includes("2026-03-19"),
      `tooltip must mention '2026-03-19' (got: ${c.tooltip})`,
    );
  });

  it("renders '⚠ 41 places need refresh' when refreshed: false + count=41", () => {
    const c = detailsStatus({ refreshed: false, needs_refresh_count: 41 });
    assert.equal(c.state, "needs-refresh");
    assert.equal(c.label, "⚠ 41 places need refresh");
    assert.equal(c.bgVar, "var(--color-warning-50)");
    assert.equal(c.fgVar, "var(--color-warning-700)");
    assert.ok(
      c.tooltip.startsWith("41 servable places"),
      `tooltip must start with '41 servable places' (got: ${c.tooltip})`,
    );
    assert.ok(c.tooltip.includes("2026-03-19"), "tooltip must cite cutover");
    assert.ok(
      c.tooltip.includes("DETAIL_FIELD_MASK"),
      "tooltip must cite DETAIL_FIELD_MASK",
    );
    assert.ok(c.tooltip.includes("Place Pool"), "tooltip must mention Place Pool");
  });

  it("formats large counts with thousands separator (1,706)", () => {
    const c = detailsStatus({ refreshed: false, needs_refresh_count: 1706 });
    assert.equal(c.label, "⚠ 1,706 places need refresh");
  });

  it("defaults needs_refresh_count to 0 if undefined (defensive)", () => {
    const c = detailsStatus({ refreshed: false, needs_refresh_count: undefined });
    assert.equal(c.label, "⚠ 0 places need refresh");
    assert.equal(c.state, "needs-refresh");
  });

  it("returns NEW object instance per call (defensive — no shared singleton)", () => {
    const a = detailsStatus({ refreshed: true, needs_refresh_count: 0 });
    const b = detailsStatus({ refreshed: true, needs_refresh_count: 0 });
    assert.notEqual(a, b, "must not return same object reference");
  });

  it("does NOT mutate input args", () => {
    const args = { refreshed: false, needs_refresh_count: 5 };
    const snapshot = JSON.stringify(args);
    detailsStatus(args);
    assert.equal(JSON.stringify(args), snapshot, "args must not be mutated");
  });

  it("descriptor exposes no onClick, href, or function-typed field (read-only)", () => {
    const cases = [
      detailsStatus({ refreshed: true, needs_refresh_count: 0 }),
      detailsStatus({ refreshed: false, needs_refresh_count: 5 }),
    ];
    for (const c of cases) {
      for (const key of Object.keys(c)) {
        assert.notEqual(typeof c[key], "function", `field ${key} must not be a function`);
      }
      assert.equal(c.onClick, undefined, "must not expose onClick");
      assert.equal(c.href, undefined, "must not expose href");
    }
  });

  it("all color tokens start with var(--color- (Tailwind v4)", () => {
    const cases = [
      detailsStatus({ refreshed: true, needs_refresh_count: 0 }),
      detailsStatus({ refreshed: false, needs_refresh_count: 41 }),
    ];
    for (const c of cases) {
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
