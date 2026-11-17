/**
 * GlassCard — the Pane (#4420 Graphite Glass). Every card, list and table
 * container. Both variants draw `materials.pane` through `<Material>` (via
 * GlassChrome); `elevated` only adds the deeper shadow. Default radius is the
 * kit's card radius: web 24 (`xl`), phone 28 (`xxl`). Name, props and
 * `contentStyle` contract are unchanged (168 importers).
 */

import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { radius as radiusTokens, shadow as shadowTokens, space } from "../../constants/designSystem";

import { GlassChrome } from "./GlassChrome";
import type { GlassChromeRadius } from "./GlassChrome";

export type GlassCardVariant = "base" | "elevated";

export interface GlassCardProps {
  children?: React.ReactNode;
  variant?: GlassCardVariant;
  /** Radius token. Defaults to the card radius (web `xl` 24, phone `xxl` 28). */
  radius?: GlassCardRadius;
  /** Inner padding. Default `space[4]` (16). Pass `0` to render flush content. */
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
  /** Stretch the outer, clip and content layers to an equal-height row. */
  fillHeight?: boolean;
}

export type GlassCardRadius = GlassChromeRadius;

/** Kit card radius: web 24, phone 28. */
export const PANE_DEFAULT_RADIUS: GlassChromeRadius = Platform.OS === "web" ? "xl" : "xxl";

const VARIANT_SHADOW: Record<GlassCardVariant, ViewStyle> = {
  base: shadowTokens.pane,
  elevated: shadowTokens.menu,
};

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  variant = "base",
  radius,
  padding = space[4],
  testID,
  style,
  contentStyle,
  fillHeight = false,
}) => {
  const resolvedRadius: GlassChromeRadius = radius ?? PANE_DEFAULT_RADIUS;

  return (
    <GlassChrome
      material="pane"
      shadow={VARIANT_SHADOW[variant]}
      radius={resolvedRadius}
      testID={testID}
      fillHeight={fillHeight}
      style={[styles.card, { borderRadius: radiusTokens[resolvedRadius] }, style]}
    >
      {/* #1532 — the REAL parent of `children`. `contentStyle` lands here, so a
          card's `gap` / `flexDirection` / `alignItems` finally applies to the
          children instead of to a node with one out-of-flow sibling stack. */}
      {/* #3872 — flattened, never an array. On react-native-web a
          `StyleSheet.create` style compiles to a CSS class while a plain
          object becomes an inline style, and inline wins: `[{ padding },
          contentStyle]` zeroed every padding LONGHAND the caller set
          (`paddingHorizontal`, `paddingVertical`, `paddingTop`, …), so list
          rows and stat strips sat flush against the card edge on web. One
          flattened object resolves left-to-right on every platform. Native
          output is identical. Guarded by
          `issue_3872_promote_glasscard_padding.web.render.test.tsx`. */}
      <View
        style={StyleSheet.flatten([
          { padding },
          fillHeight && styles.fillHeight,
          contentStyle,
        ])}
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
  fillHeight: { flex: 1 },
});

export default GlassCard;
