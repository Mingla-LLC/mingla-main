// issue #1023 wave 2 — the accent FILL behind white labels: a solid
// `palette.accent` view, or a 135° gradient when the theme carries a second
// colour. Only purchase buttons, the brand tile and ring, the theme chip, the
// sheet preview CTA and motion use a gradient; text accents stay the first
// colour. A gradient is one unit: `theme.color2` always belongs to the same
// level as `theme.color` (themeResolver).

import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import type { ResolvedTheme } from "./designTokens";
import { themeAccentFill, type ThemePalette } from "./themePalette";

export interface ThemeAccentFillProps {
  theme: ResolvedTheme;
  palette: ThemePalette;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  testID?: string;
}

const GRADIENT_START = { x: 0, y: 0 } as const;
const GRADIENT_END = { x: 1, y: 1 } as const;

export function ThemeAccentFill({
  theme,
  palette,
  style,
  children,
  testID,
}: ThemeAccentFillProps): React.ReactElement {
  const fill = themeAccentFill(theme, palette);
  if (fill.kind === "solid") {
    return (
      <View style={[style, { backgroundColor: fill.color }]} testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <LinearGradient
      colors={fill.colors}
      start={GRADIENT_START}
      end={GRADIENT_END}
      style={style}
      testID={testID}
    >
      {children}
    </LinearGradient>
  );
}

export interface ThemeAccentGradientLayerProps {
  theme: ResolvedTheme;
  palette: ThemePalette;
  /** The host's corner radius, so the layer follows its shape. */
  borderRadius?: number;
  testID?: string;
}

/**
 * The gradient as a background LAYER for an existing accent button: the host
 * keeps its own `backgroundColor: palette.accent`, shadow, press and disabled
 * styles, and renders this as its first child. Renders nothing for a solid
 * theme, so a solid page is byte-identical to before.
 */
export function ThemeAccentGradientLayer({
  theme,
  palette,
  borderRadius,
  testID,
}: ThemeAccentGradientLayerProps): React.ReactElement | null {
  const fill = themeAccentFill(theme, palette);
  if (fill.kind === "solid") return null;
  return (
    <LinearGradient
      colors={fill.colors}
      start={GRADIENT_START}
      end={GRADIENT_END}
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius }]}
      testID={testID}
    />
  );
}
