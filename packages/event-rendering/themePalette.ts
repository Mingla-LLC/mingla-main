// themePalette — the single, shared brand-theming engine for ALL public
// offering pages (event / trip / experience / brand).
//
// ORCH-1138 A1 — `createThemePalette`, the `ThemePalette` type, the color-math
// helpers, and `resolveOfferingSurface` were EXTRACTED VERBATIM out of
// `PublicEventPage.tsx` (where they originated for the event page only) into
// this exported module so the trip page (and later legs: experience + brand)
// derive their accent/surface/text colors from the SAME algorithm. This is a
// BEHAVIOR-NEUTRAL relocation — every input yields a byte-identical
// `ThemePalette` to the pre-extraction code. Guarded by the RT-1 parity
// snapshot (createThemePalette.parity.orch1138.test.ts), which fails on any
// palette-algorithm drift.
//
// Pure: depends ONLY on `ResolvedTheme` (from ./designTokens). No app `src/`
// imports — preserves I-MOR-0827-PACKAGE-ISOLATION.

import {
  FONT_FAMILY_MAP,
  type ResolvedTheme,
  type ThemeFontSlug,
} from "./designTokens";

export type ThemePalette = {
  page: string;
  accent: string;
  accentText: string;
  primaryText: string;
  secondaryText: string;
  tertiaryText: string;
  panel: string;
  panelStrong: string;
  panelBorder: string;
  card: string;
  cutoutBorder: string;
  glass: string;
  glassTint: "dark" | "light";
  accentWash: string;
};

type Rgb = {
  r: number;
  g: number;
  b: number;
};

const FALLBACK_ACCENT_RGB: Rgb = { r: 235, g: 120, b: 37 };

const clampColorChannel = (value: number): number =>
  Math.min(255, Math.max(0, Math.round(value)));

const parseHexColor = (hex: string): Rgb => {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (match === null) return FALLBACK_ACCENT_RGB;
  const value = match[1];
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
};

const rgbToHex = ({ r, g, b }: Rgb): string =>
  `#${[r, g, b]
    .map((channel) => clampColorChannel(channel).toString(16).padStart(2, "0"))
    .join("")}`;

const mixHexColors = (from: string, to: string, amount: number): string => {
  const a = parseHexColor(from);
  const b = parseHexColor(to);
  const weight = Math.min(1, Math.max(0, amount));
  return rgbToHex({
    r: a.r + (b.r - a.r) * weight,
    g: a.g + (b.g - a.g) * weight,
    b: a.b + (b.b - a.b) * weight,
  });
};

const hexToRgba = (hex: string, alpha: number): string => {
  const { r, g, b } = parseHexColor(hex);
  return `rgba(${r},${g},${b},${alpha})`;
};

const linearizeSrgb = (channel: number): number => {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
};

const relativeLuminance = (hex: string): number => {
  const { r, g, b } = parseHexColor(hex);
  return (
    0.2126 * linearizeSrgb(r) +
    0.7152 * linearizeSrgb(g) +
    0.0722 * linearizeSrgb(b)
  );
};

const contrastRatio = (a: string, b: string): number => {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
};

const readableTextFor = (background: string): "#000000" | "#ffffff" =>
  contrastRatio("#000000", background) >= contrastRatio("#ffffff", background)
    ? "#000000"
    : "#ffffff";

const contrastAdjustedAccent = (
  accentColor: string,
  background: string,
  minimumRatio: number,
): string => {
  if (contrastRatio(accentColor, background) >= minimumRatio)
    return accentColor;
  const direction = readableTextFor(background);
  let adjusted = accentColor;
  for (let i = 0; i < 12; i++) {
    adjusted = mixHexColors(adjusted, direction, 0.16);
    if (contrastRatio(adjusted, background) >= minimumRatio) return adjusted;
  }
  return adjusted;
};

