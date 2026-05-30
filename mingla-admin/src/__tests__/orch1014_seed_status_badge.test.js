// ORCH-1014 Finding B regression test — SeedStatusBadge content contract.
//
// Targets the pure-JS helper getSeedStatusContent (extracted so node --test
// can exercise the visual contract without JSDOM or a JSX loader; hard guard:
// no new deps). The .jsx wrapper is a thin renderer over this helper.
//
// Covers SPEC §3 B.3 cases:
//   - lastSeededAt null              → "Never seeded" in warning color
//   - lastSeededAt set, first==last  → single line "Seeded Xd ago" (primary)
//   - last !== first                 → 2 lines: primary "Seeded Xd ago" + sub "First: …"
//   - No CTA / button / link allowed (read-only) — covered by absence of
//     'onClick', 'href', 'button' fields in the descriptor.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSeedStatusContent } from "../components/placeIntelligenceTrial/seedRefreshBadgeContent.js";

describe("ORCH-1014 — SeedStatusBadge content (getSeedStatusContent)", () => {
  it("returns 'Never seeded' in warning color when lastSeededAt is null", () => {
    const c = getSeedStatusContent({ firstSeededAt: null, lastSeededAt: null });
    assert.equal(c.state, "never-seeded");
    assert.equal(c.primaryText, "Never seeded");
    assert.equal(c.primaryColorVar, "var(--color-warning-700)");
    assert.equal(c.subText, null);
    assert.equal(c.primaryTitle, null);
  });

  it("renders single-line 'Seeded Xd ago' when first==last (single-pass seeding)", () => {
    const iso = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const c = getSeedStatusContent({ firstSeededAt: iso, lastSeededAt: iso });
    assert.equal(c.state, "single-pass");
    assert.equal(c.primaryText, "Seeded 5d ago");
    assert.equal(c.primaryColorVar, "var(--color-text-primary)");
    assert.equal(c.subText, null, "must NOT render a First: sub-line when first==last");
    assert.equal(c.primaryTitle, iso, "tooltip must be the ISO ts");
  });

  it("renders BOTH lines (Seeded + First:) when last > first (ranged seeding)", () => {
    const isoFirst = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const isoLast = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const c = getSeedStatusContent({
      firstSeededAt: isoFirst,
      lastSeededAt: isoLast,
    });
    assert.equal(c.state, "ranged");
    assert.equal(c.primaryText, "Seeded 10d ago");
    assert.ok(c.subText, "sub-line must render when first !== last");
    assert.ok(
      c.subText.startsWith("First: "),
      `sub-line must start with 'First: ' (got: ${c.subText})`,
    );
    // 60 days ago is "2mo ago" per timeAgo's 30-day month bucket
    assert.ok(
      c.subText.includes("2mo ago") || c.subText.includes("60d ago"),
      `expected sub-line to mention 2mo or 60d (got: ${c.subText})`,
    );
    assert.equal(c.primaryTitle, isoLast);
    assert.equal(c.subTitle, isoFirst);
  });

  it("never includes CTA fields (no onClick, no href, no button shape) in descriptor", () => {
    const iso = new Date().toISOString();
    const c = getSeedStatusContent({ firstSeededAt: iso, lastSeededAt: iso });
    // The descriptor shape is data-only; assert no callable fields snuck in.
    for (const key of Object.keys(c)) {
      assert.notEqual(typeof c[key], "function", `field ${key} must not be a function`);
    }
    assert.equal(c.onClick, undefined, "must not expose onClick");
    assert.equal(c.href, undefined, "must not expose href");
  });

  it("primary color tokens are Tailwind v4 var(--color-…) so dark+light render coherently", () => {
    const isoOld = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const isoNow = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    const cases = [
      getSeedStatusContent({ firstSeededAt: null, lastSeededAt: null }),
      getSeedStatusContent({ firstSeededAt: isoNow, lastSeededAt: isoNow }),
      getSeedStatusContent({ firstSeededAt: isoOld, lastSeededAt: isoNow }),
    ];
    for (const c of cases) {
      assert.ok(
        c.primaryColorVar.startsWith("var(--color-"),
        `primaryColorVar must be a CSS var (got: ${c.primaryColorVar})`,
      );
    }
  });
});
