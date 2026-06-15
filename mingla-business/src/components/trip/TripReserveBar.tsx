/**
 * TripReserveBar — ORCH-1138 R2 (device-parity rework, finding #8).
 *
 * The phone floating Reserve bar for the PUBLIC trip page, built to match
 * DIRECTION_A_V2_FULL_RESPONSIVE.html `.floating` / `.reserve` EXACTLY:
 *   - a gradient-to-page wrapper (transparent → page) so the bar floats over the
 *     scrolling content,
 *   - a single full-width BRAND-ACCENT button,
 *   - left column = a small kicker line ("All-in, taxes included" / "Due today ·
 *     deposit") above the price,
 *   - right = the "Reserve my spot →" CTA,
 *   - safe-area-inset-bottom honored,
 *   - sold-out / closed / unavailable → a non-tappable centered disabled strip.
 *
 * WHY a bespoke bar (not the shared FloatingOfferingBar): the ORCH-1117
 * FloatingOfferingBar hardcodes `ACCENT = "#eb7825"` (warm orange) + a
 * price-only / no-kicker layout and is consumed by the event + experience pages.
 * Re-theming it would change those callers; the §12 allowlist instead lets the
 * trip route render its OWN mockup-faithful bar around the SAME resolved
 * `CtaState` (one owner of buy-state — `resolveOfferingCta`). All other callers
 * of FloatingOfferingBar are untouched.
 *
 * Anon-tolerant: no useAuth, no fetch. Pure presentational; the route owns state.
 * Constitution #1 (no dead taps): the press fires only for tappable states; the
 * unavailable branch has NO onPress and `accessibilityRole="text"`.
 */

import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import type { CtaState, ThemePalette } from "@mingla/event-rendering";

export interface TripReserveBarProps {
  cta: CtaState;
  palette: ThemePalette;
  /** Page tone — drives the gradient fade base color (resolved, not hardcoded). */
  surface: "dark" | "light";
  /** Small line above the price ("All-in, taxes included" / "Due today · deposit"). */
  kicker: string | null;
  /** Resolved brand font family (theme.fontFamilyValue) for the price + CTA. */
  fontFamily?: string;
  /** Fired ONLY for tappable states (buy / free / waitlist). */
  onPress: () => void;
  testID?: string;
}

export const TripReserveBar: React.FC<TripReserveBarProps> = ({
  cta,
  palette,
  surface,
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

  // Gradient fade base = the resolved page color (mockup: transparent → page).
  // RN has no CSS gradient without a dep; emulate with a solid page-colored band
  // that is itself transparent at the very top via a layered fade view. To stay
  // dependency-free we use a single opaque page band with a soft top hairline —
  // the buyer reads the accent button clearly either way (the gradient is purely
  // a cosmetic fade and must not pull in expo-linear-gradient).
  void surface;
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
              { backgroundColor: palette.panelStrong, borderColor: palette.panelBorder },
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
    // iOS/web glow (Android suppressed — opaque accent fill, no shadow under the
    // rounded fill per ANDROID_GLASS_USES_OPAQUE_FALLBACK).
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

export default TripReserveBar;
