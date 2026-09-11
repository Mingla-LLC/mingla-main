/**
 * Issue #3188 [brand-page social icons wrap onto a second line] — IMPLEMENTOR
 * happy-path suite. SPEC §7.1, covering T-1..T-9 and T-12.
 *
 * WHY THIS FILE LIVES UNDER `mingla-business/src` AND NOT BESIDE THE CODE IT
 * TESTS. `mingla-business jest (full suite)` is the ONLY always-run required
 * check (no path filter), and its `roots` stop at `mingla-business` — a suite
 * written next to `packages/brand-rendering/socialRowSizing.ts` would run in NO
 * CI lane at all unless it were also named in a per-issue jest config. That is
 * the #1038/#1047 dark-suite failure shape. So the arithmetic contract — the
 * part that must never silently regress for ANY brand — is pinned here, in the
 * lane that always runs, and the render proof lives in the path-gated lane
 * (`packages/brand-rendering/__tests__/issue_3188_socials_one_line.test.tsx`).
 *
 * The module is DEEP-imported: `@mingla/brand-rendering/socialRowSizing`
 * resolves through this config's `"^@mingla/brand-rendering/(.+)$"` mapper to
 * the REAL file. The barrel (`@mingla/brand-rendering`) is deliberately NOT
 * used — it carries a manual mock in this runner, and a mocked module proves
 * nothing about the formula.
 *
 * FAILS-ON-REVERT: deleting `socialRowSizing.ts` makes every test here
 * unresolvable; replacing the computed diameter with a constant 44 reds T-1,
 * T-3 and T-4 (8*44 + 7*10 = 422 > 318).
 *
 * Run: cd mingla-business && npx jest --ci --runInBand \
 *        src/components/brand/__tests__/issue_3188_social_row_sizing.test.ts
 */

import fs from "fs";
import path from "path";

import {
  SOCIAL_CHIP_D_MAX,
  SOCIAL_CHIP_D_MIN,
  SOCIAL_GLYPH_MIN,
  SOCIAL_GLYPH_RATIO,
  SOCIAL_ROW_GAP_MAX,
  SOCIAL_ROW_SEED_WIDTH,
  solveSocialRow,
} from "@mingla/brand-rendering/socialRowSizing";

/** Every real container width across every surface that renders this row. */
const REAL_WIDTHS = [
  278, // 320pt device (the narrowest real container)
  318, // desktop sticky panel — FIXED, the container in the bug report
  348, // iPhone 12/13/14 native
  360, // iPhone 16 Pro native
  388, // Plus / Max native
  858, // web phone layout at a 900pt viewport
] as const;

/** 1..8 — 8 is the true maximum (`SocialKind` has exactly eight members). */
const COUNTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

const brandPageSource = fs.readFileSync(
  path.join(__dirname, "../../../../../packages/brand-rendering/PublicBrandPage.tsx"),
  "utf8",
);

const sizingSource = fs.readFileSync(
  path.join(__dirname, "../../../../../packages/brand-rendering/socialRowSizing.ts"),
  "utf8",
);

/**
 * Strip comments so prose naming an API never satisfies a source assertion.
 *
 * LINE COMMENTS FIRST, BLOCK COMMENTS SECOND — and that order is not a style
 * choice. `PublicBrandPage.tsx` contains the LINE comment
 * `// paths ("@mingla/offering-rendering/*") + both apps' metro …`. Removing
 * block comments first reads that `/*` as a block opener, finds no `*\/` until
 * the JSX comment 20KB later, and silently deletes a third of the file —
 * including `const socialsBlock`. Measured: 69,926 chars in, 41,829 out, and
 * every structural assertion below passed vacuously on the swallowed text.
 * The `[^:]` guard keeps `https://` out of the line-comment match.
 */
