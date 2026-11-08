/**
 * issue #1023 wave 2 — the Theme sheet's colour swatches: 12 solids and 6
 * two-colour gradients from the approved design (motion reference, "Colour").
 * They replace #1022's 12 presets (decision D-3). Colours saved from the old
 * presets still render everywhere; in the picker they read as Custom.
 *
 * Pure module (no React, no React Native) so the set is unit-testable.
 *
 * Hex values are stored lower case, the form the database and the gradient
 * column ("#first,#second") use. Screen readers announce the name, never a hex.
 */

export interface ThemeSwatch {
  /** Seed hex, lower case. The RENDERED accent is derived from it. */
  hex: string;
  /** Human name, announced by screen readers ("Coral"). */
  name: string;
}

export interface ThemeGradientSwatch {
  /** First stop, lower case. Text accents and the page canvas use this one. */
  hex: string;
  /** Second stop, lower case. */
  hex2: string;
  /** Human name; the accessibility label is "<name> gradient". */
  name: string;
}

export const SOLID_SWATCHES: readonly ThemeSwatch[] = [
  { name: "Mingla orange", hex: "#eb7825" },
  { name: "Coral", hex: "#ff5a5f" },
  { name: "Rose", hex: "#e8508f" },
  { name: "Orchid", hex: "#c25cf0" },
  { name: "Violet", hex: "#7c5cff" },
  { name: "Indigo", hex: "#4f6bff" },
  { name: "Sky", hex: "#2da8ff" },
  { name: "Teal", hex: "#14b8a6" },
  { name: "Green", hex: "#22c55e" },
  { name: "Lime", hex: "#a3e635" },
  { name: "Gold", hex: "#f5b700" },
  { name: "Sand", hex: "#d9a066" },
] as const;

export const GRADIENT_SWATCHES: readonly ThemeGradientSwatch[] = [
  { name: "Sunset", hex: "#ff8a3b", hex2: "#ff2e63" },
  { name: "Berry", hex: "#e8508f", hex2: "#7c5cff" },
  { name: "Ocean", hex: "#2da8ff", hex2: "#14e0b0" },
  { name: "Citrus", hex: "#f5b700", hex2: "#ff5a1f" },
  { name: "Neon", hex: "#c25cf0", hex2: "#2dd4ff" },
  { name: "Lagoon", hex: "#22c55e", hex2: "#2da8ff" },
] as const;

/** The solid strip, kept under its old name for existing sweeps. */
export const THEME_PRESETS: readonly ThemeSwatch[] = SOLID_SWATCHES;

/**
 * The proven dark-page contrast ceiling for the FILL accent:
 * `contrastAdjustedForWhiteText` caps accent luminance at 0.183333. Small
 * accent text no longer depends on it (#1024: `themeTextAccent`).
 */
export const DARK_PAGE_CONTRAST_CEILING = 4.2624;

/** WCAG AA for normal text. */
export const WCAG_AA_NORMAL_TEXT = 4.5;

const lower = (hex: string | null | undefined): string =>
  (hex ?? "").trim().toLowerCase();

/** The solid swatch with this hex, case-insensitively, or null. */
export const presetForHex = (hex: string | null | undefined): ThemeSwatch | null => {
  const needle = lower(hex);
  return SOLID_SWATCHES.find((p) => p.hex === needle) ?? null;
};

/** The gradient swatch with exactly these two stops, or null. */
export const gradientSwatchFor = (
  hex: string | null | undefined,
  hex2: string | null | undefined,
): ThemeGradientSwatch | null => {
  const a = lower(hex);
  const b = lower(hex2);
  if (a.length === 0 || b.length === 0) return null;
  return GRADIENT_SWATCHES.find((g) => g.hex === a && g.hex2 === b) ?? null;
};
