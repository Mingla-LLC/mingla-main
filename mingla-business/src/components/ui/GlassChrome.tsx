/**
 * GlassChrome — 5-layer floating glass wrapper for chrome surfaces
 * (top bars, bottom navs, pill switchers, anything that floats above
 * content with chrome material).
 *
 * Layer stack:
 *   L1 — BlurView base (`expo-blur`). Native: real backdrop blur.
 *        Web: `backdrop-filter: blur(N) saturate(140%)` via expo-blur's
 *        web shim. Web fallback (no `backdrop-filter` support): solid
 *        `rgba(20,22,26,0.92)` View, no blur — visible degradation,
 *        never `return null` (Invariant I-7).
 *   L2 — Tint floor: translucent fill on top of L1 to neutralise
 *        content seeping through.
 *   L3 — Top edge highlight: 1px line on the top edge — the polished
 *        "glass" sparkle.
 *   L4 — Hairline border: `StyleSheet.hairlineWidth` perimeter.
 *   L5 — Drop shadow (token-driven, applied to the outer container).
 */

import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { BlurView } from "expo-blur";

import {
  blurIntensity as blurIntensityTokens,
  glass,
  radius as radiusTokens,
  shadows,
} from "../../constants/designSystem";

export type GlassChromeIntensity = keyof typeof blurIntensityTokens;
export type GlassChromeRadius = keyof typeof radiusTokens;
export type GlassChromeTint = "idle" | "pressed" | "backdrop";

export interface GlassChromeProps {
  children?: React.ReactNode;
  /** Blur intensity token (`badge | chrome | backdrop | cardBase | cardElevated | modal`). Default `chrome`. */
  intensity?: GlassChromeIntensity;
  /** Tint state. `idle` and `pressed` map to chrome tints; `backdrop` uses `glass.tint.backdrop`. */
  tint?: GlassChromeTint;
  /** Radius token. Default `full`. */
  radius?: GlassChromeRadius;
  /** Override tint colour. */
  tintColor?: string;
  /** Override border colour. */
  borderColor?: string;
  /** Override top-edge highlight colour. */
  highlightColor?: string;
  /** Drop shadow style — defaults to `shadows.glassChrome`. */
  shadow?: StyleProp<ViewStyle>;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Detected once at module scope. `true` when the host browser supports
 * `backdrop-filter` so we can rely on `<BlurView>`'s web shim. On unsupported
 * browsers we render a solid-rgba fallback (visible degradation, no null).
 */
const supportsBackdropFilter: boolean =
  Platform.OS === "web" &&
  typeof globalThis !== "undefined" &&
  typeof (globalThis as { CSS?: { supports?: (prop: string, value: string) => boolean } }).CSS?.supports === "function" &&
  ((globalThis as { CSS?: { supports?: (prop: string, value: string) => boolean } }).CSS!.supports!("backdrop-filter", "blur(10px)") ||
    (globalThis as { CSS?: { supports?: (prop: string, value: string) => boolean } }).CSS!.supports!("-webkit-backdrop-filter", "blur(10px)"));

const FALLBACK_BACKGROUND = "rgba(20, 22, 26, 0.92)";

const TINT_COLOUR: Record<GlassChromeTint, string> = {
  idle: glass.tint.chrome.idle,
  pressed: glass.tint.chrome.pressed,
  backdrop: glass.tint.backdrop,
};

// iOS uses real UIVisualEffectView blur. Web uses CSS backdrop-filter when
// supported. Android's expo-blur backdrop is too thin to read against busy
// content (renders near-transparent), so we route Android to the same solid
// fallback the web path uses when backdrop-filter is unavailable.
const shouldUseRealBlur = (): boolean => {
  if (Platform.OS === "ios") return true;
  if (Platform.OS === "android") return false;
  return supportsBackdropFilter;
};

export const GlassChrome: React.FC<GlassChromeProps> = ({
  children,
  intensity = "chrome",
  tint = "idle",
  radius = "full",
  tintColor,
  borderColor = glass.border.chrome,
  highlightColor = glass.highlight.profileBase,
  shadow = shadows.glassChrome,
  testID,
  style,
}) => {
  const intensityValue = blurIntensityTokens[intensity];
  const borderRadius = radiusTokens[radius];
  const resolvedTint = tintColor ?? TINT_COLOUR[tint];
  const blurOk = shouldUseRealBlur();

  return (
    <View
      testID={testID}
      style={[
        { borderRadius },
        shadow,
        style,
      ]}
    >
      <View style={[styles.clip, { borderRadius }]}>
        {/* L1 — Blur base */}
        {blurOk ? (
          <BlurView
            intensity={intensityValue}
            tint="dark"
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: FALLBACK_BACKGROUND }]}
          />
        )}
        {/* L2 — Tint floor */}
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: resolvedTint }]}
        />
        {/* L3 — Top edge highlight */}
        <View
          style={[
            styles.topHighlight,
            { backgroundColor: highlightColor },
          ]}
        />
        {/* L4 — Hairline border */}
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius,
              borderColor,
              borderWidth: StyleSheet.hairlineWidth,
            },
          ]}
          pointerEvents="none"
        />
        {/* Content */}
        <View style={styles.content}>{children}</View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  clip: {
    overflow: "hidden",
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
  },
});

export default GlassChrome;
