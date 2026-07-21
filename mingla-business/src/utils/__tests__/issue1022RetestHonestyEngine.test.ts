/**
 * #1022 — RETEST adversarial suite (tester-owned, different angle).
 *
 * Every existing #1022 suite attacks the persistence spine, the sheet geometry,
 * or the SOURCE STRUCTURE of a fix (grep-shaped assertions). NONE of them runs
 * the real `createThemePalette(resolveTheme(...))` derivation and asserts the
 * one behavioural promise the whole control makes to the organiser: the
 * "On the page this becomes {ACCENT} so labels stay readable" disclosure at
 * ThemeSheet.tsx:633. If that math regresses, every source-grep test stays
 * green while the product silently starts lying to organisers about their
 * colour. This suite pins it.
 *
 * ANGLE: exact derived-accent values (anchored to on-device runtime evidence,
 * physical iPhone 17 Pro + SM-A725F, #1022 retest) + the universal WCAG-AA
 * readability invariant the derivation exists to guarantee.
 *
 * Runtime anchor (captured on device, retest 2026-07-21):
 *   seed #ff8800 -> the sheet displayed "becomes #A25700"      (iPhone 17 Pro)
 *   seed #eb7825 -> the SPEC's documented "becomes #AE591C"    (design §3.2)
 *
 * fails-on-revert: weaken `contrastAdjustedForWhiteText(..., 4.5)` in
 * packages/offering-rendering/themePalette.ts (e.g. drop the 4.5 target, or
 * return the seed unadjusted) and the readability invariant below goes red.
 */
import { describe, expect, test } from "@jest/globals";

import { resolveTheme } from "../../../../packages/offering-rendering/themeResolver";
import { createThemePalette } from "../../../../packages/offering-rendering/themePalette";
import { contrastRatio } from "../buttonAccentContrast";

type SeedTheme = { color: string };

const paletteFor = (hex: string) =>
  createThemePalette(resolveTheme({ color: hex } as SeedTheme, null));

describe("#1022 honesty engine — the derived accent the disclosure promises", () => {
  test("seed #ff8800 derives EXACTLY the #a25700 the sheet showed on device", () => {
    // The value the ThemeSheet disclosure rendered verbatim on the iPhone 17 Pro
    // during the retest. If the derivation drifts, the on-screen promise and the
    // page's real accent diverge — the disclosure becomes a lie.
    expect(paletteFor("#ff8800").accent.toLowerCase()).toBe("#a25700");
  });

  test("seed #eb7825 derives EXACTLY the #ae591c the design spec documents", () => {
    expect(paletteFor("#eb7825").accent.toLowerCase()).toBe("#ae591c");
  });

  test("the disclosure only fires when the accent truly differs from the seed", () => {
    // ThemeSheet gates the disclosure on `seedVsDerived > 1.15`. A colour that
    // already reads fine (a dark seed) must NOT be adjusted, so the disclosure
    // must stay hidden and the accent must equal the seed. A vivid seed MUST be
    // adjusted, so the two must differ enough to cross the 1.15 gate.
    const darkSeed = "#2a1c15";
    const darkPalette = paletteFor(darkSeed);
    expect(darkPalette.accent.toLowerCase()).toBe(darkSeed);
    expect(contrastRatio(darkSeed, darkPalette.accent)).toBeLessThanOrEqual(1.15);

    const vividPalette = paletteFor("#ff8800");
    expect(contrastRatio("#ff8800", vividPalette.accent)).toBeGreaterThan(1.15);
  });
});

describe("#1022 honesty engine — the readability invariant it exists to keep", () => {
  // A battery spanning the whole hue wheel + the SC-26 pure-yellow worst case
  // (#ffff00 is the classic "unreadable as a button" colour the spec calls out).
  const seeds = [
    "#ff8800", // orange (device-verified)
    "#eb7825", // brand orange (spec-verified)
    "#ffff00", // SC-26 pure yellow — the adversarial worst case
    "#00ff00", // pure green
    "#2563eb", // ocean blue (swatch, web-verified)
    "#ff0000", // pure red
    "#ec4899", // magenta
  ];

  test.each(seeds)(
    "seed %s -> an accent whose white label text clears WCAG AA (>= 4.5:1)",
    (seed) => {
      const palette = paletteFor(seed);
      // accentText is the label colour painted ON the accent (button) surface.
      const ratio = contrastRatio(palette.accent, palette.accentText);
      expect(palette.accentText).toBe("#ffffff");
      // 4.49 tolerance: the derivation targets 4.5 but rounds to a 6-digit hex,
      // so the realised ratio can land a hair under the ideal target.
      expect(ratio).toBeGreaterThanOrEqual(4.49);
    },
  );

  test("a NULL override inherits with no fabricated accent (per-axis honesty)", () => {
    // resolveTheme(null, null) must still produce a usable, readable palette —
    // never a crash, never a transparent/empty accent that would render invisible.
    const palette = createThemePalette(resolveTheme(null, null));
    expect(palette.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(contrastRatio(palette.accent, palette.accentText)).toBeGreaterThanOrEqual(4.49);
  });
});
