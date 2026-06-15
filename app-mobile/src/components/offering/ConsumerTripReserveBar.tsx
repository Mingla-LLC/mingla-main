/**
 * ConsumerTripReserveBar — ORCH-1138 Leg 1C (Seth's explicit floating-bar ask).
 *
 * The consumer-app Reserve CTA for the trip detail, built to MATCH the
 * business/web public trip page's `TripReserveBar` EXACTLY (DIRECTION_A_V2
 * `.floating` / `.reserve`): a brand-accent button, kicker + price on the left,
 * "Reserve my spot →" on the right, sold-out / closed / unavailable → a
 * non-tappable disabled strip.
 *
 * ── ORCH-1138 device-rework #3 (Seth's screenshot feedback) — TWO render modes ──
 * Seth saw a fixed full-width OPAQUE orange bar pinned at the bottom with a large
 * BLACK EMPTY GAP between the "Choose how you pay" card and that bar. The new
 * behavior, driven by `variant`:
 *
 *   • variant="docked"  — the CTA's RESTING position. Rendered as the FINAL element
 *     INSIDE the scroll content, in NORMAL FLOW (NOT absolute), so it sits flush
 *     just beneath the last "Choose how you pay" section with NO black void. At the
 *     resting position it MAY carry its background/bar (the page-colored fade card).
 *     It carries its own bottom safe-area padding so the whole button stays above
 *     the home indicator.
 *
 *   • variant="floating" — shown ONLY WHILE the in-content docked button is scrolled
 *     OUT of view. It is JUST THE BUTTON — a COMPACT self-width pill with ONLY the
 *     "Reserve my spot →" label (NO kicker, NO "All-in, taxes included / From €500"
 *     price block) and NO full-width opaque bar background. It reads as a floating
 *     action button, not a bar. Absolute-positioned + centered, lifted above the
 *     home indicator. The screen hides it once the docked button scrolls in.
 *     (ORCH-1138 device-rework #4 — Seth: "just a button while floating, no
 *     background"; the price block + bar are the DOCKED variant only.)
 *
 * Net effect: a light floating pill while scrolling → the docked button (bg ok)
 * flush at the end → no black gap, no oversized bottom padding.
 *
 * WHY a consumer-local component (not the business TripReserveBar): TripReserveBar
 * is `mingla-business/src/`-local and cannot be imported across the app boundary
 * (I-MOR-0827-PACKAGE-ISOLATION, F-6). This is the consumer mirror around the SAME
 * shared `CtaState` (one buy-state shape) + the SAME `ThemePalette`.
 *
 * The floating variant is an ABSOLUTE OVERLAY (SPEC §4.5) inside the
 * ParallaxCoverShell body host — NOT BaseBottomSheet's `stickyFooter` prop (which
 * would nest the gorhom scroll one BottomSheetView level deeper and re-trigger the
 * ORCH-1016/1043 viewport==content scroll-freeze). The shell keeps gorhom's
 * BottomSheetScrollView as its single registered scrollable; the floating bar is a
 * sibling that does not touch the scroll. The docked variant lives INSIDE that
 * scroll content, so it never affects the scrollable registration.
 *
 * Constitution #1 (no dead taps): the press fires only for tappable states; the
 * unavailable branch has NO onPress and `accessibilityRole="text"`.
 * Anon-tolerant: pure presentational; the screen owns the state + checkout.
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

export interface ConsumerTripReserveBarProps {
  cta: CtaState;
  palette: ThemePalette;
  /** Small line above the price ("All-in, taxes included" / "Due today · deposit"). */
  kicker: string | null;
  /** Bold (700-weight) loaded family for the price + CTA (native bold). */
  fontFamily?: string;
  /** Fired ONLY for tappable states (buy / free / waitlist). */
  onPress: () => void;
  /**
   * ORCH-1138 device-rework #3 — render mode:
   *   "docked"   → in-flow card placed as the LAST scroll child (flush, no void).
   *   "floating" → absolute pill overlay shown while the docked button is off-screen.
   */
  variant: "docked" | "floating";
  /**
   * ORCH-1138 [trip-page-redesign] FIX-5 — the SCREEN-LEVEL safe-area bottom
   * inset, passed down from the screen root. The bar lives INSIDE the gorhom
   * BaseBottomSheet, whose content establishes its OWN SafeAreaProvider context
   * that can resolve `useSafeAreaInsets().bottom` to ~0 — so the bar's own hook
   * under-reports. Used by BOTH variants to keep the button above the home
   * indicator (floating: lifts the wrapper; docked: pads its own bottom).
   */
  safeAreaBottom?: number;
  /**
   * ORCH-1138 device-rework #3 — fired ONLY for the docked variant: reports the
   * docked CTA's layout (its `y`/`height` within the scroll content) so the screen
   * can decide when the floating pill should hide (docked button scrolled in).
   */
  onDockLayout?: (event: LayoutChangeEvent) => void;
  testID?: string;
}

