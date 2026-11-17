/*
 * #4453 final rework — Lighthouse contrast on the booking slots' "N left"
 * count (`.mg-slot__n`, 12 px, so WCAG AA needs 4.5:1). It used the accent
 * fill colour: 1.61:1 on Voyage and 2.63:1 on Pop. It now reads in the accent
 * ramp's 700 shade on the light styles and keeps the accent on the three dark
 * ones. This test computes the real contrast from each style's default ramp
 * against every background the slot sits on.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DESIGNS, DESIGN_KEYS } from "../../contracts/generated/designs.ts";

type Ramp = Record<string, string>;
type Colors = { canvas: string; surface: string; surface_sunken?: string; accent: { ramp: Ramp } };

function colorsOf(value: unknown, depth = 0): Colors | null {
  if (!value || typeof value !== "object" || depth > 4) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.canvas === "string" && record.accent && typeof record.accent === "object") return record as unknown as Colors;
  for (const child of Object.values(record)) {
    const found = colorsOf(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function luminance(hex: string): number {
  const channels = [0, 2, 4].map((i) => parseInt(hex.replace("#", "").slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const css = fs.readFileSync(path.join(process.cwd(), "public/designs/_shared/blocks-2.css"), "utf8");
const darkMatch = css.match(/:is\(([^)]*)\) \.mg-slot__n \{ color: var\(--mg-accent\); \}/);
const DARK = new Set([...(darkMatch?.[1] ?? "").matchAll(/data-design="([a-z]+)"/g)].map((m) => m[1]));

describe("#4453 slot count contrast (.mg-slot__n)", () => {
  it("the light styles read the accent's 700 shade; the dark styles keep the accent", () => {
    expect(css).toMatch(/\[data-design\] \.mg-slot__n \{[^}]*color: var\(--c-accent-700, var\(--mg-accent\)\);/);
    expect([...DARK].sort()).toEqual(["atelier", "nocturne", "pulse"]);
  });

  it.each(DESIGN_KEYS.map((key) => [key]))("%s: the count is at least 4.5:1 on every slot background", (key) => {
    const colors = colorsOf(DESIGNS[key]);
    expect(colors).not.toBeNull();
    const ramp = colors!.accent.ramp;
    const ink = DARK.has(key) ? ramp["400"] : ramp["700"];
    for (const background of [colors!.canvas, colors!.surface, colors!.surface_sunken].filter((v): v is string => typeof v === "string")) {
      expect(contrast(ink, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the accent fill alone fails on Voyage and Pop (why the shade exists)", () => {
    for (const key of ["voyage", "pop"] as const) {
      const colors = colorsOf(DESIGNS[key])!;
      expect(contrast(colors.accent.ramp["400"], colors.canvas)).toBeLessThan(4.5);
    }
  });
});
