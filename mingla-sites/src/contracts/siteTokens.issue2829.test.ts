// MINGLA-INVARIANT: I-PROPOSED-2829-07 | issue #2829 | Owner colour choices are stored and rendered exactly; Mingla warns about readability but never changes them.
/*
 * #2829 W3 (T-W3) — the token model, colour ramps and readability warnings.
 *
 * I-PROPOSED-2829-07 (DRAFT) Owner colour choices are stored and rendered
 * exactly; Mingla warns about readability but never changes them. Enforced by
 * R-10 (the round-trip and publish-with-warnings tests below and in the
 * builder suite).
 */
import { describe, expect, it } from "vitest";
import { generateRamp, hexToRgb, isHex, normalizeHex, RAMP_STEPS, rgbToHsl } from "./generated/colorRamp.ts";
import {
  assertOwnerTokenOverrides,
  assertResolvedTokens,
  designDefaultTokens,
  resolveTokens,
  tokenCssDeclarations,
  TOKEN_CSS_VARS,
} from "./generated/tokens.ts";
import { ATELIER } from "./generated/designs.ts";
import {
  contrastRatio,
  nearestPassingShade,
  READABILITY_PAIRS,
  readabilityWarnings,
  warningSentence,
} from "./generated/readability.ts";

describe("#2829 colour ramps", () => {
  it("is deterministic: the same seed always gives the same eleven steps", () => {
    const first = generateRamp("#ff00aa");
    const second = generateRamp("#ff00aa");
    expect(first).toEqual(second);
    expect(Object.keys(first).map(Number)).toEqual([...RAMP_STEPS]);
    for (const step of RAMP_STEPS) expect(isHex(first[step])).toBe(true);
    // Pinned values: a change to the ladder is a visible change to every
    // owner-seeded site, so it must be deliberate.
    expect(first[400]).toBe("#ff4dc3");
    expect(first[900]).toBe("#660a47");
  });

  it("runs light to dark and keeps the seed's hue", () => {
    const ramp = generateRamp("#2e7d32");
    const lightness = RAMP_STEPS.map((step) => rgbToHsl(hexToRgb(ramp[step])).l);
    for (let i = 1; i < lightness.length; i += 1) expect(lightness[i]!).toBeLessThan(lightness[i - 1]!);
    const seedHue = rgbToHsl(hexToRgb("#2e7d32")).h;
    expect(Math.abs(rgbToHsl(hexToRgb(ramp[500])).h - seedHue)).toBeLessThan(2);
  });

  it("only accepts #rrggbb", () => {
    expect(normalizeHex(" #FF00AA ")).toBe("#ff00aa");
    for (const bad of ["#fff", "red", "#ff00aa80", "rgb(1,2,3)", "#ff00aa;color:red"]) {
      expect(normalizeHex(bad)).toBeNull();
    }
  });
});

