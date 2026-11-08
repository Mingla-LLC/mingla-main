// issue #1023 — style helpers that draw the theme's ACCENT as the gradient
// when the theme has one (Seth: "every single element should follow the
// gradient if a gradient is chosen"), and exactly as before when it is solid.
//
// They read the gradient registered on the palette by createThemePalette, so
// a site that only has the palette can paint it. Accent TEXT is not a fill:
// it stays the first colour (with the #1024 small-text lightening) everywhere.
//
// Rendering:
//   - fills: `experimental_backgroundImage` on native (React Native 0.81, New
//     Architecture, iOS and Android) and CSS `backgroundImage` on web, over the
//     first-colour `backgroundColor` (which stays as the fallback);
//   - an accent border on an accent-filled element turns transparent, so the
//     gradient runs edge to edge;
//   - a border-only outline: on web the gradient is drawn with the
//     padding-box/border-box background technique over the element's opaque
//     fill; React Native has no gradient border, so native outlines keep the
//     first colour (a wrapper per element would change every layout).
//
// No new native modules.

import { Platform } from "react-native";

import { boldFontFamily, paletteAccentGradient, type ThemePalette } from "./themePalette";
import type { ResolvedTheme } from "./designTokens";

const IS_WEB = Platform.OS === "web";
const IS_ANDROID = Platform.OS === "android";

/**
 * issue #1023 — the style for text drawn in a theme font key (a Google
 * `GF_<family>_500/_700` key or a bundled theme face). The key already names
 * the face. On Android, expo-font registers a loaded face for the NORMAL style
 * only, and React Native maps fontWeight >= 700 to the BOLD style, finds
 * nothing under the key and falls back to the system font (Roboto Bold). So
 * Android also gets `fontWeight: "normal"`, which must come after the
 * StyleSheet weight. iOS and web keep the stylesheet weight (web needs it to
 * pick the weight of a variable font file).
 */
export const themeFontFace = (
  fontFamily: string,
): { fontFamily: string; fontWeight?: "normal" } =>
  IS_ANDROID ? { fontFamily, fontWeight: "normal" } : { fontFamily };

/** The theme's bold face (`boldFontFamily`) as a text style; see themeFontFace. */
export const themeBoldFace = (
  theme: ResolvedTheme,
): { fontFamily: string; fontWeight?: "normal" } => themeFontFace(boldFontFamily(theme));

const linear = (stops: readonly [string, string]): string =>
  `linear-gradient(135deg, ${stops[0]} 0%, ${stops[1]} 100%)`;

type GradientImage = { backgroundImage?: string; experimental_backgroundImage?: string };

/**
 * The accent FILL. Solid: `{ backgroundColor: palette.accent }`, exactly as
 * before. Gradient: the same backgroundColor plus the gradient image.
 */
export const accentFill = (
  palette: ThemePalette,
): { backgroundColor: string } & GradientImage => {
  const stops = paletteAccentGradient(palette);
  if (stops === null) return { backgroundColor: palette.accent };
  return IS_WEB
    ? { backgroundColor: palette.accent, backgroundImage: linear(stops) }
    : { backgroundColor: palette.accent, experimental_backgroundImage: linear(stops) };
};

/**
 * The border colour of an element that is ALSO accent-filled when this state
 * is active (a selected chip): transparent for a gradient so the fill runs
 * edge to edge, the first colour otherwise.
 */
export const accentEdgeOnFill = (palette: ThemePalette): string =>
  paletteAccentGradient(palette) === null ? palette.accent : "transparent";

/**
 * An accent fill whose element also draws an accent border (a selected chip
 * or tile). Gradient: the border turns transparent so the fill runs edge to
 * edge.
 */
export const accentFillWithBorder = (
  palette: ThemePalette,
): { backgroundColor: string; borderColor: string } & GradientImage => ({
  ...accentFill(palette),
  borderColor: accentEdgeOnFill(palette),
});

/**
 * An accent OUTLINE (border only). `background` is the element's own fill
 * (kept), `opaqueBackground` the opaque colour it reads as over the page.
 * Web + gradient: a gradient border drawn with the padding-box/border-box
 * technique. Solid, or native: `borderColor: palette.accent` as before.
 */
export const accentOutline = (
  palette: ThemePalette,
  fills: { background?: string; opaqueBackground: string },
): {
  borderColor: string;
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundOrigin?: "border-box";
} => {
  const stops = paletteAccentGradient(palette);
  const out: {
    borderColor: string;
    backgroundColor?: string;
    backgroundImage?: string;
    backgroundOrigin?: "border-box";
  } = { borderColor: palette.accent };
  if (fills.background !== undefined) out.backgroundColor = fills.background;
  if (stops !== null && IS_WEB) {
    const op = fills.opaqueBackground;
    out.borderColor = "transparent";
    out.backgroundImage = `linear-gradient(${op}, ${op}) padding-box, ${linear(stops)} border-box`;
    out.backgroundOrigin = "border-box";
  }
  return out;
};

/**
 * Props for an accent ICON drawn by ./LucideIcons: `color` always (solid and
 * fallback), plus `gradient` (the two stops) when the theme has one.
 */
export const accentIcon = (
  palette: ThemePalette,
): { color: string; gradient?: readonly [string, string] } => {
  const stops = paletteAccentGradient(palette);
  return stops === null ? { color: palette.accent } : { color: palette.accent, gradient: stops };
};
