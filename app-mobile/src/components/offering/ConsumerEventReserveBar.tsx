/**
 * ConsumerEventReserveBar — ORCH-1138 Leg 2 (consumer EVENT detail floating CTA).
 *
 * The consumer-app ticket CTA for the event detail, built to MATCH the
 * business/web public event page's `EventReserveBar` EXACTLY and mirroring the
 * SHIPPED consumer trip leg's `ConsumerTripReserveBar` 1:1 — but EVENT-only:
 * SINGLE CTA, NO split-CTA / "Pay over time" branch (events have no installment
 * plan). OQ-1(b): a NEW consumer-local component, NOT a generalization of the
 * trip bar (zero blast radius to the shipped trip leg).
 *
 * ── TWO render modes (float→dock single CTA, the sleek button language) ──
 *   • variant="docked"  — the CTA's RESTING position. Rendered as the FINAL element
 *     INSIDE the scroll content, in NORMAL FLOW (NOT absolute), flush beneath the
 *     tier list with NO black void. Its bg/bar is allowed at rest; it pads its own
 *     bottom safe-area.
 *   • variant="floating" — shown ONLY WHILE the docked button is scrolled OUT of
 *     view. JUST THE BUTTON — a COMPACT self-width pill (label only), NO kicker/
 *     price block, NO full-width opaque bar bg.
 *
 * The floating variant is an ABSOLUTE OVERLAY inside the gorhom sheet body — NOT
 * BaseBottomSheet's `stickyFooter` (which re-triggers the ORCH-1016/1043 scroll
 * freeze). It reads the SAME shared `CtaState` (one buy-state owner) + the SAME
 * `ThemePalette` as the business EventReserveBar.
 *
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

export interface ConsumerEventReserveBarProps {
  cta: CtaState;
  palette: ThemePalette;
  /** Small line above the price ("All-in, taxes included"). null → no kicker. */
  kicker: string | null;
  /** Bold (700-weight) loaded family for the price + CTA (native bold). */
  fontFamily?: string;
  /** Fired ONLY for tappable states (buy / free / waitlist). */
  onPress: () => void;
  variant: "docked" | "floating";
  /**
   * The SCREEN-LEVEL safe-area bottom inset, passed from the screen root. The bar
   * lives INSIDE the gorhom BaseBottomSheet, whose content establishes its OWN
   * SafeAreaProvider context that can resolve `useSafeAreaInsets().bottom` to ~0 —
   * so the bar's own hook under-reports. Used by BOTH variants to keep the button
   * above the home indicator.
   */
  safeAreaBottom?: number;
  /** Docked-only — reports the docked CTA's layout for float-pill hiding. */
  onDockLayout?: (event: LayoutChangeEvent) => void;
  testID?: string;
}

export const ConsumerEventReserveBar: React.FC<ConsumerEventReserveBarProps> = ({
  cta,
  palette,
  kicker,
  fontFamily,
  onPress,
  variant,
  safeAreaBottom,
  onDockLayout,
  testID,
}) => {
  const insets = useSafeAreaInsets();
  const HOME_INDICATOR_FLOOR = 34;
  // The floating variant is an absolute child of the gorhom BottomSheetContent,
  // which extends ~63pt BELOW the visible window at the 90% snap. The floating
  // pill's `bottom` must clear that overshoot FIRST, then the home-indicator
  // floor, then a visible float gap. The docked variant is IN FLOW (no overshoot).
  const SHEET_BOTTOM_OVERSHOOT = 63;
  const FLOAT_GAP = 16;
  const safeBottom = Math.max(safeAreaBottom ?? 0, insets.bottom, HOME_INDICATOR_FLOOR);
  const wrapperBottom = safeBottom + SHEET_BOTTOM_OVERSHOOT + FLOAT_GAP;
  const fontStyle = fontFamily !== undefined ? { fontFamily } : null;

  const handlePress = (): void => {
    if (!cta.tappable) return;
    if (Platform.OS !== "web") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    onPress();
  };

  const tappable = cta.tappable;
  const price = cta.kind === "buy" ? cta.price : "";
  const unavailableTitle = cta.kind === "unavailable" ? cta.title : "";
  const unavailableSub = cta.kind === "unavailable" ? cta.subline : null;

  // The shared button/strip body — identical for both variants.
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
          { backgroundColor: palette.page, paddingBottom: safeBottom + 8 },
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
      style={[styles.floatWrapper, { bottom: wrapperBottom }]}
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
  floatCta: { fontSize: 16, fontWeight: "900", flexShrink: 0 },
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

export default ConsumerEventReserveBar;