const contrastAdjustedForWhiteText = (
  accentColor: string,
  minimumRatio: number,
): string => {
  if (contrastRatio(accentColor, "#ffffff") >= minimumRatio) return accentColor;
  let adjusted = accentColor;
  for (let i = 0; i < 12; i++) {
    adjusted = mixHexColors(adjusted, "#000000", 0.14);
    if (contrastRatio(adjusted, "#ffffff") >= minimumRatio) return adjusted;
  }
  return adjusted;
};

export const createThemePalette = (theme: ResolvedTheme): ThemePalette => {
  const darkBase = "#07070a";
  const lightBase = "#f8fafc";
  const accentOnDark = contrastRatio(theme.color, darkBase);
  const accentOnLight = contrastRatio(theme.color, lightBase);
  const useDark =
    accentOnDark >= 3 && accentOnLight < 3
      ? true
      : accentOnLight >= 3 && accentOnDark < 3
        ? false
        : theme.foregroundColor === "#ffffff";
  const basePage = useDark ? darkBase : lightBase;
  const page = mixHexColors(basePage, theme.color, useDark ? 0.1 : 0.035);
  const accentColor = contrastAdjustedForWhiteText(
    contrastAdjustedAccent(theme.color, page, 3.15),
    4.5,
  );
  const primaryText = readableTextFor(page);
  return {
    page,
    accent: accentColor,
    accentText: "#ffffff",
    primaryText,
    secondaryText:
      primaryText === "#ffffff"
        ? "rgba(255,255,255,0.78)"
        : "rgba(16,20,31,0.76)",
    tertiaryText:
      primaryText === "#ffffff"
        ? "rgba(255,255,255,0.58)"
        : "rgba(16,20,31,0.58)",
    panel: useDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.76)",
    panelStrong: useDark ? "rgba(255,255,255,0.11)" : "rgba(255,255,255,0.92)",
    panelBorder: hexToRgba(accentColor, useDark ? 0.38 : 0.3),
    card: useDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.72)",
    cutoutBorder: useDark ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.96)",
    glass: useDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.62)",
    glassTint: useDark ? "dark" : "light",
    accentWash: hexToRgba(accentColor, useDark ? 0.24 : 0.18),
  };
};

// ORCH-1117 — surface tone (light vs dark page) for a host-mounted floating bar.
// Mirrors createThemePalette's `useDark` decision EXACTLY so the bar fill matches
// the page it sits over (a light brand theme → "light" near-white bar fill).
// ORCH-1138 A1 — moved here from PublicEventPage.tsx alongside createThemePalette
// (both pages need the light/dark surface tone); same name + signature.
export const resolveOfferingSurface = (
  theme: ResolvedTheme,
): "light" | "dark" => {
  const darkBase = "#07070a";
  const lightBase = "#f8fafc";
  const accentOnDark = contrastRatio(theme.color, darkBase);
  const accentOnLight = contrastRatio(theme.color, lightBase);
  const useDark =
    accentOnDark >= 3 && accentOnLight < 3
      ? true
      : accentOnLight >= 3 && accentOnDark < 3
        ? false
        : theme.foregroundColor === "#ffffff";
  return useDark ? "dark" : "light";
};

// ORCH-1138 A2 — surface theming helper. A memo-friendly derived RN style set so
// every offering primitive + page reads from ONE resolved palette and never a
// raw hex. Returned as plain objects (not StyleSheet.create) so callers can
// spread them into their own StyleSheet entries / inline merges.
export interface OfferingSurfaceStyles {
  page: { backgroundColor: string };
  card: { backgroundColor: string; borderColor: string; borderWidth: number };
  cardStrong: {
    backgroundColor: string;
    borderColor: string;
    borderWidth: number;
  };
  border: { borderColor: string };
  accentBorder: { borderColor: string };
  accentWash: { backgroundColor: string };
  primaryText: { color: string };
  secondaryText: { color: string };
  tertiaryText: { color: string };
  accentText: { color: string };
  danger: { color: string };
  dangerWash: { backgroundColor: string };
}

