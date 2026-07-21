import type { ThemeInput } from "@mingla/offering-rendering";

import {
  THEME_ANIMATION_SLUGS,
  THEME_FONT_SLUGS,
} from "../../../../packages/offering-rendering/designTokens";
import { createThemePalette } from "../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../packages/offering-rendering/themeResolver";
import { contrastRatio } from "../../utils/buttonAccentContrast";
import { themeAxisIsInherited } from "../../services/offeringTheme";

/**
 * #1022 — the Theme control's pure model layer.
 *
 * HSV <-> hex, hue naming, Nudge-to-AA, and the display vocabulary for the
 * value line and the font/motion tabs.
 *
 * PURE by contract: no React, no React Native. Everything here is unit-testable
 * under the node/ts-jest project, which is why the value-line grammar and the
 * resolveTheme argument order live here rather than inside the row component
 * (a .tsx importing react-native cannot be imported by those tests).
 *
 * COLOUR FORMATS: every value this module emits is `#RRGGBB`. The only
 * non-hex string the UI hands to React Native is the plane's base
 * `hsl(H,100%,50%)`, which is permitted (RN accepts hex/rgb/hsl/hwb only).
 * There is no hsv/oklch/lab/color-mix anywhere.
 */

// ─── HSV <-> hex ──────────────────────────────────────────────────────────

export interface Hsv {
  /** 0-360 */
  h: number;
  /** 0-1 */
  s: number;
  /** 0-1 */
  v: number;
}

const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n));

const toHexByte = (n: number): string =>
  clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");

export const hsvToHex = ({ h, s, v }: Hsv): string => {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 1);
  const val = clamp(v, 0, 1);
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  let rgb: [number, number, number];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return `#${rgb.map((ch) => toHexByte((ch + m) * 255)).join("")}`;
};

export const hexToHsv = (hex: string): Hsv | null => {
  const m = hex.trim().match(/^#([0-9a-fA-F]{6})$/);
  if (m === null) return null;
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
};

// ─── Hue naming (the 2D-plane accessibility answer) ───────────────────────

/**
 * A 12-name lexicon at 30 degree intervals. A screen reader announcing
 * "Hue, 28 degrees" is useless; "Hue, 28 degrees, orange" is not.
 */
const HUE_NAMES: readonly string[] = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "violet",
  "magenta",
];

export const hueName = ({ h, s, v }: Hsv): string => {
  if (v < 0.05) return "near-black";
  if (v > 0.95 && s < 0.05) return "near-white";
  if (s < 0.1) return "grey";
  const index = Math.round((((h % 360) + 360) % 360) / 30) % 12;
  return HUE_NAMES[index];
};

// ─── Nudge to AA ──────────────────────────────────────────────────────────

/** Accent-on-page contrast for a seed, through the REAL derivation chain. */
export const accentOnPageContrast = (
  seedHex: string,
  brandTheme: ThemeInput | null | undefined = null,
): number => {
  const palette = createThemePalette(
    resolveTheme(brandTheme ?? null, {
      color: seedHex,
      font: null,
      animation: null,
    }),
  );
  return contrastRatio(palette.accent, palette.page);
};

export type ContrastTier = "pass" | "warn" | "fail";

export const contrastTier = (ratio: number): ContrastTier =>
  ratio >= 4.5 ? "pass" : ratio >= 3 ? "warn" : "fail";

/**
 * Walk HSV **Value only** (hue and saturation preserved, so it still reads as
 * the colour the user chose) to the nearest point clearing 4.5:1.
 *
 * Returns null when no value along the axis clears it — which is the common
 * case on dark pages, where the palette caps accent luminance at 0.183333 and
 * the ceiling is 4.2624. Callers must treat null as "cannot be nudged" and
 * leave the colour untouched; a failing colour is NEVER blocked.
 */
