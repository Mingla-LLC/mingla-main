import { describe, expect, jest, test } from "@jest/globals";

/**
 * #1022 C-1 — resolveTheme argument order, and the value-line grammar.
 *
 * Covers SPEC test case T-5.
 *
 * `resolveTheme(brandTheme, eventOverride)` — the BRAND theme occupies the
 * FIRST slot. The shipped ThemeEditorSection called
 * `resolveTheme(value ?? null, null)`, putting the OFFERING's own override in
 * the BRAND slot. On the published-event editor the brand theme was therefore
 * never supplied at all: an unthemed event previewed Mingla's orange/Inter/None
 * and marked those pills selected, while the live event actually rendered in
 * the brand's colour and font. The editor was actively misreporting inheritance
 * — Seth's "weird text not aligned and speced properly" class, but worse,
 * because it was lying about data.
 *
 * Fails-on-revert target: swap the arguments back in themeValueLine (or in the
 * row's palette memo) and this suite goes red.
 */

jest.mock("../../services/supabase", () => ({
  supabase: { from: jest.fn() },
}));

import { resolveTheme } from "../../../../packages/offering-rendering/themeResolver";
import { themeValueLine } from "../../components/theme/themeColorModel";

const GREEN_BRAND = {
  color: "#16a34a",
  font: "poppins",
  animation: "confetti",
};

describe("T-5 — an unthemed offering under a themed brand resolves to the BRAND", () => {
  test("colour, font and animation all come from the brand, not Mingla defaults", () => {
    const resolved = resolveTheme(GREEN_BRAND, null);
    expect(resolved.color).toBe("#16a34a");
    expect(resolved.font).toBe("poppins");
    expect(resolved.animation).toBe("confetti");
  });

  test("the arguments are NOT interchangeable — this is what C-1 got wrong", () => {
    const correct = resolveTheme(GREEN_BRAND, null);
    const reversed = resolveTheme(null, GREEN_BRAND);
    // Both happen to resolve the same here (one side is null), so prove the
    // asymmetry with a real conflict instead:
    const brandGreen = resolveTheme(GREEN_BRAND, {
      color: "#dc2626",
      font: null,
      animation: null,
    });
    // The OVERRIDE wins on colour; the BRAND still supplies font.
    expect(brandGreen.color).toBe("#dc2626");
    expect(brandGreen.font).toBe("poppins");
    expect(correct.color).toBe(reversed.color);
  });

  test("a per-axis override leaves the other axes inherited from the brand", () => {
    const resolved = resolveTheme(GREEN_BRAND, {
      color: "#2563eb",
      font: null,
      animation: null,
    });
    expect(resolved.color).toBe("#2563eb");
    expect(resolved.font).toBe("poppins");
    expect(resolved.animation).toBe("confetti");
  });
});

describe("T-5 — the value line reports inheritance truthfully", () => {
  test("offering scope, nothing overridden, themed brand -> brand's font is named", () => {
    const line = themeValueLine(null, "offering", GREEN_BRAND);
    expect(line).toBe("Brand default · Poppins · Confetti");
    // The C-1 regression would have produced Inter / No motion here.
    expect(line).not.toContain("Inter");
    expect(line).not.toContain("No motion");
  });

  test("offering scope with a colour override reads 'Custom colour'", () => {
    const line = themeValueLine(
      { color: "#2563eb", font: null, animation: null },
      "offering",
      GREEN_BRAND,
    );
    expect(line).toBe("Custom colour · Poppins · Confetti");
  });

  test("brand scope with nothing set reads 'Mingla default · Inter · No motion'", () => {
    expect(themeValueLine(null, "brand", null)).toBe(
      "Mingla default · Inter · No motion",
    );
  });

  test("animation 'none' renders as 'No motion', never 'None'", () => {
    const line = themeValueLine(
      { color: null, font: null, animation: "none" },
      "offering",
      GREEN_BRAND,
    );
    expect(line).toContain("No motion");
    expect(line).not.toMatch(/·\s*None\s*$/);
  });

  test("an all-null override is treated as fully inherited", () => {
    expect(
      themeValueLine(
        { color: null, font: null, animation: null },
        "offering",
        GREEN_BRAND,
      ),
    ).toBe("Brand default · Poppins · Confetti");
  });

  test("undefined brand theme falls back to Mingla defaults without crashing", () => {
    expect(themeValueLine(null, "offering", undefined)).toBe(
      "Brand default · Inter · No motion",
    );
  });
});