const DANGER = "#ef4444";
const DANGER_WASH = "rgba(239,68,68,0.14)";

export const offeringSurfaceStyles = (
  palette: ThemePalette,
): OfferingSurfaceStyles => ({
  page: { backgroundColor: palette.page },
  card: {
    backgroundColor: palette.card,
    borderColor: palette.panelBorder,
    borderWidth: 1,
  },
  cardStrong: {
    backgroundColor: palette.panelStrong,
    borderColor: palette.panelBorder,
    borderWidth: 1,
  },
  border: { borderColor: palette.panelBorder },
  accentBorder: { borderColor: palette.panelBorder },
  accentWash: { backgroundColor: palette.accentWash },
  primaryText: { color: palette.primaryText },
  secondaryText: { color: palette.secondaryText },
  tertiaryText: { color: palette.tertiaryText },
  accentText: { color: palette.accentText },
  danger: { color: DANGER },
  dangerWash: { backgroundColor: DANGER_WASH },
});

// =====================================================================
// ORCH-1138 Leg-1 (native-parity fix #2) — WEIGHT-AWARE theme font family.
//
// THE NATIVE TRAP: on iOS/Android a LOADED CUSTOM font does NOT respond to
// `fontWeight`. `FONT_FAMILY_MAP` loads exactly ONE non-bold variant per theme
// font (e.g. `Inter_500Medium`); a Text styled `{ fontFamily: "Inter_500Medium",
// fontWeight: "900" }` therefore renders at MEDIUM weight on native (react-native
// -web synthesizes bold from `font-weight`, so web looked correct — the reason
// this was a native-only divergence). To render bold on native you must point
// `fontFamily` at the weight-specific loaded family (`Inter_700Bold`).
//
// `FONT_FAMILY_BOLD_MAP` maps each slug → its 700-weight loaded family VALUE.
// Three display faces (`dm_serif_display`, `bebas_neue`, `anton`) ship NO bold
// variant in @expo-google-fonts (they are inherently heavy single-weight display
// faces); for those the base family IS the display weight, so bold falls back to
// `FONT_FAMILY_MAP[slug]` (no synthetic bold, no missing-font fallback). The
// family VALUES here are the on-demand load keys consumed by
// `THEME_FONT_MODULE_THUNKS` (mingla-business/src/theme/themeFonts.ts) +
// `useThemeFont` so the bold face is actually registered with expo-font before
// it is referenced.
export const FONT_FAMILY_BOLD_MAP: Record<ThemeFontSlug, string> = {
  inter: "Inter_700Bold",
  poppins: "Poppins_700Bold",
  space_grotesk: "SpaceGrotesk_700Bold",
  plus_jakarta_sans: "PlusJakartaSans_700Bold",
  manrope: "Manrope_700Bold",
  playfair_display: "PlayfairDisplay_700Bold",
  // No bold variant published — base IS the display weight.
  dm_serif_display: FONT_FAMILY_MAP.dm_serif_display,
  fraunces: "Fraunces_700Bold",
  lora: "Lora_700Bold",
  // No bold variant — Bebas Neue is a single heavy display weight.
  bebas_neue: FONT_FAMILY_MAP.bebas_neue,
  // No bold variant — Anton is a single heavy display weight.
  anton: FONT_FAMILY_MAP.anton,
  unbounded: "Unbounded_700Bold",
  caveat: "Caveat_700Bold",
  dancing_script: "DancingScript_700Bold",
};

/**
 * The bold (700-weight) loaded font-family VALUE for a resolved theme — the
 * family a native `<Text>` must set as `fontFamily` to actually render bold.
 * Falls back to the medium/base family for the 3 single-weight display faces.
 * Use this (NOT `fontWeight` alone) for every heavy/bold text on a themed page.
 */
export const boldFontFamily = (theme: ResolvedTheme): string =>
  FONT_FAMILY_BOLD_MAP[theme.font] ?? theme.fontFamilyValue;
