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

/**
 * ORCH-1138 [trip-page-redesign] (Seth, 2026-06-15) — the SPLIT-CTA payload. When
 * present, the bar renders TWO buttons instead of one: "Pay in full" (full price)
 * and "Pay over time" (deposit due today). Each carries its OWN resolved CtaState
 * (so the labels/prices stay byte-correct) and its OWN onPress (which seeds the
 * cart with that payment choice, straight-to-cart). Provided ONLY when the trip
 * actually OFFERS an installment plan AND is bookable (rule 9 gate lives in the
 * screen/route); when absent the bar renders the SINGLE `cta`/`onPress` as before
 * (no-plan trips + every disabled/closed/sold-out state).
 */
export interface ReserveSplitButton {
  cta: CtaState;
  onPress: () => void;
}
export interface ReserveSplitCtas {
  /** Left button — pay the full price today. */
  full: ReserveSplitButton;
  /** Right button — pay the deposit today, the rest on the plan. */
  overTime: ReserveSplitButton;
}

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
   * ORCH-1138 (Seth, 2026-06-15) — when set, render TWO split buttons ("Pay in
   * full" / "Pay over time") in BOTH variants instead of the single `cta`. Passed
   * ONLY for a bookable plan trip; omit for no-plan / disabled (single button).
   */
  splitCtas?: ReserveSplitCtas;
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
  splitCtas,
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

  // ── ORCH-1138 (Seth, 2026-06-15) SPLIT BUTTONS ──
  // When `splitCtas` is present (a bookable plan trip) we render TWO buttons —
  // "Pay in full" + "Pay over time" — instead of the single `cta`. A split button
  // shows its label on top + its amount below (full price / "From {deposit}
  // today"); both rows carry the same arrow-bleed discipline as the single bar:
  // the amount yields space first (flexShrink:1 + minWidth:0 + numberOfLines=1 +
  // ellipsis) so the label never clips. Each button's onPress seeds the cart with
  // that payment choice (straight-to-cart). Disabled states never reach here (the
  // screen passes splitCtas ONLY for tappable plan trips) — the single disabled
  // strip/pill still renders.
  const renderSplitButton = (
    btn: ReserveSplitButton,
    label: string,
    style: object,
    keyName: string,
  ): React.ReactElement => {
    const btnPrice = btn.cta.kind === "buy" ? btn.cta.price : "";
    const handleSplitPress = (): void => {
      if (!btn.cta.tappable) return;
      if (Platform.OS !== "web") {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
          () => {},
        );
      }
      btn.onPress();
    };
    return (
      <Pressable
        key={keyName}
        onPress={handleSplitPress}
        accessibilityRole="button"
        accessibilityLabel={
          btnPrice.length > 0 ? `${label}, ${btnPrice}` : label
        }
        style={({ pressed }) => [
          style,
          { backgroundColor: palette.accent },
          pressed ? styles.reservePressed : null,
        ]}
        testID={
          testID !== undefined ? `${testID}-${keyName}-action` : undefined
        }
      >
        <Text
          style={[styles.splitLabel, { color: palette.accentText }, fontStyle]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          ellipsizeMode="tail"
        >
          {label}
        </Text>
        {btnPrice.length > 0 ? (
          <Text
            style={[styles.splitPrice, { color: palette.accentText }, fontStyle]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            ellipsizeMode="tail"
          >
            {btnPrice}
          </Text>
        ) : null}
      </Pressable>
    );
  };

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
    // ORCH-1138 (Seth, 2026-06-15) — split-button plan trip: TWO buttons in a row.
    if (splitCtas !== undefined) {
      return (
        <View
          style={[
            styles.dockedCard,
            { backgroundColor: palette.page, paddingBottom: safeBottom + 8 },
          ]}
          onLayout={onDockLayout}
          testID={testID !== undefined ? `${testID}-docked` : undefined}
        >
          <View style={styles.splitRow}>
            {renderSplitButton(
              splitCtas.full,
              "Pay in full",
              styles.splitButton,
              "full",
            )}
            {renderSplitButton(
              splitCtas.overTime,
              "Pay over time",
              styles.splitButton,
              "over-time",
            )}
          </View>
        </View>
      );
    }
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

  // ── FLOATING SPLIT — two compact pills SIDE BY SIDE in a horizontal row
  // (ORCH-1138 device-fix, Seth 2026-06-15: the buttons must never stack). The row
  // never wraps (no flexWrap); each pill takes flex:1 (equal halves) with minWidth:0
  // so the two share the padded wrapper, and the inner label+price shrink-to-fit
  // (numberOfLines=1 + adjustsFontSizeToFit + ellipsize) so they stay legible
  // side-by-side at 360–390px. Shown while the docked split is scrolled off; taps
  // seed the cart with the choice.
  if (splitCtas !== undefined) {
    return (
      <View
        style={[styles.floatSplitWrapper, { bottom: wrapperBottom }]}
        pointerEvents="box-none"
        testID={testID !== undefined ? `${testID}-floating` : undefined}
      >
        {renderSplitButton(
          splitCtas.full,
          "Pay in full",
          styles.floatSplitButton,
          "full",
        )}
        {renderSplitButton(
          splitCtas.overTime,
          "Pay over time",
          styles.floatSplitButton,
          "over-time",
        )}
      </View>
    );
  }

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
  // ── ORCH-1138 (Seth, 2026-06-15) SPLIT BUTTONS ──
  // DOCKED split row — two equal-width buttons SIDE BY SIDE, flush beneath
  // "Choose how you pay". flexWrap:"nowrap" guarantees they NEVER drop to a
  // stacked column at narrow phone width (ORCH-1138 device-fix, Seth 2026-06-15);
  // gap keeps them visually distinct; each button flexes to half the row and its
  // inner text shrinks-to-fit (no bleed, no wrap).
  splitRow: {
    flexDirection: "row",
    flexWrap: "nowrap",
    width: "100%",
    gap: 10,
  },
  // A docked split button — half the row (flex:1), label over price, centered.
  // minWidth:0 lets the two buttons share the row without one starving the other.
  splitButton: {
    flex: 1,
    minWidth: 0,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 60,
    alignItems: "center",
    justifyContent: "center",
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
  // FLOATING split wrapper — the two pills sit SIDE BY SIDE in a horizontal ROW
  // (ORCH-1138 device-fix, Seth 2026-06-15). flexDirection:"row" + NO flexWrap
  // means the pills can never drop to a stacked column; each pill flexes to half
  // the padded row.
  floatSplitWrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 6,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  // A floating split pill — half the row (flex:1), minWidth:0 so the two share the
  // row without one starving the other; inner label+price shrink-to-fit.
  floatSplitButton: {
    flex: 1,
    minWidth: 0,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
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
  // The split button's label (top) — the primary line; shrinks/ellipsizes first so
  // it can never push the price out (arrow-bleed discipline, ORCH-1138 F-4).
  splitLabel: {
    fontSize: 15,
    fontWeight: "900",
    flexShrink: 1,
    minWidth: 0,
    textAlign: "center",
  },
  // The split button's amount (bottom) — also one line + ellipsis, smaller weight.
  splitPrice: {
    fontSize: 13,
    fontWeight: "800",
    opacity: 0.92,
    marginTop: 2,
    flexShrink: 1,
    minWidth: 0,
    textAlign: "center",
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
