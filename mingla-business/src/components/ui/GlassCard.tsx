/**
 * GlassCard — content-area card with the 5-layer glass stack.
 *
 * Two variants:
 *   - `base`     — intensity 30, profile-base tint/border/highlight,
 *                  shadow `glassCardBase`, default radius `lg` (16).
 *   - `elevated` — intensity 34, profile-elevated tokens, shadow
 *                  `glassCardElevated`, default radius `xl` (24).
 *
 * Internally composes `GlassChrome` (which encapsulates the L1–L4 stack)
 * and applies the variant-specific overrides + the variant-specific shadow.
 */

import React from "react";
import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import {
  blurIntensity as blurIntensityTokens,
  glass,
  radius as radiusTokens,
  shadows,
  spacing,
} from "../../constants/designSystem";

import { GlassChrome } from "./GlassChrome";
import type { GlassChromeRadius } from "./GlassChrome";

export type GlassCardVariant = "base" | "elevated";

export interface GlassCardProps {
  children?: React.ReactNode;
  variant?: GlassCardVariant;
  /** Radius token. Defaults to `lg` for `base`, `xl` for `elevated`. */
  radius?: GlassCardRadius;
  /** Inner padding. Default `spacing.md` (16). Pass `0` to render flush content. */
  padding?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export type GlassCardRadius = GlassChromeRadius;

interface VariantTokens {
  intensity: keyof typeof blurIntensityTokens;
  tint: string;
  border: string;
  highlight: string;
  shadow: ViewStyle;
  defaultRadius: GlassChromeRadius;
}

const VARIANT_TOKENS: Record<GlassCardVariant, VariantTokens> = {
  base: {
    intensity: "cardBase",
    tint: glass.tint.profileBase,
    border: glass.border.profileBase,
    highlight: glass.highlight.profileBase,
    shadow: shadows.glassCardBase,
    defaultRadius: "lg",
  },
  elevated: {
    intensity: "cardElevated",
    tint: glass.tint.profileElevated,
    border: glass.border.profileElevated,
    highlight: glass.highlight.profileElevated,
    shadow: shadows.glassCardElevated,
    defaultRadius: "xl",
  },
};

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  variant = "base",
  radius,
  padding = spacing.md,
  testID,
  style,
}) => {
  const tokens = VARIANT_TOKENS[variant];
  const resolvedRadius: GlassChromeRadius = radius ?? tokens.defaultRadius;

  return (
    <GlassChrome
      intensity={tokens.intensity}
      tintColor={tokens.tint}
      borderColor={tokens.border}
      highlightColor={tokens.highlight}
      shadow={tokens.shadow}
      radius={resolvedRadius}
      testID={testID}
      style={[styles.card, { borderRadius: radiusTokens[resolvedRadius] }, style]}
    >
      <View style={{ padding }}>{children}</View>
    </GlassChrome>
  );
};

const styles = StyleSheet.create({
  card: {
    overflow: "visible",
  },
});

export default GlassCard;
