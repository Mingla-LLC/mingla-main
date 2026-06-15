/**
 * TESTER ADVERSARIAL (ORCH-1138 Leg 1) — createThemePalette contrast INVARIANT
 * sweep. Different angle from the implementor's RT-1..RT-4:
 *   - RT-1 pins the EXACT palette object for 4 FIXED colors (a snapshot — catches
 *     drift but proves nothing about colors it doesn't list).
 *   - This test makes NO snapshot. It asserts the WCAG-AA contrast CONTRACT that
 *     SC-2 actually promises ("contrast-safe LIGHT/dark page; AA text contrast")
 *     holds as an INVARIANT across a wide sweep of brand hues (the full color
 *     wheel at multiple lightnesses) + adversarial inputs (pure black/white,
 *     malformed hex, the saffron case the SPEC example got backwards).
 *
 * The guarantee under test (independently computed WCAG here — never reusing the
 * module's own contrast math, so the assertion can't be co-bugged):
 *   1. primaryText vs page   >= 4.5  (AA normal text)
 *   2. white (accentText) vs accent >= 4.5  (CTA label legibility — the engine's
 *      `contrastAdjustedForWhiteText(..., 4.5)` promise)
 *   3. accent vs page        >= 3.0  (AA large/UI element — the engine targets
 *      3.15 via contrastAdjustedAccent)
 *   4. surface tone is internally consistent: primaryText==='#000000' ⇔ page is
 *      light (luminance > 0.5) and resolveOfferingSurface()==='light'.
 *
 * fails-on-revert: weaken the engine's contrast targets (e.g. drop the
 * `contrastAdjustedForWhiteText(...,4.5)` wrap, or lower 3.15→1, or flip the
 * useDark decision) and at least one swept hue violates a threshold → red.
 *
 * Pure: imports the RN-free themePalette + themeResolver modules directly (no
 * React mount needed), same resolution path the public trip route uses.
 *
 * Owner: mingla-tester (adversarial; append-only; different angle than RT-1..4).
 */

import { describe, expect, test } from "@jest/globals";

import {
  createThemePalette,
  resolveOfferingSurface,
} from "../../../../../packages/event-rendering/themePalette";
import { resolveTheme } from "../../../../../packages/event-rendering/themeResolver";

// --- independent WCAG contrast (NOT imported from the module under test) ---
function chan(c: number): number {
  const n = c / 255;
  return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}
function lumFromRgb(r: number, g: number, b: number): number {
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}
function lum(color: string): number {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(color);
  if (hex !== null) {
    const v = hex[1];
    return lumFromRgb(
      parseInt(v.slice(0, 2), 16),
      parseInt(v.slice(2, 4), 16),
      parseInt(v.slice(4, 6), 16),
    );
  }
  const rgba = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(color);
  if (rgba !== null) {
    return lumFromRgb(+rgba[1], +rgba[2], +rgba[3]);
  }
  throw new Error(`unparseable color ${color}`);
}
function contrast(a: string, b: string): number {
  const la = lum(a);
  const lb = lum(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// A wide brand-hue sweep: 12 hues × 3 lightness levels (HSL→hex), plus the
// adversarial fixed cases. This is the population RT-1 never covers.
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

const sweep: string[] = [];
for (let h = 0; h < 360; h += 30) {
  for (const l of [0.3, 0.5, 0.7]) {
    sweep.push(hslToHex(h, 0.8, l));
  }
}
// adversarial fixed cases (incl. the saffron the SPEC example got backwards,
// pure black, near-black, and a malformed hex). NOTE: pure/near-WHITE accents
// (#ffffff/#fefefe) are deliberately EXCLUDED from the accent-on-page assertion
// — see the documented P3: the contrast engine cannot lift a white accent to
// >=3.0 on a near-white light page (a degenerate brand input no real brand sets;
// the body-text and white-on-accent guarantees still hold even there). This is
// PRE-EXISTING engine behavior (byte-identical extraction), not ORCH-1138.
const adversarial = [
  "#f5c518", // saffron — bright yellow (SPEC said "light page"; engine picks dark — both must be AA-safe)
  "#000000", // pure black
  "#010101", // near-black
  "#zzpppp", // malformed → engine falls back to default accent; must still be AA-safe
];
// the two hard guarantees (text-on-page + white-on-accent) hold for EVERYTHING,
// including the degenerate white accents.
const everything = [...sweep, ...adversarial, "#ffffff", "#fefefe"];

describe("TESTER ORCH-1138 — createThemePalette WCAG-AA contrast invariant (hue sweep)", () => {
  const accentSafe = [...sweep, ...adversarial];

  test.each(accentSafe)("hue %s yields an AA-safe palette", (color) => {
    const theme = resolveTheme({ color }, null);
    const p = createThemePalette(theme);

    const textOnPage = contrast(p.primaryText, p.page);
    const whiteOnAccent = contrast(p.accentText, p.accent);
    const accentOnPage = contrast(p.accent, p.page);

    expect(textOnPage).toBeGreaterThanOrEqual(4.5);
    expect(whiteOnAccent).toBeGreaterThanOrEqual(4.5);
    expect(accentOnPage).toBeGreaterThanOrEqual(3.0);

    // accentText is always white per the engine contract.
    expect(p.accentText).toBe("#ffffff");
  });

  test.each(everything)(
    "hue %s ALWAYS satisfies the two hard guarantees (text + CTA legibility)",
    (color) => {
      const theme = resolveTheme({ color }, null);
      const p = createThemePalette(theme);
      // these two are non-negotiable for EVERY input, incl. degenerate whites:
      expect(contrast(p.primaryText, p.page)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.accentText, p.accent)).toBeGreaterThanOrEqual(4.5);
    },
  );

  test("surface tone is internally consistent across the sweep", () => {
    for (const color of everything) {
      const theme = resolveTheme({ color }, null);
      const p = createThemePalette(theme);
      const surface = resolveOfferingSurface(theme);
      const pageIsLight = lum(p.page) > 0.5;
      if (p.primaryText === "#000000") {
        // black text ⇒ the page must be light AND the surface tone agrees.
        expect(pageIsLight).toBe(true);
        expect(surface).toBe("light");
      } else {
        expect(p.primaryText).toBe("#ffffff");
        expect(pageIsLight).toBe(false);
        expect(surface).toBe("dark");
      }
    }
  });

  test("saffron (#f5c518) — the SPEC example: page+text are AA-safe whichever tone the engine picks", () => {
    // SC-2's worked example claims saffron → LIGHT page. The shipped engine
    // (byte-identical to the event page) picks DARK for saffron because yellow
    // fails contrast on a light page. The CONTRACT that must hold either way is
    // AA contrast — assert that, not the tone. (SPEC example is a doc nit; the
    // implementation is contrast-correct.)
    const theme = resolveTheme({ color: "#f5c518" }, null);
    const p = createThemePalette(theme);
    expect(contrast(p.primaryText, p.page)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.accentText, p.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.accent, p.page)).toBeGreaterThanOrEqual(3.0);
  });
});
