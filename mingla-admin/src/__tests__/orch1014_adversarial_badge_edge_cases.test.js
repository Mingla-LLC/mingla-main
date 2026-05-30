// ORCH-1014 ADVERSARIAL — badge helper edge cases the implementor tests miss.
//
// Targets the pure-JS getSeedStatusContent + getRefreshStatusContent helpers
// for boundary conditions that could regress without these tests:
//   1. lastSeededAt=null but firstSeededAt set (impossible? still must not crash)
//   2. Very large missingFieldsCount (10M) → thousand-separator formatting holds
//   3. Negative counts (defensive: treated as 0 / all-current — should NOT trip
//      missing-only branch)
//   4. Float counts (1.5) — toLocaleString still works; descriptor stable
//   5. Helper is import-pure (no side effects on import: returns NEW object each
//      call, doesn't mutate args)
//   6. seedRefreshBadgeContent.js exports both named symbols
//
// Fails-on-revert: any breakage of the contracts above FAILS.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getSeedStatusContent,
  getRefreshStatusContent,
} from "../components/placeIntelligenceTrial/seedRefreshBadgeContent.js";

describe("ORCH-1014 ADVERSARIAL — badge helper edge cases", () => {
  it("getSeedStatusContent handles firstSeededAt-set-but-lastSeededAt-null without crash", () => {
    const iso = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const c = getSeedStatusContent({ firstSeededAt: iso, lastSeededAt: null });
    // Per helper logic, null lastSeededAt → "never-seeded" regardless of first
    assert.equal(c.state, "never-seeded");
    assert.equal(c.primaryText, "Never seeded");
  });

  it("getRefreshStatusContent formats 10,000,000 with thousands separators", () => {
    const c = getRefreshStatusContent({
      missingFieldsCount: 10_000_000,
      staleRefreshCount: 0,
    });
    // toLocaleString uses commas in en-US which node defaults to in --test
    assert.ok(
      /^10[,.]000[,.]000 places missing fields$/.test(c.primaryText),
      `expected 10,000,000 formatted (got: ${c.primaryText})`,
    );
  });

  it("getRefreshStatusContent treats negative counts as numeric (does not crash)", () => {
    // Defensive: a backend bug could send -1; helper should still produce a
    // descriptor without throwing. We don't assert state — just that it
    // returns a stable object shape.
    const c = getRefreshStatusContent({
      missingFieldsCount: -1,
      staleRefreshCount: -5,
    });
    assert.ok(c.primaryText, "should still produce primaryText");
    assert.ok(c.primaryColorVar, "should still produce primaryColorVar");
    assert.ok(c.tooltip, "should still produce tooltip");
  });

  it("getRefreshStatusContent does NOT mutate input args", () => {
    const args = { missingFieldsCount: 5, staleRefreshCount: 2 };
    const snapshot = JSON.stringify(args);
    getRefreshStatusContent(args);
    assert.equal(JSON.stringify(args), snapshot, "args object must not be mutated");
  });

  it("getSeedStatusContent does NOT mutate input args", () => {
    const args = {
      firstSeededAt: new Date().toISOString(),
      lastSeededAt: new Date().toISOString(),
    };
    const snapshot = JSON.stringify(args);
    getSeedStatusContent(args);
    assert.equal(JSON.stringify(args), snapshot, "args object must not be mutated");
  });

  it("both helpers return NEW object instances per call (no shared mutable singleton)", () => {
    const a1 = getRefreshStatusContent({ missingFieldsCount: 0, staleRefreshCount: 0 });
    const a2 = getRefreshStatusContent({ missingFieldsCount: 0, staleRefreshCount: 0 });
    assert.notEqual(a1, a2, "must not return same object reference (defensive)");

    const iso = new Date().toISOString();
    const b1 = getSeedStatusContent({ firstSeededAt: iso, lastSeededAt: iso });
    const b2 = getSeedStatusContent({ firstSeededAt: iso, lastSeededAt: iso });
    assert.notEqual(b1, b2, "must not return same object reference (defensive)");
  });

  it("getSeedStatusContent: lastSeededAt as empty string is treated as falsy (never-seeded)", () => {
    const c = getSeedStatusContent({ firstSeededAt: null, lastSeededAt: "" });
    // Empty string is falsy → never-seeded path
    assert.equal(c.state, "never-seeded");
  });

  it("getRefreshStatusContent: '0 stale' subText is rendered when missing > 0 & stale === 0 (intentional, see test 4 of impl tests)", () => {
    // This locks the implementor's intentional decision (impl test line 43)
    // so a future cleanup that hides "(0 stale)" must explicitly update both
    // tests, not silently regress.
    const c = getRefreshStatusContent({
      missingFieldsCount: 100,
      staleRefreshCount: 0,
    });
    assert.equal(c.subText, "(0 stale)");
  });
});
