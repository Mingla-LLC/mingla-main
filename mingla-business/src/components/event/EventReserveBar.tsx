/**
 * EventReserveBar — ORCH-1138 Leg 2 (public EVENT page redesign).
 *
 * The phone ticket CTA for the PUBLIC event page, mirroring the SHIPPED trip leg's
 * `TripReserveBar` 1:1 — but EVENT-only (SINGLE CTA, NO split-CTA / "Pay over
 * time"). Events have no installment plan (OQ-1(b): a NEW component, not a
 * generalization of the trip bar — zero blast radius to the shipped trip leg).
 *
 * ── TWO render modes (float→dock single CTA, the sleek button language) ──
 *   • variant="docked"  — the CTA's RESTING position. Rendered as the FINAL element
 *     INSIDE the FoundationEventBody phone body, in NORMAL FLOW (NOT absolute), so
 *     it sits flush just beneath "Choose your ticket" with NO black void. Its
 *     bg/bar is allowed at rest; it pads its own bottom safe-area.
 *   • variant="floating" — shown ONLY WHILE the in-content docked button is scrolled
 *     OUT of view. JUST THE BUTTON — a COMPACT self-width pill with ONLY the CTA
 *     label ("Get tickets →"), NO kicker/price block, NO full-width opaque bar bg.
 *
 * WHY a bespoke EVENT bar (not the shared FloatingOfferingBar): the ORCH-1117
 * FloatingOfferingBar hardcodes a warm-orange accent + a price-only / no-kicker
 * layout. This bar renders the mockup-faithful Direction-A look around the SAME
 * resolved `CtaState` (one owner — resolveOfferingCta), so web + business + the
 * consumer ConsumerEventReserveBar read identically.
 *
 * Anon-tolerant: no useAuth, no fetch. Pure presentational; the route owns state.
 * Constitution #1 (no dead taps): the press fires only for tappable states; the
 * unavailable branch has NO onPress and `accessibilityRole="text"`.
 * Android: opaque accent fill, no shadow under the rounded fill
 * (ANDROID_GLASS_USES_OPAQUE_FALLBACK).
 */

import React from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import type { CtaState, ThemePalette } from "@mingla/event-rendering";

export interface EventReserveBarProps {
  cta: CtaState;
  palette: ThemePalette;
  /** Small line above the price ("All-in, taxes included"). null → no kicker. */
  kicker: string | null;
  /** Resolved brand BOLD font family for the price + CTA. */
  fontFamily?: string;
  /** Fired ONLY for tappable states (buy / free / waitlist). */
  onPress: () => void;
  /**
   * Render mode:
   *   "docked"   → in-flow card placed as the LAST body child (flush, no void).
   *   "floating" → absolute pill overlay shown while the docked button is off-screen.
   */
  variant: "docked" | "floating";
  /**
   * Fired ONLY for the docked variant: reports the docked CTA's layout (its
   * `y`/`height` within the scroll content) so the route can hide the floating
   * pill once the docked button scrolls in.
   */
  onDockLayout?: (event: LayoutChangeEvent) => void;
  testID?: string;
}

