/**
 * GlassChrome — floating chrome wrapper (top bars, pill switchers, anything
 * that floats above content). #4420 Graphite Glass: the surface is drawn by
 * `<Material>` (the only BlurView owner), so this file holds no blur and no
 * colour literal of its own.
 *
 * Layers:
 *   Material — fill + blur per platform (Android solid, Reduce Transparency
 *              solid, web via `shouldUseRealBlur(windowWidth)` inside
 *              Material, iOS BlurView) + the material's rim and hairline.
 *   Tint     — optional caller override (`tintColor`, or `tint="pressed"`).
 *   Border   — optional caller override (`borderColor` / `highlightColor`).
 *   Shadow   — token shadow on the outer node (Android elevation stays 0).
 *
 * Every prop from before #4420 is kept. `material` is new (additive): it picks
 * the material directly; otherwise the legacy `intensity` maps onto one.
 */

import React from "react";
import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import {
  blurIntensity as blurIntensityTokens,
  color,
  radius as radiusTokens,
  shadow as shadowTokens,
} from "../../constants/designSystem";
import { Material } from "./Material";
import type { MaterialKind } from "./Material";

export type GlassChromeIntensity = keyof typeof blurIntensityTokens;
export type GlassChromeRadius = keyof typeof radiusTokens;
export type GlassChromeTint = "idle" | "pressed" | "backdrop";

export interface GlassChromeProps {
  children?: React.ReactNode;
  /** Legacy blur token; mapped onto a material when `material` is not set. Default `chrome`. */
  intensity?: GlassChromeIntensity;
  /** #4420: the material to draw. Wins over `intensity`. */
  material?: MaterialKind;
  /** Tint state. `pressed` lays the pressed wash over the material. */
  tint?: GlassChromeTint;
  /** Radius token. Default `full`. */
  radius?: GlassChromeRadius;
  /** Override tint colour (drawn over the material). */
  tintColor?: string;
  /** Override hairline border colour. */
  borderColor?: string;
  /** Override top-edge highlight colour. */
  highlightColor?: string;
  /** Drop shadow style — defaults to `shadow.liquid`. */
  shadow?: StyleProp<ViewStyle>;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /** Make every chrome layer fill a stretching parent row. Defaults to false. */
  fillHeight?: boolean;
}

const MATERIAL_FOR_INTENSITY: Record<GlassChromeIntensity, MaterialKind> = {
  badge: "onPhoto",
  chrome: "chrome",
  backdrop: "chrome",
  cardBase: "pane",
  cardElevated: "pane",
  modal: "sheet",
};

export const resolveGlassChromeMaterial = (
  material: MaterialKind | undefined,
  intensity: GlassChromeIntensity,
): MaterialKind => material ?? MATERIAL_FOR_INTENSITY[intensity];

export const GlassChrome: React.FC<GlassChromeProps> = ({
  children,
  intensity = "chrome",
  material,
  tint = "idle",
  radius = "full",
  tintColor,
  borderColor,
  highlightColor,
  shadow = shadowTokens.liquid,
  testID,
  style,
  fillHeight = false,
}) => {
  const borderRadius = radiusTokens[radius];
  const kind = resolveGlassChromeMaterial(material, intensity);
  const overlayTint = tintColor ?? (tint === "pressed" ? color.fill.pressed : null);

  return (
    <View testID={testID} style={[{ borderRadius }, shadow, fillHeight && styles.fillHeight, style]}>
      <Material kind={kind} radius={borderRadius} style={[styles.clip, fillHeight && styles.fillHeight]}>
        {overlayTint !== null ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: overlayTint }]} />
        ) : null}
        {highlightColor !== undefined ? (
          <View pointerEvents="none" style={[styles.topHighlight, { backgroundColor: highlightColor }]} />
        ) : null}
        {borderColor !== undefined ? (
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { borderRadius, borderColor, borderWidth: StyleSheet.hairlineWidth }]}
          />
        ) : null}
        <View style={[styles.content, fillHeight && styles.fillHeight]}>{children}</View>
      </Material>
    </View>
  );
};

const styles = StyleSheet.create({
  fillHeight: { flex: 1 },
  clip: {
    // ORCH-1190 — the surface MUST fill the outer View's cross size; on web a
    // child with no width collapses to min-content inside a centred parent.
    alignSelf: "stretch",
  },
  topHighlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  content: {
    position: "relative",
    // ORCH-1190 — fill the stretched surface so children measure full width.
    alignSelf: "stretch",
  },
});

export default GlassChrome;
