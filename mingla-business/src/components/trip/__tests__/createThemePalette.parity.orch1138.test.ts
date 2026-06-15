/**
 * RT-1 — createThemePalette palette parity snapshot (ORCH-1138 A1 gate).
 *
 * createThemePalette + the color-math helpers were extracted VERBATIM out of
 * PublicEventPage.tsx into packages/event-rendering/themePalette.ts
 * (behavior-neutral). This test pins the EXACT palette output across a fixed
 * matrix of ResolvedTheme inputs (dark accent, light accent / light page,
 * default, edge low-contrast). It MUST PASS with the extracted module and FAIL
 * on ANY palette-algorithm drift (a changed color-math helper, a tweaked
 * threshold). The frozen values below were captured from the extracted module.
 *
 * ORCH-1138 A1 — createThemePalette was extracted from PublicEventPage behavior-
 * neutrally; this snapshot fails on any palette-algorithm drift.
 *
 * fails-on-revert: reverting the extraction (or altering a helper) flips a
 * snapshot value below. Owner: mingla-implementor (the tester adds a second
 * adversarial angle).
 *
 * Imported by relative path — themePalette.ts imports ONLY the ResolvedTheme
 * type from ./designTokens (no RN runtime), so it resolves under ts-jest
 * without the @mingla path alias.
 */

import { describe, expect, test } from "@jest/globals";

import {
  createThemePalette,
  resolveOfferingSurface,
} from "../../../../../packages/event-rendering/themePalette";
import type { ResolvedTheme } from "../../../../../packages/event-rendering/designTokens";

const theme = (
  color: string,
  foregroundColor: "#000000" | "#ffffff",
): ResolvedTheme => ({
  color,
  foregroundColor,
  font: "inter",
  fontFamilyValue: "Inter_500Medium",
  animation: "none",
});

describe("RT-1 ORCH-1138 — createThemePalette parity (behavior-neutral extraction)", () => {
  test("dark accent (deep teal #0f766e) → dark page, white-leaning text", () => {
    expect(createThemePalette(theme("#0f766e", "#ffffff"))).toEqual({
      page: "#081214",
      accent: "#0f766e",
      accentText: "#ffffff",
      primaryText: "#ffffff",
      secondaryText: "rgba(255,255,255,0.78)",
      tertiaryText: "rgba(255,255,255,0.58)",
      panel: "rgba(255,255,255,0.08)",
      panelStrong: "rgba(255,255,255,0.11)",
      panelBorder: "rgba(15,118,110,0.38)",
      card: "rgba(255,255,255,0.10)",
      cutoutBorder: "rgba(255,255,255,0.24)",
      glass: "rgba(255,255,255,0.12)",
      glassTint: "dark",
      accentWash: "rgba(15,118,110,0.24)",
    });
    expect(resolveOfferingSurface(theme("#0f766e", "#ffffff"))).toBe("dark");
  });

  test("dark accent (navy #1e3a8a) → LIGHT page, black-leaning text (SC-2)", () => {
    const p = createThemePalette(theme("#1e3a8a", "#000000"));
    expect(p).toEqual({
      page: "#f0f3f8",
      accent: "#1e3a8a",
      accentText: "#ffffff",
      primaryText: "#000000",
      secondaryText: "rgba(16,20,31,0.76)",
      tertiaryText: "rgba(16,20,31,0.58)",
      panel: "rgba(255,255,255,0.76)",
      panelStrong: "rgba(255,255,255,0.92)",
      panelBorder: "rgba(30,58,138,0.3)",
      card: "rgba(255,255,255,0.72)",
      cutoutBorder: "rgba(255,255,255,0.96)",
      glass: "rgba(255,255,255,0.62)",
      glassTint: "light",
      accentWash: "rgba(30,58,138,0.18)",
    });
    expect(p.primaryText).toBe("#000000");
    expect(resolveOfferingSurface(theme("#1e3a8a", "#000000"))).toBe("light");
  });

  test("default Mingla theme (#eb7825) is stable", () => {
    const p = createThemePalette(theme("#eb7825", "#000000"));
    expect(p.page).toBe("#1e120d");
    expect(p.accent).toBe("#ae591c");
    expect(p.glassTint).toBe("dark");
    expect(p.accentText).toBe("#ffffff");
    expect(p.primaryText).toBe("#ffffff");
  });

  test("edge low-contrast accent (crimson #e11d48) resolves a valid dark palette", () => {
    expect(createThemePalette(theme("#e11d48", "#ffffff"))).toEqual({
      page: "#1d0910",
      accent: "#e11d48",
      accentText: "#ffffff",
      primaryText: "#ffffff",
      secondaryText: "rgba(255,255,255,0.78)",
      tertiaryText: "rgba(255,255,255,0.58)",
      panel: "rgba(255,255,255,0.08)",
      panelStrong: "rgba(255,255,255,0.11)",
      panelBorder: "rgba(225,29,72,0.38)",
      card: "rgba(255,255,255,0.10)",
      cutoutBorder: "rgba(255,255,255,0.24)",
      glass: "rgba(255,255,255,0.12)",
      glassTint: "dark",
      accentWash: "rgba(225,29,72,0.24)",
    });
  });

  test("accentText is always #ffffff and white-on-accent is AA-safe (≥4.5:1)", () => {
    const samples: Array<[string, "#000000" | "#ffffff"]> = [
      ["#0f766e", "#ffffff"],
      ["#1e3a8a", "#000000"],
      ["#eb7825", "#000000"],
      ["#e11d48", "#ffffff"],
      ["#6d28d9", "#ffffff"],
    ];
    for (const [color, fg] of samples) {
      const p = createThemePalette(theme(color, fg));
      expect(p.accentText).toBe("#ffffff");
      expect(contrast("#ffffff", p.accent)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// independent WCAG contrast (mirrors the package's own; computed here so the
// AA assertion does not depend on the module under test).
function linearize(c: number): number {
  const n = c / 255;
  return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (m === null) throw new Error(`bad hex ${hex}`);
  const v = m[1];
  return (
    0.2126 * linearize(parseInt(v.slice(0, 2), 16)) +
    0.7152 * linearize(parseInt(v.slice(2, 4), 16)) +
    0.0722 * linearize(parseInt(v.slice(4, 6), 16))
  );
}
function contrast(a: string, b: string): number {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return (hi + 0.05) / (lo + 0.05);
}
