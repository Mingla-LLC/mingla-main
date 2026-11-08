import { describe, expect, test } from "@jest/globals";

/**
 * #1022 preset contract, REWRITTEN for issue #1023 wave 2 (decision D-3,
 * Seth 2026-11-07): the 12 #1022 presets were replaced by the approved
 * design's 12 solids and 6 gradients. Invalidated assertions, named:
 *   - "the six grandfathered hexes are unchanged" / "the six new hexes are the
 *     accepted final set" — the strip is now the design's 12 solids;
 *   - page-class / dark-ceiling / "beats the best grandfathered" sweeps — they
 *     guarded small accent TEXT contrast through the fill accent. #1024
 *     (closed by the same PR, D-2) gives small text its own text-safe accent,
 *     so the strip no longer has to be chosen around that ceiling.
 * What stays true and is pinned here: every swatch is named, there are no
 * duplicates, lookups are case-insensitive, the fill-accent ceiling is still
 * the proven 4.2624 (the palette maths did not move — RT-1), and every swatch's
 * small text now clears AA through themeTextAccent.
 *
 * Contrast is measured through the REAL createThemePalette + contrastRatio.
 */

// Deep imports: the package INDEX re-exports RN components.
import {
  createThemePalette,
  themeTextAccent,
} from "../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../packages/offering-rendering/themeResolver";
import { contrastRatio } from "../buttonAccentContrast";
import {
  DARK_PAGE_CONTRAST_CEILING,
  GRADIENT_SWATCHES,
  SOLID_SWATCHES,
  THEME_PRESETS,
  WCAG_AA_NORMAL_TEXT,
  gradientSwatchFor,
  presetForHex,
} from "../../components/theme/themePresets";

const paletteFor = (seedHex: string) =>
  createThemePalette(resolveTheme(null, { color: seedHex, font: null, animation: null }));

describe("D-3 — the strip is the design's 12 solids and 6 gradients", () => {
  test("12 solids, 6 gradients; THEME_PRESETS is the solid strip", () => {
    expect(SOLID_SWATCHES).toHaveLength(12);
    expect(GRADIENT_SWATCHES).toHaveLength(6);
    expect(THEME_PRESETS).toBe(SOLID_SWATCHES);
    expect(SOLID_SWATCHES[0]).toEqual({ name: "Mingla orange", hex: "#eb7825" });
  });

  test("every swatch is named and stored lower case, with no duplicates", () => {
    for (const s of SOLID_SWATCHES) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.hex).toBe(s.hex.toLowerCase());
    }
    for (const g of GRADIENT_SWATCHES) {
      expect(g.hex).toBe(g.hex.toLowerCase());
      expect(g.hex2).toBe(g.hex2.toLowerCase());
    }
    const hexes = SOLID_SWATCHES.map((s) => s.hex);
    expect(new Set(hexes).size).toBe(hexes.length);
  });

  test("lookups are case-insensitive; old preset hexes no longer match (they read as Custom)", () => {
    expect(presetForHex("#FF5A5F")?.name).toBe("Coral");
    expect(presetForHex("#2563eb")).toBeNull();
    expect(presetForHex(null)).toBeNull();
    expect(gradientSwatchFor("#E8508F", "#7C5CFF")?.name).toBe("Berry");
    expect(gradientSwatchFor("#e8508f", null)).toBeNull();
  });
});

describe("contrast", () => {
  test("the fill accent still respects the proven dark-page ceiling (palette maths unchanged)", () => {
    for (const s of SOLID_SWATCHES) {
      const p = paletteFor(s.hex);
      if (p.primaryText === "#ffffff") {
        expect(contrastRatio(p.accent, p.page)).toBeLessThanOrEqual(DARK_PAGE_CONTRAST_CEILING + 0.01);
      }
    }
  });

  test("#1024 — every swatch's small text clears AA through the text-safe accent", () => {
    for (const s of [...SOLID_SWATCHES, ...GRADIENT_SWATCHES]) {
      const p = paletteFor(s.hex);
      expect(contrastRatio(themeTextAccent(p), p.page)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    }
  });

  test("the platform default fill is unchanged (#eb7825 still paints ~3.70:1)", () => {
    const p = paletteFor("#eb7825");
    expect(contrastRatio(p.accent, p.page)).toBeCloseTo(3.7, 1);
  });
});
