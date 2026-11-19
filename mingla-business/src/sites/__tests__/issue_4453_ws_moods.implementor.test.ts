/**
 * #4453 Website workspace — moods are data, and every mood is readable in
 * every design: proven with the shared contrast helpers, not by eye.
 */
import { DESIGN_KEYS, DESIGNS } from "../../../../packages/site-contracts/src/designs.ts";
import { assertOwnerTokenOverrides, resolveTokens } from "../../../../packages/site-contracts/src/tokens.ts";
import { contrastRatio, readabilityWarnings } from "../../../../packages/site-contracts/src/readability.ts";
import { activeMood, applyMood, contrastFixes, fixAllContrast, MOOD_KEYS, MOOD_PRESETS, moodFor, moodsFor } from "../designMoods";

describe("website moods", () => {
  it("offers exactly three moods, defined as data", () => {
    expect(MOOD_KEYS).toEqual(["playful", "premium", "night"]);
    expect(MOOD_KEYS.map((key) => MOOD_PRESETS[key].label)).toEqual(["Playful", "Premium", "Night out"]);
  });

  it.each(DESIGN_KEYS.flatMap((design) => MOOD_KEYS.map((mood) => [design, mood] as const)))(
    "%s + %s has no hard-to-read text and is a valid look",
    (designKey, moodKey) => {
      const design = DESIGNS[designKey];
      const mood = moodFor(design, moodKey);
      expect(() => assertOwnerTokenOverrides(mood.tokens)).not.toThrow();
      expect(readabilityWarnings(resolveTokens(design.tokens, mood.tokens))).toEqual([]);
      expect(mood.tokens.radius).toBe(MOOD_PRESETS[moodKey].radius);
      expect(mood.tokens.button_shape).toBe(MOOD_PRESETS[moodKey].button_shape);
      expect(mood.tokens.motion).toBe(MOOD_PRESETS[moodKey].motion);
    },
  );

  it("applies each mood's own colours in most designs (the repair is not a cop-out)", () => {
    const applied = DESIGN_KEYS.flatMap((design) => MOOD_KEYS.map((mood) => moodFor(DESIGNS[design], mood).coloursApplied));
    expect(applied.filter(Boolean).length).toBeGreaterThanOrEqual(Math.ceil(applied.length * 0.8));
  });

  it("button labels on the accent pass 4.5:1 in every mood", () => {
    for (const designKey of DESIGN_KEYS) {
      for (const entry of moodsFor(DESIGNS[designKey])) {
        const colours = resolveTokens(DESIGNS[designKey].tokens, entry.tokens).colors as unknown as { accent: Record<number, string>; accent_ink: string };
        expect(contrastRatio(colours.accent_ink, colours.accent[400]!)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("knows which mood is on, and keeps the owner's heading case when one is applied", () => {
    const design = DESIGNS.atelier;
    const tokens = applyMood(design, { heading_case: "uppercase" }, "premium");
    expect(tokens.heading_case).toBe("uppercase");
    expect(activeMood(design, tokens)).toBe("premium");
    expect(activeMood(design, {})).toBeNull();
  });

  it("the contrast guard names the pair and one tap fixes it", () => {
    const design = DESIGNS.atelier;
    const bad = { colors: { accent: { seed: "#2a3f9f", steps: { 400: "#2a3f9f" } }, accent_ink: "#1b1736" } } as never;
    const fixes = contrastFixes(design, bad);
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes[0]!.sentence).toMatch(/is hard to read \(\d+\.\d:1\)\.$/);
    const fixed = fixAllContrast(design, bad);
    expect(fixed).not.toBeNull();
    expect(contrastFixes(design, fixed!)).toEqual([]);
  });
});