describe("#2829 token resolution", () => {
  it("design defaults resolve to the design's explicit values", () => {
    const tokens = designDefaultTokens(ATELIER.tokens);
    assertResolvedTokens(tokens);
    expect(tokens.colors.canvas).toBe("#101013");
    expect(tokens.colors.accent[400]).toBe("#cda052");
    expect(tokens.colors.accent[300]).toBe("#dfb262");
    expect(tokens.heading_case).toBe("uppercase");
  });

  it("restore defaults is byte-identical (SC-14): empty overrides and a seed equal to the design seed", () => {
    const defaults = JSON.stringify(designDefaultTokens(ATELIER.tokens));
    expect(JSON.stringify(resolveTokens(ATELIER.tokens, {}))).toBe(defaults);
    expect(JSON.stringify(resolveTokens(ATELIER.tokens, null))).toBe(defaults);
    // The generated ramp for #cda052 is NOT atelier's drawn ramp; restoring the
    // seed must give the drawn one.
    expect(generateRamp("#cda052")[200]).not.toBe("#dcb877");
    expect(JSON.stringify(resolveTokens(ATELIER.tokens, { colors: { accent: { seed: "#cda052" } } }))).toBe(defaults);
  });

  it("a new seed regenerates the role; an owner's exact step is kept exactly", () => {
    const tokens = resolveTokens(ATELIER.tokens, {
      colors: { accent: { seed: "#ff00aa", steps: { 400: "#ff00aa" } } },
    });
    expect(tokens.colors.accent[400]).toBe("#ff00aa");
    expect(tokens.colors.accent[600]).toBe(generateRamp("#ff00aa")[600]);
    expect(tokens.colors.highlight[600]).toBe("#cda052");
  });

  it("R-10: any owner hex round-trips unchanged, even when it is unreadable", () => {
    const owner = { colors: { ink_body: "#bbbbbb", canvas: "#ffffff", accent_ink: "#cda052" } };
    assertOwnerTokenOverrides(owner);
    const tokens = resolveTokens(ATELIER.tokens, owner);
    expect(tokens.colors.ink_body).toBe("#bbbbbb");
    expect(tokens.colors.canvas).toBe("#ffffff");
    expect(tokens.colors.accent_ink).toBe("#cda052");
    expect(readabilityWarnings(tokens).length).toBeGreaterThan(0);
    // Computing warnings never edits the tokens it read.
    expect(tokens.colors.ink_body).toBe("#bbbbbb");
  });

  it("refuses anything that is not a token value of a fixed type (S-10)", () => {
    const bad: unknown[] = [
      { colors: { ink_body: "red" } },
      { colors: { ink_body: "#fff" } },
      { colors: { canvas: "#ffffff;background:url(x)" } },
      { colors: { scrim_rgb: "1 2 3" } },
      { colors: { accent: { seed: "#ff00aa", steps: { 450: "#000000" } } } },
      { colors: { accent: { css: "x" } } },
      { colors: { highlight: { steps: { 400: "#000000" } } } },
      { radius: "huge" },
      { motion: "fast" },
      { font: "x" },
      "string",
    ];
    for (const value of bad) expect(() => assertOwnerTokenOverrides(value)).toThrow(/TOKENS_INVALID/);
  });

  it("emits one declaration per token custom property, values validated", () => {
    const declarations = tokenCssDeclarations(designDefaultTokens(ATELIER.tokens));
    expect(declarations.map((line) => line.split(":")[0])).toEqual([...TOKEN_CSS_VARS]);
    expect(declarations).toContain("--c-canvas:#101013");
    expect(declarations).toContain("--c-accent-400:#cda052");
    expect(declarations).toContain("--c-scrim-rgb:8 6 4");
    expect(declarations).toContain("--radius-scale:1");
    expect(declarations).toContain("--display-case:uppercase");
    const tampered = designDefaultTokens(ATELIER.tokens);
    (tampered.colors as unknown as Record<string, string>).canvas = "red;}body{display:none";
    expect(tokenCssDeclarations(tampered).some((line) => line.startsWith("--c-canvas:"))).toBe(false);
  });
});

describe("#2829 readability warnings", () => {
  it("knows the WCAG ratios of reference pairs", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    expect(contrastRatio("#bbbbbb", "#ffffff")).toBeCloseTo(1.92, 2);
  });

  it("covers the fixed pair list from the spec", () => {
    expect(READABILITY_PAIRS.map((pair) => `${pair.foreground}/${pair.background}>=${pair.required}`)).toEqual([
      "ink_body/canvas>=4.5",
      "ink_strong/canvas>=3",
      "ink_strong/canvas>=4.5",
      "ink_prose/canvas>=4.5",
      "ink_quiet/canvas>=4.5",
      "ink_body/surface_sunken>=4.5",
      "accent_ink/accent.400>=4.5",
      "action/canvas>=4.5",
      "white/surface_deep>=4.5",
      "ink_on_dark_body/surface_deep>=4.5",
      "highlight.700/highlight.50>=4.5",
      "white/highlight.700>=4.5",
    ]);
  });

  it("warns for ink_body #bbbbbb on white, in plain English, with the ratio", () => {
    const tokens = resolveTokens(ATELIER.tokens, { colors: { ink_body: "#bbbbbb", canvas: "#ffffff" } });
    const body = readabilityWarnings(tokens).find((warning) => warning.pair === "body_on_canvas");
    expect(body).toEqual({
      pair: "body_on_canvas",
      foreground: "#bbbbbb",
      background: "#ffffff",
      ratio: 1.92,
      required: 4.5,
      where: "Body text on your page background",
    });
    expect(warningSentence(body!)).toBe("Body text on your page background is hard to read (1.9:1; aim for 4.5:1).");
  });

  it("atelier's own defaults raise no warning", () => {
    expect(readabilityWarnings(designDefaultTokens(ATELIER.tokens))).toEqual([]);
  });

  it("suggests (never applies) the nearest passing shade", () => {
    const shade = nearestPassingShade("#bbbbbb", "#ffffff", 4.5);
    expect(shade).not.toBeNull();
    expect(contrastRatio(shade!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(nearestPassingShade("#111111", "#ffffff", 4.5)).toBe("#111111");
  });
});
