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
  /**
   * CHROME node style — border radius, shadow, outer width/margin.
   *
   * #1532: this lands on `GlassChrome`'s OUTER node, whose ONLY in-flow child
   * is the clip view (L1–L4 are `StyleSheet.absoluteFill`, i.e. out of flow).
   * So any style here that needs to reach the CHILDREN — `gap`,
   * `flexDirection`, `alignItems`, `justifyContent`, `rowGap`, `columnGap`,
   * `flexWrap` — is a SILENT NO-OP: a gap with one child spaces nothing.
   *
   * That footgun has now shipped TWICE (#1484 `flexDirection`, #1532 `gap` on
   * every card in the Stay manager). Pass those keys through `contentStyle`
   * instead. `stayGlassCardContentKeys.issue1532.test.ts` fails CI if a Stay
   * call site puts a content-node layout key back on `style`.
   */
  style?: StyleProp<ViewStyle>;
  /**
   * CONTENT node style — lands on the padding `View` that actually PARENTS
   * `children`. This is the only place `gap` / `flexDirection` / `alignItems`
   * / `justifyContent` / `rowGap` / `columnGap` / `flexWrap` can do anything.
   */
  contentStyle?: StyleProp<ViewStyle>;
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
  contentStyle,
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
      {/* #1532 — the REAL parent of `children`. `contentStyle` lands here, so a
          card's `gap` / `flexDirection` / `alignItems` finally applies to the
          children instead of to a node with one out-of-flow sibling stack. */}
      <View
        style={[{ padding }, contentStyle]}
        testID={testID !== undefined ? `${testID}-content` : undefined}
      >
        {children}
      </View>
    </GlassChrome>
  );
};

const styles = StyleSheet.create({
  card: {
    overflow: "visible",
  },
});

export default GlassCard;