export const ConsumerTripReserveBar: React.FC<ConsumerTripReserveBarProps> = ({
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
  // ORCH-1138 device-rework #3 — the safe-area floor both variants honor so the
  // button never bleeds under the home indicator. `useSafeAreaInsets().bottom`
  // can resolve to ~0 inside the gorhom sheet's own SafeAreaProvider, so we take
  // the MAX of the screen-level inset passed from the screen root, the local
  // inset, and a 34pt home-indicator floor.
  const HOME_INDICATOR_FLOOR = 34;
  // The floating variant is an absolute child of the gorhom BottomSheetContent,
  // which extends ~63pt BELOW the visible window at the 90% snap (measured on
  // iPhone 17 Pro). The floating pill's `bottom` must clear that overshoot FIRST,
  // then the home-indicator floor, then a visible float gap. The docked variant
  // is IN FLOW (no overshoot to clear) — it only pads its own bottom.
  const SHEET_BOTTOM_OVERSHOOT = 63;
  const FLOAT_GAP = 16;
  const safeBottom = Math.max(safeAreaBottom ?? 0, insets.bottom, HOME_INDICATOR_FLOOR);
  const wrapperBottom = safeBottom + SHEET_BOTTOM_OVERSHOOT + FLOAT_GAP;
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
            // ORCH-1138 F-4 (arrow-bleed) — the price truncates with an ellipsis
            // rather than pushing the label+arrow (rCta) off the right edge when
            // "Pay over time" makes it the longer "From {deposit} today" string.
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
      <Text
        style={[styles.rCta, { color: palette.accentText }, fontStyle]}
        numberOfLines={1}
      >
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
  // Rendered as the LAST child of the scroll content. It MAY carry its background
  // (the page-colored fade card) at rest. Pads its own bottom by the safe-area
  // floor so the button sits above the home indicator with a clean gap, and
  // `onDockLayout` reports its position so the screen can hide the floating pill
  // once this docked button is on-screen.
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

  // ── FLOATING — JUST the BUTTON, a COMPACT self-width pill (Seth's explicit ask:
  // "just a button while floating, no background"). It is NOT the docked bar: NO
  // full-width opaque bar bg, NO "All-in, taxes included / From €500" kicker+price
  // block — only the tappable label ("Reserve my spot →"), hugging its own width,
  // centered at the bottom and lifted fully above the home indicator. The disabled
  // (closed/unavailable) state renders the SAME compact pill with the unavailable
  // title and NO onPress (Constitution #1, no dead taps).
  // `pointerEvents="box-none"` lets taps pass through to the scrolling content
  // around the pill; the pill itself stays tappable.
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
    // Non-tappable compact pill — NO onPress, role "text" (no dead Reserve).
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
  // ── DOCKED — in-flow card (resting position). Background = page color (its
  // bar/bg is allowed at rest); top padding gives a small gap under the
  // "Choose how you pay" card, bottom padding (dynamic) clears the home indicator.
  dockedCard: {
    width: "100%",
    paddingTop: 18,
    // paddingBottom is set dynamically (safe-area floor + gap).
    marginTop: 8,
  },
  // ── FLOATING — absolute overlay; JUST a COMPACT self-width pill, NO full-width
  // opaque bar bg. `bottom` is set dynamically (safe-area + gorhom overshoot + gap)
  // so the WHOLE pill floats above the home indicator. `alignItems: "center"`
  // hugs the pill's own width and centers it (a floating action button, not a bar).
  // zIndex above the scroll, below the chrome (CHROME_Z=70 in ParallaxCoverShell).
  floatWrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    // `bottom` set dynamically — see the component.
    zIndex: 6,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  // The compact floating pill — hugs its label (self-width), comfortable padding,
  // a small drop shadow for legibility over content. NO price block, NO full-width
  // page-colored fade band behind it.
  floatButton: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    paddingHorizontal: 26,
    paddingVertical: 15,
    minHeight: 52,
    // iOS/web glow; Android suppressed — opaque accent fill, no shadow under the
    // rounded fill per ANDROID_GLASS_USES_OPAQUE_FALLBACK.
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
  // ORCH-1138 F-4 — defensive flexShrink:0 (the floating pill is label-only with
  // no price block, but keep the same discipline so the arrow can never clip).
  floatCta: {
    fontSize: 16,
    fontWeight: "900",
    flexShrink: 0,
  },
  // Compact disabled (closed/unavailable) floating pill — self-width, no onPress.
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
  floatDisabledTitle: {
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
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
        shadowOpacity: 0.28,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 8 },
      },
    }),
  },
  reservePressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  // ORCH-1138 F-4 (arrow-bleed) — the price/kicker block YIELDS space first
  // (flexShrink:1 + minWidth:0) so a long "Pay over time" price truncates
  // instead of shoving the label+arrow (rCta) past the button's right padding.
  rLeft: {
    alignItems: "flex-start",
    flexShrink: 1,
    minWidth: 0,
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
  // ORCH-1138 F-4 (arrow-bleed) — the label+arrow keep their intrinsic width and
  // never shrink (flexShrink:0) + stay on one line, so the "→" is always pinned
  // inside the button bounds; the price block (rLeft) absorbs the overflow.
  rCta: {
    fontSize: 16,
    fontWeight: "900",
    flexShrink: 0,
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
