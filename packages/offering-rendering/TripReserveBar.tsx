/**
 * TripReserveBar — META-ORCH-1174 Leg A [trip-page-standardize].
 *
 * THE ONE promoted reserve/floating bar for the public trip page, rendered
 * byte-identically on buyer-web + business iOS/Android + consumer iOS/Android.
 * Promotes the two near-identical forks — `mingla-business/src/components/trip/
 * TripReserveBar.tsx` (718 lines) + `app-mobile/src/components/offering/
 * ConsumerTripReserveBar.tsx` (785 lines) — into this single shared component.
 *
 * The ONLY delta between the old forks was the consumer's gorhom-sheet safe-area
 * handling (`safeAreaBottom` + a `SHEET_BOTTOM_OVERSHOOT=63` lift + F-4
 * arrow-bleed guards). This shared bar accepts BOTH `safeAreaBottom` AND an
 * optional `sheetBottomOvershoot` (default 0 for web/business, ~63 for the
 * consumer gorhom sheet at the 90% snap) so the floating pill clears the home
 * indicator on consumer WITHOUT over-padding on web. The F-4 arrow-bleed
 * flexShrink guards are kept universally (they no-op on web/business).
 *
 * Two render modes (Seth's device-rework #3/#4):
 *   • variant="docked"  — in-flow card, the CTA's RESTING position, the LAST scroll
 *     child (flush, no black void). May carry its bg at rest; pads its own bottom
 *     safe-area; `onDockLayout` reports its position so the surface hides the pill.
 *   • variant="floating" — JUST the button: a compact self-width pill (NO kicker,
 *     NO bar bg), absolute-positioned + lifted above the home indicator + the
 *     sheet overshoot. Shown while the docked button is off-screen. ORCH-1175:
 *     the pill DOES carry the live `cta.price` segment ("$130 · Reserve my spot →")
 *     so it tracks the §10 selected total — the docked + floating bars never diverge.
 *
 * Split-plan (Seth, 2026-06-15): when `splitCtas` is set, BOTH variants render the
 * unified seam-split "Treatment B" two-tone control (accent "Pay in full" half +
 * fold seam + solid-white "Pay over time" half with accent text + accent hairline).
 *
 * Pure-presentational (I-MOR-0827): no useAuth, no fetch; the surface owns state.
 * Constitution #1 (no dead taps): press fires only for tappable states; the
 * unavailable branch has NO onPress and role "text". Android opaque fills + no
 * shadow under the rounded fill (ANDROID_GLASS_USES_OPAQUE_FALLBACK).
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
import * as Haptics from "expo-haptics";

import type { CtaState } from "./offeringCta";
import type { ThemePalette } from "./themePalette";
import type { ReserveSplitButton, ReserveSplitCtas } from "./tripOfferingTypes";

export type { ReserveSplitButton, ReserveSplitCtas } from "./tripOfferingTypes";

export interface TripReserveBarProps {
  cta: CtaState;
  palette: ThemePalette;
  /** Small line above the price ("All-in, taxes included" / "Due today · deposit"). */
  kicker: string | null;
  /** Resolved bold font family for the price + CTA (native bold). */
  fontFamily?: string;
  /** Fired ONLY for tappable states (buy / free). */
  onPress: () => void;
  /** When set, render the unified seam-split "Pay in full"/"Pay over time" control. */
  splitCtas?: ReserveSplitCtas;
  /** "docked" → in-flow last child; "floating" → absolute compact pill. */
  variant: "docked" | "floating";
  /**
   * The SCREEN-LEVEL safe-area bottom inset, passed by the surface. The package is
   * pure (I-MOR-0827) and does NOT import react-native-safe-area-context — the
   * surface owns useSafeAreaInsets() and threads the resolved inset here (the
   * consumer passes insets.bottom; web/business passes its route-level inset). The
   * bar floors it with the home-indicator floor. 0 / undefined is a safe default.
   */
  safeAreaBottom?: number;
  /**
   * META-ORCH-1174 — the gorhom-sheet bottom overshoot the FLOATING pill must clear
   * FIRST (the consumer BottomSheetContent extends ~63pt below the visible window at
   * the 90% snap). Default 0 (web/business — no sheet, no overshoot); the consumer
   * sheet passes ~63. Docked is in-flow → overshoot is never applied to it.
   */
  sheetBottomOvershoot?: number;
  /** Fired ONLY for the docked variant — reports its layout for float→dock. */
  onDockLayout?: (event: LayoutChangeEvent) => void;
  testID?: string;
}

