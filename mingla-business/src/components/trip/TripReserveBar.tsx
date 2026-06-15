/**
 * TripReserveBar — ORCH-1138 R2 (device-parity rework, finding #8).
 *
 * The phone Reserve CTA for the PUBLIC trip page, built to match
 * DIRECTION_A_V2_FULL_RESPONSIVE.html `.floating` / `.reserve`:
 *   - a single full-width BRAND-ACCENT button,
 *   - left column = a small kicker line ("All-in, taxes included" / "Due today ·
 *     deposit") above the price,
 *   - right = the "Reserve my spot →" CTA,
 *   - safe-area-inset-bottom honored,
 *   - sold-out / closed / unavailable → a non-tappable centered disabled strip.
 *
 * ── ORCH-1138 device-rework #3 (Seth's screenshot feedback) — TWO render modes ──
 * Seth saw a fixed full-width OPAQUE orange bar pinned at the bottom with a large
 * BLACK EMPTY GAP between the "Choose how you pay" card and that bar. The new
 * behavior, driven by `variant`, mirrors the consumer ConsumerTripReserveBar 1:1:
 *
 *   • variant="docked"  — the CTA's RESTING position. Rendered as the FINAL element
 *     INSIDE the scroll content (the FoundationTripPreview `left` body), in NORMAL
 *     FLOW (NOT absolute), so it sits flush just beneath the last "Choose how you
 *     pay" section with NO black void. Its bg/bar is allowed at rest; it pads its
 *     own bottom safe-area so the whole button stays above the home indicator.
 *
 *   • variant="floating" — shown ONLY WHILE the in-content docked button is scrolled
 *     OUT of view. It is JUST THE BUTTON (a pill), with NO full-width opaque bar
 *     background — a subtle drop shadow under the pill for legibility, NOT the solid
 *     full-width bar. Absolute-positioned, safe-area-inset bottom. The route hides
 *     it once the docked button scrolls in.
 *
 * Net effect: a light floating pill while scrolling → the docked button (bg ok)
 * flush at the end → no black gap, no oversized bottom padding.
 *
 * WHY a bespoke bar (not the shared FloatingOfferingBar): the ORCH-1117
 * FloatingOfferingBar hardcodes `ACCENT = "#eb7825"` (warm orange) + a
 * price-only / no-kicker layout and is consumed by the event + experience pages.
 * Re-theming it would change those callers; the §12 allowlist instead lets the
 * trip route render its OWN mockup-faithful bar around the SAME resolved
 * `CtaState` (one owner of buy-state — `resolveOfferingCta`).
 *
 * Anon-tolerant: no useAuth, no fetch. Pure presentational; the route owns state.
 * Constitution #1 (no dead taps): the press fires only for tappable states; the
 * unavailable branch has NO onPress and `accessibilityRole="text"`.
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
  /**
   * ORCH-1138 device-rework #3 — render mode:
   *   "docked"   → in-flow card placed as the LAST scroll child (flush, no void).
   *   "floating" → absolute pill overlay shown while the docked button is off-screen.
   */
  variant: "docked" | "floating";
  /**
   * ORCH-1138 device-rework #3 — fired ONLY for the docked variant: reports the
   * docked CTA's layout (its `y`/`height` within the scroll content) so the route
   * can decide when the floating pill should hide (docked button scrolled in).
   */
  onDockLayout?: (event: LayoutChangeEvent) => void;
  testID?: string;
}

export const TripReserveBar: React.FC<TripReserveBarProps> = ({
  cta,
  palette,
  surface,
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

  void surface;

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
            <Text style={[styles.rKicker, { color: palette.accentText }]}>{kicker}</Text>
          ) : null}
          {price.length > 0 ? (
            <Text style={[styles.rPrice, { color: palette.accentText }, fontStyle]}>
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
  // inset so the button sits above the home indicator with a clean gap, and
  // `onDockLayout` reports its position so the route can hide the floating pill
  // once this docked button is on-screen.
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

  // ── FLOATING — JUST the pill (NO full-width opaque bar bg), shown while the
  // docked button is scrolled OFF-screen. A subtle drop shadow sits under the pill
  // for legibility (NOT the solid full-width bar Seth flagged).
  // `pointerEvents="box-none"` lets taps pass through to the content around it.
  return (
    <View
      style={[styles.floatWrapper, { bottom: insets.bottom + 16 }]}
      pointerEvents="box-none"
      testID={testID !== undefined ? `${testID}-floating` : undefined}
    >
      <View style={styles.floatPill}>{ctaBody}</View>
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
    // paddingBottom is set dynamically (safe-area inset + gap).
    marginTop: 8,
  },
  // ── FLOATING — absolute overlay; JUST the pill, NO full-width opaque bar bg.
  // `bottom` is set dynamically (safe-area + gap) so the WHOLE pill floats above
  // the home indicator. zIndex above the scroll, below the chrome.
  floatWrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    // `bottom` set dynamically — see the component.
    zIndex: 6,
    paddingHorizontal: 16,
  },
  // The pill is just the rounded button + a small drop shadow for legibility over
  // content — NO full-width page-colored fade band behind it.
  floatPill: {
    width: "100%",
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
