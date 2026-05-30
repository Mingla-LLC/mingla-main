// ORCH-1014 Finding B regression test — RefreshStatusBadge content contract.
//
// Targets the pure-JS helper getRefreshStatusContent. Covers SPEC §3 B.3
// cases:
//   - 0 missing + 0 stale → "✓ all current" in success color, no sub-line
//   - N missing only      → "N places missing fields" in warning color
//                            + sub-line "(0 stale)" in tertiary
//   - N missing + M stale → "N places missing fields" + sub-line "(M stale)"
//   - 0 missing but M stale (theoretical) — still treated as "all current"
//     because the operator's mental model is "what Gemini needs to chew on"
//     not "when did Google last say hi" (SPEC §7 decision 4).
//
// Read-only: descriptor must not expose onClick/href/button fields.
//
// Numeric formatting must use toLocaleString thousands separators so a city
// with 1,706 missing reads naturally.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getRefreshStatusContent } from "../components/placeIntelligenceTrial/seedRefreshBadgeContent.js";

describe("ORCH-1014 — RefreshStatusBadge content (getRefreshStatusContent)", () => {
  it("renders '✓ all current' in success color when missingFieldsCount===0 and staleRefreshCount===0", () => {
    const c = getRefreshStatusContent({
      missingFieldsCount: 0,
      staleRefreshCount: 0,
    });
    assert.equal(c.state, "all-current");
    assert.equal(c.primaryText, "✓ all current");
    assert.equal(c.primaryColorVar, "var(--color-success-700)");
    assert.equal(c.subText, null);
  });

  it("renders 'N places missing fields' + '(0 stale)' when missing only", () => {
    const c = getRefreshStatusContent({
      missingFieldsCount: 1706,
      staleRefreshCount: 0,
    });
    assert.equal(c.state, "missing-only");
    // Real Washington live-probe number — must use thousands separator
    assert.equal(c.primaryText, "1,706 places missing fields");
    assert.equal(c.primaryColorVar, "var(--color-warning-700)");
    assert.equal(c.subText, "(0 stale)");
  });

  it("renders 'N places missing fields' + '(M stale)' when both > 0", () => {
    const c = getRefreshStatusContent({
      missingFieldsCount: 1097,
      staleRefreshCount: 42,
    });
    assert.equal(c.state, "missing-and-stale");
    // Real Raleigh live-probe number
    assert.equal(c.primaryText, "1,097 places missing fields");
    assert.equal(c.primaryColorVar, "var(--color-warning-700)");
    assert.equal(c.subText, "(42 stale)");
  });

  it("renders 'M stale only' as 'all-current' (operator mental model: missing > stale)", () => {
    // Edge case: 0 missing but some stale. Per SPEC §7 decision 4, the
    // primary signal is missing-fields ("what does Gemini need to chew on?")
    // not stale ("when did Google last say hi?"). So we still render
    // "all current" — staleRefreshCount alone doesn't trigger the warning.
    const c = getRefreshStatusContent({
      missingFieldsCount: 0,
      staleRefreshCount: 50,
    });
    assert.equal(c.state, "all-current");
    assert.equal(c.primaryText, "✓ all current");
  });

  it("tooltip explains the missing-fields union + stale threshold + 'refresh in Place Pool' hint", () => {
    const c = getRefreshStatusContent({
      missingFieldsCount: 5,
      staleRefreshCount: 0,
    });
    assert.ok(c.tooltip.includes("generative_summary"), "tooltip must list generative_summary");
    assert.ok(c.tooltip.includes("editorial_summary"), "tooltip must list editorial_summary");
    assert.ok(c.tooltip.includes("reviews"), "tooltip must list reviews");
    assert.ok(c.tooltip.includes("90 days"), "tooltip must cite the 90-day stale cutoff");
    assert.ok(
      c.tooltip.includes("Refresh in Place Pool"),
      "tooltip must hint Refresh in Place Pool",
    );
  });

  it("never includes CTA fields (no onClick, no href, no button shape) in descriptor", () => {
    const c = getRefreshStatusContent({
      missingFieldsCount: 10,
      staleRefreshCount: 2,
    });
    for (const key of Object.keys(c)) {
      assert.notEqual(typeof c[key], "function", `field ${key} must not be a function`);
    }
    assert.equal(c.onClick, undefined, "must not expose onClick");
    assert.equal(c.href, undefined, "must not expose href");
  });

  it("primary color tokens are Tailwind v4 var(--color-…) so dark+light render coherently", () => {
    const cases = [
      getRefreshStatusContent({ missingFieldsCount: 0, staleRefreshCount: 0 }),
      getRefreshStatusContent({ missingFieldsCount: 5, staleRefreshCount: 0 }),
      getRefreshStatusContent({ missingFieldsCount: 5, staleRefreshCount: 2 }),
    ];
    for (const c of cases) {
      assert.ok(
        c.primaryColorVar.startsWith("var(--color-"),
        `primaryColorVar must be a CSS var (got: ${c.primaryColorVar})`,
      );
    }
  });

  it("defaults missing + stale to 0 if undefined (resilience)", () => {
    const c = getRefreshStatusContent({});
    assert.equal(c.state, "all-current");
    assert.equal(c.primaryText, "✓ all current");
  });
});