const HOME_INDICATOR_FLOOR = 34;
const FLOAT_GAP = 16;

export const TripReserveBar: React.FC<TripReserveBarProps> = ({
  cta,
  palette,
  kicker,
  fontFamily,
  onPress,
  splitCtas,
  variant,
  safeAreaBottom,
  sheetBottomOvershoot = 0,
  onDockLayout,
  testID,
}) => {
  // The safe-area floor both variants honor — MAX(surface-threaded inset, home
  // floor). The surface owns useSafeAreaInsets() (the package stays pure); inside a
  // gorhom sheet the surface threads its SCREEN-level inset so this never under-pads.
  const safeBottom = Math.max(safeAreaBottom ?? 0, HOME_INDICATOR_FLOOR);
  // The floating pill clears the sheet overshoot (consumer) + home floor + gap.
  const wrapperBottom = safeBottom + sheetBottomOvershoot + FLOAT_GAP;
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

  // ── UNIFIED SEAM-SPLIT CTA ("Treatment B") ──
  const renderSplitSegment = (
    btn: ReserveSplitButton,
    label: string,
    role: "primary" | "secondary",
    compact: boolean,
    keyName: string,
  ): React.ReactElement => {
    const btnPrice = btn.cta.kind === "buy" ? btn.cta.price : "";
    const isPrimary = role === "primary";
    const handleSplitPress = (): void => {
      if (!btn.cta.tappable) return;
      if (Platform.OS !== "web") {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      btn.onPress();
    };
    const SECONDARY_FILL = "#FFFFFF";
    const textColor = isPrimary ? palette.accentText : palette.accent;
    const kickerColor = isPrimary ? palette.accentText : palette.accent;
    return (
      <Pressable
        key={keyName}
        onPress={handleSplitPress}
        accessibilityRole="button"
        accessibilityLabel={btnPrice.length > 0 ? `${label}, ${btnPrice}` : label}
        style={({ pressed }) => [
          compact ? styles.segmentCompact : styles.segment,
          isPrimary ? styles.segmentPrimary : styles.segmentSecondary,
          isPrimary ? null : styles.segmentSecondaryBorder,
          {
            backgroundColor: isPrimary ? palette.accent : SECONDARY_FILL,
            borderColor: isPrimary ? undefined : palette.accent,
          },
          pressed ? styles.segmentPressed : null,
        ]}
        testID={testID !== undefined ? `${testID}-${keyName}-action` : undefined}
      >
        <Text
          style={[styles.segmentKicker, { color: kickerColor }, fontStyle]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          ellipsizeMode="tail"
        >
          {label}
        </Text>
        {btnPrice.length > 0 ? (
          <Text
            style={[
              compact ? styles.segmentAmountCompact : styles.segmentAmount,
              { color: textColor },
              fontStyle,
            ]}
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

  const renderSeam = (): React.ReactElement => (
    <View style={styles.seam}>
      <View style={styles.seamHighlight} />
    </View>
  );

  const renderSplitShell = (
    split: ReserveSplitCtas,
    compact: boolean,
  ): React.ReactElement => (
    <View
      style={[
        compact ? styles.splitShellCompact : styles.splitShell,
        { borderColor: palette.panelBorder },
      ]}
    >
      {renderSplitSegment(split.full, "Pay in full", "primary", compact, "full")}
      {renderSeam()}
      {renderSplitSegment(
        split.overTime,
        "Pay over time",
        "secondary",
        compact,
        "over-time",
      )}
    </View>
  );

  // The shared docked button/strip body — identical for both variants.
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
      <Text
        style={[styles.rCta, { color: palette.accentText }, fontStyle]}
        numberOfLines={1}
      >
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
  );

  // ── DOCKED — in-flow card (resting position, flush, no void) ──
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
        {splitCtas !== undefined ? renderSplitShell(splitCtas, false) : ctaBody}
      </View>
    );
  }

  // ── FLOATING — just the button (compact self-width pill) ──
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
      {/* ORCH-1175 — the floating pill ALSO shows the live selected price (the
          same `cta.price` the docked bar + §10 box read) so it never lags the
          box. Truncates first (flexShrink) so a long price can't shove the
          label + arrow off-edge (F-4 arrow-bleed guard parity). */}
      {price.length > 0 ? (
        <Text
          style={[styles.floatPrice, { color: palette.accentText }, fontStyle]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {price} ·{" "}
        </Text>
      ) : null}
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
        unavailableSub !== null
          ? `${unavailableTitle}. ${unavailableSub}`
          : unavailableTitle
      }
      testID={testID !== undefined ? `${testID}-unavailable` : undefined}
    >
      <Text style={[styles.floatDisabledTitle, { color: palette.tertiaryText }]}>
        {unavailableTitle}
      </Text>
    </View>
  );

  if (splitCtas !== undefined) {
    return (
      <View
        style={[styles.floatSplitWrapper, { bottom: wrapperBottom }]}
        pointerEvents="box-none"
        testID={testID !== undefined ? `${testID}-floating` : undefined}
      >
        {renderSplitShell(splitCtas, true)}
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
  floatSplitWrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 6,
    paddingHorizontal: 16,
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
  // ORCH-1175 — the live price segment inside the floating pill. Yields space
  // first (flexShrink:1) so the label + arrow stay intact on a long price.
  floatPrice: { fontSize: 16, fontWeight: "900", flexShrink: 1, minWidth: 0 },
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
  splitShell: {
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "stretch",
    width: "100%",
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
    ...Platform.select({
      android: { elevation: 0, shadowOpacity: 0 },
      default: {
        shadowColor: "#000000",
        shadowOpacity: 0.24,
        shadowRadius: 22,
        shadowOffset: { width: 0, height: 10 },
      },
    }),
  },
  splitShellCompact: {
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "stretch",
    width: "100%",
    borderRadius: 15,
    borderWidth: 1,
    overflow: "hidden",
    ...Platform.select({
      android: { elevation: 0, shadowOpacity: 0 },
      default: {
        shadowColor: "#000000",
        shadowOpacity: 0.3,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
      },
    }),
  },
  segment: {
    minWidth: 0,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 62,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  segmentCompact: {
    minWidth: 0,
    paddingHorizontal: 14,
    paddingVertical: 11,
    minHeight: 50,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  segmentPrimary: { flex: 1.15 },
  segmentSecondary: { flex: 1 },
  segmentSecondaryBorder: {
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
  },
  segmentPressed: { opacity: 0.92, transform: [{ scale: 0.985 }] },
  seam: {
    width: 2,
    alignSelf: "stretch",
    flexDirection: "row",
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  seamHighlight: {
    width: 1,
    marginLeft: 1,
    alignSelf: "stretch",
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  segmentKicker: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.2,
    opacity: 0.92,
    flexShrink: 1,
    minWidth: 0,
  },
  segmentAmount: {
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: -0.3,
    marginTop: 2,
    flexShrink: 1,
    minWidth: 0,
  },
  segmentAmountCompact: {
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: -0.3,
    marginTop: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  // F-4 (arrow-bleed) — the price/kicker block yields space first so a long
  // "From … today" price truncates rather than shoving the label+arrow off-edge.
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
  disabledSub: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 2,
  },
});

export default TripReserveBar;