export const EventReserveBar: React.FC<EventReserveBarProps> = ({
  cta,
  palette,
  kicker,
  fontFamily,
  onPress,
  variant,
  onDockLayout,
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

  const tappable = cta.tappable;
  const price = cta.kind === "buy" ? cta.price : "";
  const unavailableTitle = cta.kind === "unavailable" ? cta.title : "";
  const unavailableSub = cta.kind === "unavailable" ? cta.subline : null;

  // The shared button/strip body — identical for both variants so the floating +
  // docked CTAs read identically (same accent fill, kicker, price, label).
  const ctaBody = tappable ? (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={
        cta.kind === "buy" && price.length > 0 ? `${cta.label}, ${price}` : cta.label
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
            <Text
              style={[styles.rKicker, { color: palette.accentText }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {kicker}
            </Text>
          ) : null}
          {price.length > 0 ? (
            <Text
              style={[styles.rPrice, { color: palette.accentText }, fontStyle]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {price}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Text style={[styles.rCta, { color: palette.accentText }, fontStyle]} numberOfLines={1}>
        {cta.label} →
      </Text>
    </Pressable>
  ) : (
    // Non-tappable info strip — NO onPress, role "text" (no dead CTA).
    <View
      style={[
        styles.reserveDisabled,
        { backgroundColor: palette.panelStrong, borderColor: palette.panelBorder },
      ]}
      accessibilityRole="text"
      accessibilityLabel={
        unavailableSub !== null ? `${unavailableTitle}. ${unavailableSub}` : unavailableTitle
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
  );

  // ── DOCKED — in-flow card, the CTA's resting position (flush, no void) ──
  if (variant === "docked") {
    return (
      <View
        style={[
          styles.dockedCard,
          { backgroundColor: palette.page, paddingBottom: insets.bottom + 8 },
        ]}
        onLayout={onDockLayout}
        testID={testID !== undefined ? `${testID}-docked` : undefined}
      >
        {ctaBody}
      </View>
    );
  }

  // ── FLOATING — JUST the BUTTON, a COMPACT self-width pill (no full-width bg) ──
  const floatBody = tappable ? (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={
        cta.kind === "buy" && price.length > 0 ? `${cta.label}, ${price}` : cta.label
      }
      style={({ pressed }) => [
        styles.floatButton,
        { backgroundColor: palette.accent },
        pressed ? styles.reservePressed : null,
      ]}
      testID={testID !== undefined ? `${testID}-action` : undefined}
    >
      <Text style={[styles.floatCta, { color: palette.accentText }, fontStyle]}>
        {cta.label} →
      </Text>
    </Pressable>
  ) : (
    <View
      style={[
        styles.floatButtonDisabled,
        { backgroundColor: palette.panelStrong, borderColor: palette.panelBorder },
      ]}
      accessibilityRole="text"
      accessibilityLabel={
        unavailableSub !== null ? `${unavailableTitle}. ${unavailableSub}` : unavailableTitle
      }
      testID={testID !== undefined ? `${testID}-unavailable` : undefined}
    >
      <Text style={[styles.floatDisabledTitle, { color: palette.tertiaryText }]}>
        {unavailableTitle}
      </Text>
    </View>
  );

  return (
    <View
      style={[styles.floatWrapper, { bottom: insets.bottom + 16 }]}
      pointerEvents="box-none"
      testID={testID !== undefined ? `${testID}-floating` : undefined}
    >
      {floatBody}
    </View>
  );
};

const styles = StyleSheet.create({
  dockedCard: {
    width: "100%",
    paddingTop: 18,
    marginTop: 8,
  },
  floatWrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 6,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  floatButton: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    paddingHorizontal: 26,
    paddingVertical: 15,
    minHeight: 52,
    ...Platform.select({
      android: { elevation: 0, shadowOpacity: 0 },
      default: {
        shadowColor: "#000000",
        shadowOpacity: 0.28,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 8 },
      },
    }),
  },
  floatCta: { fontSize: 16, fontWeight: "900" },
  floatButtonDisabled: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 14,
    minHeight: 48,
  },
  floatDisabledTitle: { fontSize: 14, fontWeight: "900", textAlign: "center" },
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
    ...Platform.select({
      android: { elevation: 0, shadowOpacity: 0 },
      default: {
        shadowColor: "#000000",
        shadowOpacity: 0.28,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 8 },
      },
    }),
  },
  reservePressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  rLeft: { alignItems: "flex-start", flexShrink: 1, minWidth: 0 },
  rKicker: { fontSize: 11, fontWeight: "700", opacity: 0.85 },
  rPrice: { fontSize: 19, fontWeight: "900", letterSpacing: -0.3, marginTop: 1 },
  rCta: { fontSize: 16, fontWeight: "900", flexShrink: 0 },
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
  disabledTitle: { fontSize: 15, fontWeight: "900", textAlign: "center" },
  disabledSub: { fontSize: 12, fontWeight: "600", textAlign: "center", marginTop: 2 },
});

export default EventReserveBar;