function stripComments(src: string): string {
  const noLine = src.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  return noLine.replace(/\/\*[\s\S]*?\*\//g, " ");
}

describe("#3188 solveSocialRow — the reported case and its neighbours", () => {
  test("T-1 the REPORTED case: 8 chips in the fixed 318pt desktop panel", () => {
    expect(solveSocialRow(318, 8)).toEqual({
      diameter: 31,
      gap: 10,
      glyph: 15,
      strokeWidth: 1.8,
      hitSlop: { top: 7, bottom: 7, left: 5, right: 5 },
    });
    // …and it FITS the container exactly, which is the whole point.
    expect(8 * 31 + 7 * 10).toBe(318);
  });

  test("T-2 the fits-today case: 6 chips at 318pt are untouched", () => {
    expect(solveSocialRow(318, 6)).toEqual({
      diameter: 44,
      gap: 10,
      glyph: 21,
      strokeWidth: 2.2,
      hitSlop: { top: 0, bottom: 0, left: 0, right: 0 },
    });
  });

  test("T-3 gap reclaim: 8 chips at 278pt spend the gap to stay legible", () => {
    // Without the reclaim the diameter would be floor(208/8) = 26, under the
    // 28pt design floor. Dropping the gap to 4 buys it back to 31.
    expect(solveSocialRow(278, 8)).toEqual({
      diameter: 31,
      gap: 4,
      glyph: 15,
      strokeWidth: 1.8,
      hitSlop: { top: 7, bottom: 7, left: 2, right: 2 },
    });
    expect(8 * 31 + 7 * 4).toBeLessThanOrEqual(278);
  });

  test("T-3b the 7-chip case at 318pt also collapses to one line", () => {
    expect(solveSocialRow(318, 7)).toEqual({
      diameter: 36,
      gap: 10,
      glyph: 17,
      strokeWidth: 2,
      hitSlop: { top: 4, bottom: 4, left: 4, right: 4 },
    });
  });
});

describe("#3188 solveSocialRow — invariants across every real width", () => {
  test("T-4 ONE LINE: N*diameter + (N-1)*gap never exceeds the container", () => {
    let cells = 0;
    for (const width of REAL_WIDTHS) {
      for (const count of COUNTS) {
        const m = solveSocialRow(width, count);
        const total = count * m.diameter + (count - 1) * m.gap;
        expect({ width, count, total }).toEqual({
          width,
          count,
          total: expect.any(Number),
        });
        expect(total).toBeLessThanOrEqual(width);
        cells += 1;
      }
    }
    // VACUITY GUARD — 6 widths x 8 counts. A loop that iterated zero times
    // would otherwise report success (the zsh/empty-matrix silent-pass class).
    expect(cells).toBe(48);
  });

  test("T-5 NO REGRESSION: 1..5 chips are byte-identical to today everywhere", () => {
    let cells = 0;
    for (const width of REAL_WIDTHS) {
      for (const count of [1, 2, 3, 4, 5]) {
        expect({ width, count, ...solveSocialRow(width, count) }).toEqual({
          width,
          count,
          diameter: 44,
          gap: 10,
          glyph: 21,
          strokeWidth: 2.2,
          hitSlop: { top: 0, bottom: 0, left: 0, right: 0 },
        });
        cells += 1;
      }
    }
    expect(cells).toBe(30);
  });

  test("T-6 WEB TAP TARGET: diameter never drops below the WCAG 2.2 AA 24px floor", () => {
    let cells = 0;
    for (const width of REAL_WIDTHS) {
      for (const count of COUNTS) {
        expect(solveSocialRow(width, count).diameter).toBeGreaterThanOrEqual(
          SOCIAL_CHIP_D_MIN,
        );
        cells += 1;
      }
    }
    expect(cells).toBe(48);
    expect(SOCIAL_CHIP_D_MIN).toBe(24);
  });

  test("SC-6 the chip is never LARGER than today's 44pt", () => {
    for (const width of REAL_WIDTHS) {
      for (const count of COUNTS) {
        expect(solveSocialRow(width, count).diameter).toBeLessThanOrEqual(
          SOCIAL_CHIP_D_MAX,
        );
      }
    }
  });

  test("SC-7 the glyph tracks the circle at the 21/44 ratio, floored at 12", () => {
    for (const width of REAL_WIDTHS) {
      for (const count of COUNTS) {
        const m = solveSocialRow(width, count);
        expect(m.glyph).toBe(
          Math.max(SOCIAL_GLYPH_MIN, Math.round(m.diameter * SOCIAL_GLYPH_RATIO)),
        );
        // The glyph must sit INSIDE the circle, never clip out of it.
        expect(m.glyph).toBeLessThan(m.diameter);
      }
    }
  });

  test("SC-8 adjacent hit areas NEVER overlap", () => {
    for (const width of REAL_WIDTHS) {
      for (const count of COUNTS) {
        const m = solveSocialRow(width, count);
        expect(m.hitSlop.left).toBe(m.hitSlop.right);
        expect(m.hitSlop.left).toBeLessThanOrEqual(Math.floor(m.gap / 2));
        // Centre-to-centre spacing is diameter + gap; the slop-expanded box is
        // diameter + left + right. Tangent is allowed, overlap is not.
        expect(m.diameter + m.hitSlop.left + m.hitSlop.right).toBeLessThanOrEqual(
          m.diameter + m.gap,
        );
        // Vertical slop has no neighbour, so it takes the full restoration.
        expect(m.diameter + m.hitSlop.top + m.hitSlop.bottom).toBeGreaterThanOrEqual(
          SOCIAL_CHIP_D_MAX,
        );
      }
    }
  });
});

describe("#3188 solveSocialRow — the measurement is absent or hostile", () => {
  test("T-7 the unmeasured first frame seeds at the NARROWEST real container", () => {
    expect(solveSocialRow(null, 8)).toEqual(solveSocialRow(278, 8));
    expect(SOCIAL_ROW_SEED_WIDTH).toBe(278);
    // …and the seed is conservative, never optimistic: seeding at D_MAX would
    // squash the chips to ellipses for one frame.
    expect(solveSocialRow(null, 8).diameter).toBeLessThan(SOCIAL_CHIP_D_MAX);
    // At the counts every production brand actually has, the seed is already
    // the full 44 — so the common case has NO transient whatsoever.
    expect(solveSocialRow(null, 1).diameter).toBe(SOCIAL_CHIP_D_MAX);
    expect(solveSocialRow(null, 5).diameter).toBe(SOCIAL_CHIP_D_MAX);
  });

  test("T-8 hostile inputs never produce NaN, Infinity, or a negative size", () => {
    const hostile: Array<[number | null, number]> = [
      [0, 8],
      [-5, 8],
      [Number.NaN, 8],
      [Number.POSITIVE_INFINITY, 8],
      [318, 0],
      [318, -3],
      [318, Number.NaN],
      [null, 0],
      [317.5, 8], // a real browser reports subpixel widths
    ];
    for (const [width, count] of hostile) {
      const m = solveSocialRow(width, count);
      for (const value of [
        m.diameter,
        m.gap,
        m.glyph,
        m.strokeWidth,
        m.hitSlop.top,
        m.hitSlop.bottom,
        m.hitSlop.left,
        m.hitSlop.right,
      ]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
      expect(m.diameter).toBeGreaterThanOrEqual(SOCIAL_CHIP_D_MIN);
      expect(m.diameter).toBeLessThanOrEqual(SOCIAL_CHIP_D_MAX);
      expect(m.gap).toBeLessThanOrEqual(SOCIAL_ROW_GAP_MAX);
    }
    // An unusable width falls back to the seed, not to zero.
    expect(solveSocialRow(0, 8)).toEqual(solveSocialRow(null, 8));
    expect(solveSocialRow(-5, 8)).toEqual(solveSocialRow(null, 8));
    expect(solveSocialRow(Number.NaN, 8)).toEqual(solveSocialRow(null, 8));
    // A zero/negative count is treated as one chip, never as a division by zero.
    expect(solveSocialRow(318, 0)).toEqual(solveSocialRow(318, 1));
    // A subpixel width FLOORS rather than overflowing.
    const sub = solveSocialRow(317.5, 8);
    expect(8 * sub.diameter + 7 * sub.gap).toBeLessThanOrEqual(317.5);
  });

  test("T-9 terminal branch: below ~220pt the hard a11y floor wins over the fit", () => {
    const m = solveSocialRow(200, 8);
    expect(m.diameter).toBe(SOCIAL_CHIP_D_MIN);
    // The documented consequence: the sum EXCEEDS the container, and
    // `flexShrink: 1` on the chip is the backstop. One line always wins over a
    // wrap. Unreachable today (narrowest real container is 278).
    expect(8 * m.diameter + 7 * m.gap).toBeGreaterThan(200);
    // 220 is the exact width at which N=8 still fits at the hard floor.
    const at220 = solveSocialRow(220, 8);
    expect(8 * at220.diameter + 7 * at220.gap).toBeLessThanOrEqual(220);
  });
});

describe("#3188 structural pins the renderer must keep (T-12 / SC-9..SC-11)", () => {
  const src = stripComments(brandPageSource);

  test("VACUITY GUARD — comment stripping did not eat the source", () => {
    // See stripComments' note: a wrong strip order silently removed 40% of this
    // file and every assertion below then passed against the hole.
    expect(src.length).toBeGreaterThan(brandPageSource.length * 0.6);
    for (const landmark of [
      "const socialsBlock",
      "const SocialLinksRow",
      "const SocialIcon",
      "const stickyPanel",
      "styles.phoneIdentityWrap",
      "socialsRow: {",
      "socialBtn: {",
      "nextTeaser: {",
    ]) {
      expect(src).toContain(landmark);
    }
    // …and it DID remove comments: the file header is a line comment.
    expect(src).not.toContain("ORCH-1155 [public-brand-page]");
  });

  test("T-12 SocialLinksRow and socialsBlock survive, in their pinned order", () => {
    // Two live suites use these identifiers as structural landmarks
    // (issue_2539 slices on `const SocialLinksRow`; issue_679 pins the
    // `{socialsBlock}` ordering). Renaming either is a silent break.
    expect(src).toContain("const SocialLinksRow");
    expect(src).toContain("const socialsBlock");
    const phoneWrap = src.indexOf("styles.phoneIdentityWrap");
    const phoneSocials = src.indexOf("{socialsBlock}", phoneWrap);
    expect(phoneWrap).toBeGreaterThan(-1);
    expect(phoneSocials).toBeGreaterThan(phoneWrap);
    const panelStart = src.indexOf("const stickyPanel");
    const deskSocials = src.indexOf("{socialsBlock}", panelStart);
    expect(panelStart).toBeGreaterThan(-1);
    expect(deskSocials).toBeGreaterThan(panelStart);
    // phone wrap comes first in the file, desktop panel second.
    expect(phoneSocials).toBeLessThan(deskSocials);
  });

  test("SC-9 the row cannot wrap and the chip can shrink", () => {
    // `flexWrap: "nowrap"` is THE fix; `flexShrink: 1` + `minWidth: 0` is the
    // structural backstop that holds even if the computation were wrong or the
    // onLayout measurement never arrived.
    const socialsRow = src.slice(
      src.indexOf("socialsRow: {"),
      src.indexOf("socialBtn: {"),
    );
    expect(socialsRow).toContain('flexWrap: "nowrap"');
    expect(socialsRow).not.toContain('flexWrap: "wrap"');
    // The gap moved inline (it comes from metrics now), so the stylesheet must
    // not re-pin a static one.
    expect(socialsRow).not.toMatch(/(^|[\s,{])gap\s*:/);
    // NOTE the end boundary is the NEXT style key, not the section comment —
    // `src` is comment-stripped, so a comment boundary would return -1 and
    // slice to the end of the file (a silent over-wide match).
    const socialBtn = src.slice(
      src.indexOf("socialBtn: {"),
      src.indexOf("nextTeaser: {"),
    );
    expect(socialBtn.length).toBeGreaterThan(0);
    expect(socialBtn.length).toBeLessThan(400);
    expect(socialBtn).toContain("flexShrink: 1");
    expect(socialBtn).toContain("minWidth: 0");
    // width/height moved inline too — a static 44 here would defeat everything.
    expect(socialBtn).not.toMatch(/(^|[\s,{])width\s*:/);
    expect(socialBtn).not.toMatch(/(^|[\s,{])height\s*:/);
  });

  test("SC-10/SC-11 sizing comes from the row's OWN onLayout, never the viewport", () => {
    const rowSource = src.slice(
      src.indexOf("const SocialLinksRow"),
      src.indexOf("const SocialIcon"),
    );
    expect(rowSource).toContain("solveSocialRow");
    expect(rowSource).toContain("onLayout");
    // F-2: the desktop sticky panel is a FIXED 318pt inside a >=1024pt
    // viewport, so a viewport-derived size reads 1440 there and would leave the
    // reported bug exactly where it was reported.
    expect(rowSource).not.toContain("useWindowDimensions");
    expect(rowSource).not.toContain("useResponsiveLayout");
    expect(rowSource).not.toContain("Dimensions");
  });

  test("the sizing module stays pure — no React, no react-native", () => {
    // This is what lets the formula be pinned in the always-run required lane.
    expect(stripComments(sizingSource)).not.toMatch(/^\s*import\b/m);
    expect(stripComments(sizingSource)).not.toContain("react");
  });

  test("the code states that hitSlop is inert on web, and claims no 44pt there", () => {
    // F-5 measured it: RNW emits NO geometry for hitSlop, so the web target is
    // the visible circle. `OfferingChrome.tsx` already carries exactly that
    // false 44pt claim (D-2); a second one must not be added here.
    // NOTE this slice starts at the SocialLinksRow HEADER comment, not at the
    // declaration — the declaration-anchored slice excludes exactly the prose
    // being asserted, which is how this test first passed vacuously in reverse.
    const headerStart = brandPageSource.indexOf(
      "// Issue #3188 [brand-page social icons",
    );
    expect(headerStart).toBeGreaterThan(-1);
    const rowSource = brandPageSource.slice(
      headerStart,
      brandPageSource.indexOf("const SocialIcon"),
    );
    expect(rowSource).toContain("hitSlop is INERT on react-native-web");
    // …and the hitSlop actually applied is the COMPUTED one, never a hardcoded
    // literal that would re-assert a fixed target the web cannot honour.
    expect(rowSource).toContain("hitSlop={metrics.hitSlop}");
    expect(stripComments(rowSource)).not.toMatch(/hitSlop=\{\{/);
  });
});
