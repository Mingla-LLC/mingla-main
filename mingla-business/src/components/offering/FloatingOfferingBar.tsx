/**
 * FloatingOfferingBar — ORCH-1117 [public offering page polish].
 *
 * The persistent bottom Buy bar for the buyer-web public offering pages
 * (event / trip / experience). Pinned `position:absolute` above the scroll
 * content; the page reserves bottom clearance so the last element clears it.
 *
 * The bar's label / tappability / reason are a PURE PROJECTION of the shared
 * `resolveOfferingCta` (`@mingla/offering-rendering`) — the SAME state machine the
 * inline ticket row reads. This component renders the resolved `CtaState`; it
 * does NOT compute buy-state itself (one owner).
 *
 * Two top-level shapes:
 *   - tappable (buy / free / waitlist) → accent action button (Constitution #1
 *     no dead taps: the press fires `onPress`).
 *   - unavailable → NON-tappable info strip, `accessibilityRole="text"`, NO
 *     onPress (the bar is informational only — never a dead Buy button).
 *
 * Android opaque-glass fallback (ANDROID_GLASS_USES_OPAQUE_FALLBACK): a SOLID
 * ≥0.92 fill via Platform.select, clipped overflow, NO Android shadow — so a
 * buyer never sees scroll text ghosting through the price.
 *
 * Anon-tolerant: no useAuth, no data fetch. Pure presentational.
 */

import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import type { CtaState } from "@mingla/offering-rendering";
import {
  radius as radiusTokens,
  color,
  space,
  type,
  materials,
} from "../../constants/designSystem";

export interface FloatingOfferingBarProps {
  cta: CtaState;
  /** Fired ONLY for tappable states (buy / free / waitlist). */
  onPress: () => void;
  /**
   * Surface tone. Trip/experience pages are fixed-dark; the event page is
   * theme-driven and passes "light" when its resolved palette is a light page.
   */
  surface?: "dark" | "light";
  testID?: string;
}

const DARK = {
  fill: materials.pane.solidFill,
  fillAndroid: color.canvas,
  border: color.lineStrong,
  primary: color.text1,
  tertiary: color.text3,
  strip: color.fill.tile,
  stripTitle: color.text2,
} as const;

// #4420 — the light (paper) surface reads the paper/ink tokens.
const LIGHT = {
  fill: color.paper,
  fillAndroid: color.paperEnd,
  border: color.spinnerTrackOnPaper,
  primary: color.ink,
  tertiary: color.text4,
  strip: color.paperEnd,
  stripTitle: color.text4,
} as const;

const ACCENT = color.accent;

export const FloatingOfferingBar: React.FC<FloatingOfferingBarProps> = ({
  cta,
  onPress,
  surface = "dark",
  testID,
}) => {
  const insets = useSafeAreaInsets();
  const tone = surface === "light" ? LIGHT : DARK;

  // Solid ≥0.92 fill on Android (no rgba bleed), clipped, no shadow.
  const fill =
    Platform.OS === "android" ? tone.fillAndroid : tone.fill;
  const elevation = Platform.OS === "android" ? 0 : undefined;

  const handlePress = (): void => {
    if (!cta.tappable) return;
    if (Platform.OS !== "web") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
        () => {},
      );
    }
    onPress();
  };

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      <View
        style={[
          styles.bar,
          {
            backgroundColor: fill,
            borderTopColor: tone.border,
            paddingBottom: insets.bottom + space[2],
            ...(elevation !== undefined
              ? { elevation, shadowOpacity: 0 }
              : {}),
          },
        ]}
        testID={testID}
      >
        <View style={styles.inner}>
          {cta.tappable ? (
            <>
              {cta.kind === "buy" ? (
                <View style={styles.priceCol}>
                  <Text style={[styles.priceValue, { color: tone.primary }]}>
                    {cta.price}
                  </Text>
                </View>
              ) : null}
              <Pressable
                onPress={handlePress}
                accessibilityRole="button"
                accessibilityLabel={
                  cta.kind === "buy" && cta.price.length > 0
                    ? `${cta.label}, ${cta.price}`
                    : cta.label
                }
                style={({ pressed }) => [
                  styles.button,
                  // ORCH-1128 — no price slot (free / waitlist) → the sole CTA
                  // spans the full bar width instead of hugging content on the
                  // right of an empty flex:1 column. Paid "buy" keeps the
                  // price-left / button-right split (no buttonFull).
                  cta.kind !== "buy" && styles.buttonFull,
                  pressed && styles.buttonPressed,
                ]}
                testID={
                  testID !== undefined ? `${testID}-action` : undefined
                }
              >
                <Text style={styles.buttonLabel}>{cta.label}</Text>
              </Pressable>
            </>
          ) : (
            // Unavailable — NON-tappable info strip. accessibilityRole "text"
            // (NOT "button"): screen readers must not offer "double-tap to
            // activate" a dead control. No onPress anywhere on this branch.
            <View
              style={[styles.strip, { backgroundColor: tone.strip }]}
              accessibilityRole="text"
              accessibilityLabel={
                cta.subline !== null
                  ? `${cta.title}. ${cta.subline}`
                  : cta.title
              }
              testID={
                testID !== undefined ? `${testID}-unavailable` : undefined
              }
            >
              <Text style={[styles.stripGlyph, { color: tone.tertiary }]}>
                ⓘ
              </Text>
              <View style={styles.stripTextCol}>
                <Text
                  style={[styles.stripTitle, { color: tone.stripTitle }]}
                >
                  {cta.title}
                </Text>
                {cta.subline !== null ? (
                  <Text
                    style={[styles.stripSubline, { color: tone.tertiary }]}
                  >
                    {cta.subline}
                  </Text>
                ) : null}
              </View>
            </View>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 6,
  },
  bar: {
    overflow: "hidden",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space[4],
    paddingTop: space[4],
    // iOS/web upward shadow (Android suppressed inline — opaque-fill rule).
    shadowColor: color.mask,
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
  },
  inner: {
    maxWidth: 660,
    width: "100%",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
  },
  priceCol: {
    flex: 1,
    justifyContent: "center",
  },
  priceValue: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "900",
  },
  button: {
    minHeight: 56,
    paddingHorizontal: space[6],
    borderRadius: radiusTokens.lg,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: space[4],
  },
  // ORCH-1128 — full-width sole CTA (free / waitlist): fill the bar, drop the
  // left margin that only exists to separate the button from the price column.
  buttonFull: {
    flex: 1,
    marginLeft: 0,
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  buttonLabel: {
    fontSize: 17,
    fontWeight: "900",
    color: color.text1,
  },
  strip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderRadius: radiusTokens.lg,
    gap: space[2],
  },
  stripGlyph: {
    fontSize: 18,
    fontWeight: "700",
  },
  stripTextCol: {
    flex: 1,
  },
  stripTitle: {
    fontSize: type.small.fontSize,
    fontWeight: "700",
  },
  stripSubline: {
    fontSize: type.caption.fontSize,
    marginTop: 2,
  },
});

export default FloatingOfferingBar;
