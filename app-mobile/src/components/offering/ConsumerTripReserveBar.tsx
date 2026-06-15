/**
 * ConsumerTripReserveBar — ORCH-1138 Leg 1C (Seth's explicit floating-bar ask).
 *
 * The consumer-app floating Reserve bar for the trip detail, built to MATCH the
 * business/web public trip page's `TripReserveBar` EXACTLY (DIRECTION_A_V2
 * `.floating` / `.reserve`): a brand-accent button pinned to the bottom of the
 * sheet, kicker + price on the left, "Reserve my spot →" on the right,
 * safe-area-inset bottom, sold-out / closed / unavailable → a non-tappable
 * disabled strip.
 *
 * WHY a consumer-local component (not the business TripReserveBar): TripReserveBar
 * is `mingla-business/src/`-local and cannot be imported across the app boundary
 * (I-MOR-0827-PACKAGE-ISOLATION, F-6). This is the consumer mirror around the SAME
 * shared `CtaState` (one buy-state shape) + the SAME `ThemePalette`.
 *
 * 🔒 RENDERED AS AN ABSOLUTE OVERLAY (SPEC §4.5): the bar is `position:"absolute"
 * bottom:0` so it FLOATS over the scrolling content INSIDE the ParallaxCoverShell
 * body host — NOT BaseBottomSheet's `stickyFooter` prop (which would nest the
 * gorhom scroll one BottomSheetView level deeper and re-trigger the ORCH-1016/1043
 * viewport==content scroll-freeze). The shell keeps gorhom's BottomSheetScrollView
 * as its single registered scrollable; this bar is a sibling that does not touch
 * the scroll. `contentBottomInset` on the shell reserves clearance so the last row
 * clears the bar.
 *
 * Constitution #1 (no dead taps): the press fires only for tappable states; the
 * unavailable branch has NO onPress and `accessibilityRole="text"`.
 * Anon-tolerant: pure presentational; the screen owns the state + checkout.
 */

import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import type { CtaState, ThemePalette } from "@mingla/event-rendering";

export interface ConsumerTripReserveBarProps {
  cta: CtaState;
  palette: ThemePalette;
  /** Small line above the price ("All-in, taxes included" / "Due today · deposit"). */
  kicker: string | null;
  /** Bold (700-weight) loaded family for the price + CTA (native bold). */
  fontFamily?: string;
  /** Fired ONLY for tappable states (buy / free / waitlist). */
  onPress: () => void;
  testID?: string;
}

export const ConsumerTripReserveBar: React.FC<ConsumerTripReserveBarProps> = ({
  cta,
  palette,
  kicker,
  fontFamily,
  onPress,
  testID,
}) => {
  const insets = useSafeAreaInsets();
  const fontStyle = fontFamily !== undefined ? { fontFamily } : null;

  const handlePress = (): void => {
    if (!cta.tappable) return;
    if (Platform.OS !== "web") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
        () => {},
      );
    }
    onPress();
  };

  const fadeColor = palette.page;
  const tappable = cta.tappable;
  const price = cta.kind === "buy" ? cta.price : "";
  const unavailableTitle = cta.kind === "unavailable" ? cta.title : "";
  const unavailableSub = cta.kind === "unavailable" ? cta.subline : null;

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      <View
        style={[
          styles.fade,
          { backgroundColor: fadeColor, paddingBottom: 14 + insets.bottom },
        ]}
      >
        {tappable ? (
          <Pressable
            onPress={handlePress}
            accessibilityRole="button"
            accessibilityLabel={
              cta.kind === "buy" && price.length > 0
                ? `${cta.label}, ${price}`
                : cta.label
            }
            style={({ pressed }) => [
              styles.reserve,
              { backgroundColor: palette.accent },
              pressed ? styles.reservePressed : null,
            ]}
            testID={testID !== undefined ? `${testID}-action` : undefined}
          >
            {kicker !== null || price.length > 0 ? (
              <View style={styles.rLeft}>
                {kicker !== null ? (
                  <Text style={[styles.rKicker, { color: palette.accentText }]}>
                    {kicker}
                  </Text>
                ) : null}
                {price.length > 0 ? (
                  <Text
                    style={[styles.rPrice, { color: palette.accentText }, fontStyle]}
                  >
                    {price}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <Text style={[styles.rCta, { color: palette.accentText }, fontStyle]}>
              {cta.label} →
            </Text>
          </Pressable>
        ) : (
          // Non-tappable info strip — NO onPress, role "text" (no dead Reserve).
          <View
            style={[
              styles.reserveDisabled,
              {
                backgroundColor: palette.panelStrong,
                borderColor: palette.panelBorder,
              },
            ]}
            accessibilityRole="text"
            accessibilityLabel={
              unavailableSub !== null
                ? `${unavailableTitle}. ${unavailableSub}`
                : unavailableTitle
            }
            testID={testID !== undefined ? `${testID}-unavailable` : undefined}
          >
            <Text style={[styles.disabledTitle, { color: palette.tertiaryText }]}>
              {unavailableTitle}
            </Text>
            {unavailableSub !== null ? (
              <Text style={[styles.disabledSub, { color: palette.tertiaryText }]}>
                {unavailableSub}
              </Text>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // 🔒 ABSOLUTE overlay pinned to the bottom of the shell body (mirror
  // TripReserveBar.styles.wrapper). zIndex above the scroll content, below the
  // chrome (CHROME_Z=70 in ParallaxCoverShell).
  wrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 6,
  },
  fade: {
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  reserve: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    width: "100%",
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingVertical: 16,
    minHeight: 56,
    // iOS/web glow; Android suppressed — opaque accent fill, no shadow under the
    // rounded fill per ANDROID_GLASS_USES_OPAQUE_FALLBACK.
    ...Platform.select({
      android: { elevation: 0, shadowOpacity: 0 },
      default: {
        shadowColor: "#000000",
        shadowOpacity: 0.22,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
      },
    }),
  },
  reservePressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  rLeft: {
    alignItems: "flex-start",
  },
  rKicker: {
    fontSize: 11,
    fontWeight: "700",
    opacity: 0.85,
  },
  rPrice: {
    fontSize: 19,
    fontWeight: "900",
    letterSpacing: -0.3,
    marginTop: 1,
  },
  rCta: {
    fontSize: 16,
    fontWeight: "900",
  },
  reserveDisabled: {
    width: "100%",
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 16,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  disabledTitle: {
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
  },
  disabledSub: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 2,
  },
});

export default ConsumerTripReserveBar;
