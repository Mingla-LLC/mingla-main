// MINGLA-INVARIANT: I-1023-GRADIENT-ONE-UNIT | issue #1023 | The second colour always comes from the same level as the first, and only when its stored first stop equals that level's colour.
/**
 * issue #1023 wave 2 — P-2. The six precedence rows of the spec's table, the
 * stale and orphan guards, font canonicalisation and keys, the motion palette
 * taking the gradient's second colour, and #1024's text-safe accent (small
 * text only; fills keep the exact colour).
 *
 * Fails on revert: resolving colour and color2 independently (rows 1 and 5
 * go red), dropping the first-stop check in color2FromColumn, or the motion
 * players going back to buildThemeMotionPalette(color).
 */
import { readFile } from "fs/promises";
import path from "path";
import { describe, expect, test } from "@jest/globals";

import { buildThemeMotionPalette } from "../../../../../packages/theme-animations/tint";
import {
  canonicalThemeFont,
  color2FromColumn,
  familyFromGoogleFontKey,
  googleFontKey,
  gradientToColumn,
  resolveTheme,
  themeInputFromFields,
} from "../../../../../packages/offering-rendering/themeResolver";
import {
  boldFontFamily,
  contrastRatio,
  createThemePalette,
  themeTextAccent,
} from "../../../../../packages/offering-rendering/themePalette";

const REPO = path.resolve(__dirname, "../../../../..");
const read = (rel: string): Promise<string> => readFile(path.join(REPO, rel), "utf8");

describe("I-1023-GRADIENT-ONE-UNIT — the six precedence rows", () => {
  test("solid offering over a gradient brand = solid", () => {
    const t = resolveTheme({ color: "#2da8ff", color2: "#14e0b0" }, { color: "#ff5a5f" });
    expect([t.color, t.color2]).toEqual(["#ff5a5f", null]);
  });
  test("gradient offering over a solid brand = the offering gradient", () => {
    const t = resolveTheme({ color: "#ff5a5f" }, { color: "#e8508f", color2: "#7c5cff" });
    expect([t.color, t.color2]).toEqual(["#e8508f", "#7c5cff"]);
  });
  test("no offering colour = the brand gradient", () => {
    const t = resolveTheme({ color: "#2da8ff", color2: "#14e0b0" }, null);
    expect([t.color, t.color2]).toEqual(["#2da8ff", "#14e0b0"]);
  });
  test("nothing set = Mingla orange, solid", () => {
    const t = resolveTheme(null, null);
    expect([t.color, t.color2]).toEqual(["#eb7825", null]);
  });
  test("an offering colour with a stale stored gradient = solid", () => {
    const override = themeInputFromFields("#22c55e", null, null, "#e8508f,#7c5cff");
    const t = resolveTheme({ color: "#2da8ff", color2: "#14e0b0" }, override);
    expect([t.color, t.color2]).toEqual(["#22c55e", null]);
  });
  test("a second colour with no first colour (old client reset) = the brand's", () => {
    const t = resolveTheme({ color: "#2da8ff", color2: "#14e0b0" }, { color: null, color2: "#7c5cff" });
    expect([t.color, t.color2]).toEqual(["#2da8ff", "#14e0b0"]);
  });
});

describe("the gradient column", () => {
  test("round-trips one unit, lower case", () => {
    expect(gradientToColumn("#E8508F", "#7C5CFF")).toBe("#e8508f,#7c5cff");
    expect(gradientToColumn("#e8508f", null)).toBeNull();
    expect(gradientToColumn(null, "#7c5cff")).toBeNull();
  });
  test("reads the second stop only when the first stop matches the colour", () => {
    expect(color2FromColumn("#E8508F", "#e8508f,#7c5cff")).toBe("#7c5cff");
    expect(color2FromColumn("#22c55e", "#e8508f,#7c5cff")).toBeNull(); // stale
    expect(color2FromColumn(null, "#e8508f,#7c5cff")).toBeNull(); // orphan
    expect(color2FromColumn("#e8508f", "#e8508f")).toBeNull(); // malformed
  });
});