export const nudgeToAA = (seedHex: string): string | null => {
  const start = hexToHsv(seedHex);
  if (start === null) return null;
  if (accentOnPageContrast(seedHex) >= 4.5) return seedHex;

  let best: { hex: string; ratio: number } | null = null;
  // Search both directions in 1% steps, preferring the smallest move.
  for (let step = 1; step <= 100; step += 1) {
    for (const direction of [1, -1]) {
      const v = clamp(start.v + (direction * step) / 100, 0, 1);
      const candidate = hsvToHex({ ...start, v });
      const ratio = accentOnPageContrast(candidate);
      if (ratio >= 4.5) return candidate;
      if (best === null || ratio > best.ratio) best = { hex: candidate, ratio };
    }
  }
  return null;
};

// ─── Display vocabulary ───────────────────────────────────────────────────

export const FONT_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  inter: "Inter",
  poppins: "Poppins",
  space_grotesk: "Space Grotesk",
  plus_jakarta_sans: "Plus Jakarta Sans",
  manrope: "Manrope",
  playfair_display: "Playfair Display",
  dm_serif_display: "DM Serif Display",
  fraunces: "Fraunces",
  lora: "Lora",
  bebas_neue: "Bebas Neue",
  anton: "Anton",
  unbounded: "Unbounded",
  caveat: "Caveat",
  dancing_script: "Dancing Script",
};

/** `none` is "No motion", NEVER "None". */
export const MOTION_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  none: "No motion",
  confetti: "Confetti",
  fireworks: "Fireworks",
  balloons: "Balloons",
  sparkles: "Sparkles",
  glitter_shower: "Glitter shower",
  snowfall: "Snowfall",
  falling_petals: "Falling petals",
  hearts: "Hearts",
  shimmer_reveal: "Shimmer reveal",
};

export const FONT_GROUPS: readonly {
  label: string;
  slugs: readonly string[];
}[] = [
  {
    label: "Sans serif",
    slugs: ["inter", "poppins", "space_grotesk", "plus_jakarta_sans", "manrope"],
  },
  {
    label: "Serif",
    slugs: ["playfair_display", "dm_serif_display", "fraunces", "lora"],
  },
  { label: "Display", slugs: ["bebas_neue", "anton", "unbounded"] },
  { label: "Handwriting", slugs: ["caveat", "dancing_script"] },
];

export const ALL_FONT_SLUGS = THEME_FONT_SLUGS;
export const ALL_ANIMATION_SLUGS = THEME_ANIMATION_SLUGS;

export type ThemeControlScope = "offering" | "brand";

/**
 * The collapsed row's value line, e.g. "Brand default · Poppins · Confetti".
 *
 * C-1 LIVES HERE. `resolveTheme(brandTheme, offeringOverride)` — the BRAND
 * theme occupies the FIRST slot. The shipped ThemeEditorSection called
 * `resolveTheme(value ?? null, null)`, putting the offering's own override in
 * the brand slot, so on the published-event editor an unthemed event previewed
 * Mingla's orange/Inter/None and marked those pills selected while the live
 * page rendered the brand's colour and font. The editor was actively lying
 * about inheritance.
 *
 * Per-axis inheritance is read from the RAW override via themeAxisIsInherited,
 * NEVER by comparing a resolved value — that comparison is exactly how the old
 * editor marked Inter/None falsely selected.
 */
export const themeValueLine = (
  value: ThemeInput | null | undefined,
  scope: ThemeControlScope,
  brandTheme: ThemeInput | null | undefined,
): string => {
  const resolved =
    scope === "brand"
      ? resolveTheme(value ?? null, null)
      : resolveTheme(brandTheme ?? null, value ?? null);

  const colourLabel = themeAxisIsInherited(value, "color")
    ? scope === "brand"
      ? "Mingla default"
      : "Brand default"
    : "Custom colour";

  const fontLabel = FONT_DISPLAY_NAMES[resolved.font] ?? resolved.font;
  const motionLabel =
    MOTION_DISPLAY_NAMES[resolved.animation] ?? resolved.animation;

  return `${colourLabel} · ${fontLabel} · ${motionLabel}`;
};