describe("Google family fonts", () => {
  test("a bundled family saves as its slug; others stay as spelt", () => {
    expect(canonicalThemeFont("Inter")).toBe("inter");
    expect(canonicalThemeFont("DM Serif Display")).toBe("dm_serif_display");
    expect(canonicalThemeFont("Roboto Slab")).toBe("Roboto Slab");
  });
  test("a family resolves to fixed GF_ keys for base and bold; a slug keeps the bundled map", () => {
    const g = resolveTheme({ font: "Roboto Slab" }, null);
    expect(g.fontFamilyValue).toBe("GF_Roboto_Slab_500");
    expect(boldFontFamily(g)).toBe("GF_Roboto_Slab_700");
    expect(familyFromGoogleFontKey(googleFontKey("Roboto Slab", 700))).toBe("Roboto Slab");
    const legacy = resolveTheme({ font: "Inter" }, null);
    expect(legacy.font).toBe("inter");
    expect(legacy.fontFamilyValue).toBe("Inter_500Medium");
    expect(boldFontFamily(legacy)).toBe("Inter_700Bold");
  });
  test("an invalid family falls through to the brand, then Mingla's Inter", () => {
    expect(resolveTheme({ font: "Lora" }, { font: "roboto slab" }).font).toBe("lora");
    expect(resolveTheme(null, { font: "Inter;drop" }).font).toBe("inter");
  });
});

describe("motion takes the gradient's second colour", () => {
  test("the palette key is both stops for a gradient, one for a solid", () => {
    const berry = resolveTheme({ color: "#e8508f", color2: "#7c5cff" }, null);
    expect(buildThemeMotionPalette(berry.color, berry.color2).key).toBe("#e8508f/#7c5cff");
    const solidOverBerry = resolveTheme({ color: "#e8508f", color2: "#7c5cff" }, { color: "#ff5a5f" });
    expect(buildThemeMotionPalette(solidOverBerry.color, solidOverBerry.color2).key).toBe("#ff5a5f");
  });
  test("both players pass theme.color2 into the palette", async () => {
    for (const file of [
      "packages/offering-rendering/ThemeEntranceAnimation.tsx",
      "packages/offering-rendering/ThemeEntranceAnimationWebImpl.tsx",
    ]) {
      const src = await read(file);
      expect(src).toContain("color2={theme.color2 ?? null}");
      expect(src).toContain("buildThemeMotionPalette(color, color2)");
    }
  });
});

describe("#1024 — small accent text is lightened, fills keep the colour", () => {
  test("Mingla orange: the fill stays under 4.5 on the dark page, the text accent clears it", () => {
    const palette = createThemePalette(resolveTheme(null, null));
    expect(contrastRatio(palette.accent, palette.page)).toBeLessThan(4.5);
    expect(contrastRatio(themeTextAccent(palette), palette.page)).toBeGreaterThanOrEqual(4.5);
  });
  test("every design swatch's small text reaches 4.5:1 on its own page", () => {
    for (const hex of ["#eb7825", "#ff5a5f", "#e8508f", "#c25cf0", "#7c5cff", "#4f6bff", "#2da8ff", "#14b8a6", "#22c55e", "#a3e635", "#f5b700", "#d9a066"]) {
      const palette = createThemePalette(resolveTheme({ color: hex }, null));
      expect(contrastRatio(themeTextAccent(palette), palette.page)).toBeGreaterThanOrEqual(4.5);
    }
  });
  test("a colour that already reads well is unchanged", () => {
    const palette = createThemePalette(resolveTheme({ color: "#111827" }, null));
    expect(themeTextAccent(palette)).toBe(palette.accent);
  });
  test("the eleven small-text places use the text accent; fills use the accent fill (gradient-aware)", async () => {
    const event = await read("packages/offering-rendering/PublicEventPage.tsx");
    for (const style of ["showAllLabel", "brandCta", "aboutToggle"]) {
      expect(event).toContain(`styles.${style}, { color: themeTextAccent(palette) }`);
    }
    expect(event).toContain("{ color: themeTextAccent(palette), fontFamily: boldFontFamily(theme) }");
    // Was `{ backgroundColor: palette.accent }`; invalidated by the #1023
    // gradient-everywhere scope: fills now paint through accentFill(palette).
    expect(event).toContain("styles.brandTile, accentFill(palette)");
    const brand = await read("packages/brand-rendering/PublicBrandPage.tsx");
    for (const style of ["verifiedBadge", "eventTypeLabel", "oCardDate", "readMore"]) {
      expect(brand).toContain(`styles.${style}, { color: themeTextAccent(palette) }`);
    }
    expect(brand).toContain("styles.buyPill, accentFill(palette)");
    expect(await read("packages/offering-rendering/EventOfferingBody.tsx")).toContain(
      "styles.acquisitionEyebrow, { color: themeTextAccent(palette) }",
    );
    const exp = await read("packages/offering-rendering/ExperienceOfferingBody.tsx");
    expect(exp).toContain("styles.eyebrowLead, { color: themeTextAccent(palette) }");
    expect(exp).toContain("styles.saleAvailability, { color: themeTextAccent(palette) }");
  });
});
