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
 *     OUT of view. It is JUST THE BUTTON — a COMPACT self-width pill with ONLY the
 *     "Reserve my spot →" label (NO kicker, NO "All-in, taxes included / From €500"
 *     price block) and NO full-width opaque bar background. It reads as a floating
 *     action button, not a bar. Absolute-positioned + centered, safe-area-inset
 *     bottom. The route hides it once the docked button scrolls in.
 *     (ORCH-1138 device-rework #4 — Seth: "just a button while floating, no
 *     background"; the price block + bar are the DOCKED variant only.)
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

/**
 * ORCH-1138 [trip-page-redesign] (Seth, 2026-06-15) — the SPLIT-CTA payload,
 * mirrors the consumer ConsumerTripReserveBar 1:1. When present, the bar renders
 * TWO buttons — "Pay in full" + "Pay over time" — instead of the single `cta`.
 * Each carries its OWN resolved CtaState (byte-correct labels/prices) + its OWN
 * onPress (routes straight to checkout with that payment choice pre-selected).
 * Provided ONLY for a bookable plan trip; omitted for no-plan / disabled (single).
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
  splitCtas,
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

  // ── ORCH-1138 [trip-page-redesign] (Seth, 2026-06-15) UNIFIED SEAM-SPLIT CTA ──
  // "Treatment B" (design/ORCH-1138/SPLIT_CTA_OPTIONS.html), mirrors the consumer
  // ConsumerTripReserveBar 1:1. ONE continuous rounded control — NOT two detached
  // buttons — folded by a crisp hairline SEAM. A TWO-TONE control: the LEFT segment
  // ("Pay in full") is the accent-FILLED primary (white/accentText text, flex 1.15,
  // leads, takes a touch more room); the RIGHT segment ("Pay over time", Seth
  // 2026-06-15) is a SOLID WHITE half with ACCENT-COLORED text — NOT a transparent
  // ghost — with an accent-tinted hairline so the white half still reads on a LIGHT
  // brand page. The shell owns the rounded corners + border + overflow:hidden so the
  // two fills meet at the seam like a fold. Both segments are INDEPENDENT real CTAs —
  // each onPress routes straight to checkout with its payment choice. Each segment's
  // kicker + amount are one line + ellipsize + shrink-to-fit (no wrap, no bleed) so
  // the row never stacks at 360–390px. Disabled states never reach here. Theme-aware:
  // accent / accentText come from the resolved palette (light + dark themes); the
  // white half's fill is a fixed literal by design (theme-independent, like the seam
  // fold tints) and its text + hairline are the resolved `palette.accent`.
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
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
          () => {},
        );
      }
      btn.onPress();
    };
    // ── ORCH-1138 [trip-page-redesign] (Seth, 2026-06-15) TWO-TONE SPLIT ──
    // Mirrors the consumer ConsumerTripReserveBar 1:1. The "Pay over time"
    // (secondary) segment is now a SOLID WHITE half with ACCENT-COLORED text — NOT
    // the old too-transparent panelStrong ghost. Net: a two-tone unified control —
    // accent half (white text) + seam + solid-white half (accent text). The accent
    // is THEME-AWARE (`palette.accent`), never a hardcoded literal. The white fill IS
    // a fixed literal by design (theme-independent, like the seam fold tints). On a
    // LIGHT brand page white-on-near-white would vanish, so the secondary segment
    // also draws an accent-tinted hairline inset (segmentSecondaryBorder) — the white
    // half stays defined on both dark + light brand themes. The "Pay in full"
    // (primary) half is UNCHANGED: accent fill, white (accentText) text.
    const SECONDARY_FILL = "#FFFFFF";
    const textColor = isPrimary ? palette.accentText : palette.accent;
    const kickerColor = isPrimary ? palette.accentText : palette.accent;
    return (
      <Pressable
        key={keyName}
        onPress={handleSplitPress}
        accessibilityRole="button"
        accessibilityLabel={
          btnPrice.length > 0 ? `${label}, ${btnPrice}` : label
        }
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
        testID={
          testID !== undefined ? `${testID}-${keyName}-action` : undefined
        }
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

  // The fold-seam — the visual proof the two segments are ONE control. Per
  // Treatment B: a hairline dark crease (rgba(0,0,0,0.22)) + a 1px light fold
  // highlight (rgba(255,255,255,0.10)). These fold tints are theme-independent.
  const renderSeam = (): React.ReactElement => (
    <View style={styles.seam}>
      <View style={styles.seamHighlight} />
    </View>
  );

  // The unified seam-split shell — ONE rounded, bordered, overflow-clipped row
  // holding [primary | seam | secondary]. `compact` is the floating form.
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
    // ORCH-1138 [trip-page-redesign] (Seth, 2026-06-15) — split-plan trip: the
    // unified seam-split control (Treatment B) full-width, flush beneath "Choose
    // how you pay".
    if (splitCtas !== undefined) {
      return (
        <View
          style={[
            styles.dockedCard,
            { backgroundColor: palette.page, paddingBottom: insets.bottom + 8 },
          ]}
          onLayout={onDockLayout}
          testID={testID !== undefined ? `${testID}-docked` : undefined}
        >
          {renderSplitShell(splitCtas, false)}
        </View>
      );
    }
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

  // ── FLOATING — JUST the BUTTON, a COMPACT self-width pill (Seth's explicit ask:
  // "just a button while floating, no background"). It is NOT the docked bar: NO
  // full-width opaque bar bg, NO "All-in, taxes included / From €500" kicker+price
  // block — only the tappable label ("Reserve my spot →"), hugging its own width,
  // centered at the bottom and lifted fully above the home indicator. The disabled
  // (closed/unavailable) state renders the SAME compact pill with the unavailable
  // title and NO onPress (Constitution #1, no dead taps).
  // `pointerEvents="box-none"` lets taps pass through to the content around it.
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

  // ── FLOATING SPLIT — the SAME unified seam-split control (Treatment B), in its
  // COMPACT form: ONE shell, [primary | seam | secondary] side by side, never
  // stacking/wrapping (the shell is flexDirection:row, no flexWrap), inline amount,
  // tighter radius. minWidth:0 + shrink-to-fit keep it legible at 360–390px. Shown
  // while the docked split is scrolled off; each segment routes to checkout with
  // its choice. `pointerEvents="box-none"` lets taps pass to the content around it.
  if (splitCtas !== undefined) {
    return (
      <View
        style={[styles.floatSplitWrapper, { bottom: insets.bottom + 16 }]}
        pointerEvents="box-none"
        testID={testID !== undefined ? `${testID}-floating` : undefined}
      >
        {renderSplitShell(splitCtas, true)}
      </View>
    );
  }

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
  // ── DOCKED — in-flow card (resting position). Background = page color (its
  // bar/bg is allowed at rest); top padding gives a small gap under the
  // "Choose how you pay" card, bottom padding (dynamic) clears the home indicator.
  dockedCard: {
    width: "100%",
    paddingTop: 18,
    // paddingBottom is set dynamically (safe-area inset + gap).
    marginTop: 8,
  },
  // ── FLOATING — absolute overlay; JUST a COMPACT self-width pill, NO full-width
  // opaque bar bg. `bottom` is set dynamically (safe-area + gap) so the WHOLE pill
  // floats above the home indicator. `alignItems: "center"` hugs the pill's own
  // width and centers it (a floating action button, not a bar). zIndex above the
  // scroll, below the chrome.
  floatWrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    // `bottom` set dynamically — see the component.
    zIndex: 6,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  // FLOATING split wrapper — hosts the SINGLE compact seam-split shell (Treatment
  // B) across the padded width. (ORCH-1138 [trip-page-redesign] — the
  // two-detached-pills row is replaced by one unified control.)
  floatSplitWrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 6,
    paddingHorizontal: 16,
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
  floatCta: {
    fontSize: 16,
    fontWeight: "900",
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
  // ── ORCH-1138 [trip-page-redesign] (Seth, 2026-06-15) UNIFIED SEAM-SPLIT CTA ──
  // "Treatment B" (mirrors ConsumerTripReserveBar). ONE rounded, bordered,
  // overflow-clipped shell holding [primary | seam | secondary] in a single row —
  // NOT two detached buttons. The shell owns the radius + border + clip so the
  // accent fill (left) and ghost fill (right) meet at the fold-seam like one
  // folded control. flexDirection:"row" + NO flexWrap → the segments can NEVER
  // stack. Box-shadow glow on iOS/web; Android suppressed (opaque fills, no shadow
  // under the rounded clip per ANDROID_GLASS_USES_OPAQUE_FALLBACK).
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
  // The COMPACT (floating) shell — same anatomy, shorter, tighter radius.
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
  // A docked segment — left-aligned kicker over amount (Treatment B `.b-side`).
  // No own radius (the shell clips); minWidth:0 lets it share the row + shrink.
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
  // The primary segment leads — accent FILL + a touch more room (flex 1.15).
  segmentPrimary: {
    flex: 1.15,
  },
  // The secondary segment — SOLID WHITE fill + ACCENT text, equal weight (flex 1).
  segmentSecondary: {
    flex: 1,
  },
  // ORCH-1138 [trip-page-redesign] (Seth, 2026-06-15) — the white half's legibility
  // guard. A 1px accent-tinted hairline on the OUTER edges (top/right/bottom) only —
  // the LEFT edge is the fold-seam, left clean — so a solid-WHITE "Pay over time"
  // half still reads against a LIGHT brand page (white-on-near-white). `borderColor`
  // is set inline to the resolved `palette.accent` (theme-aware). The shell clips to
  // its radius (overflow:"hidden") so this inset hairline never escapes the corners.
  segmentSecondaryBorder: {
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
  },
  segmentPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.985 }],
  },
  // The seam — a 2px fold: a 1px dark crease + a 1px light highlight so the two
  // fills meet like one folded surface (Treatment B `.b-seam` + `::after`).
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
  // The segment kicker ("Pay in full" / "Pay over time") — small top line; shrinks
  // first so it can never push the amount out (no bleed/wrap).
  segmentKicker: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.2,
    opacity: 0.92,
    flexShrink: 1,
    minWidth: 0,
  },
  // The segment amount — the bold price line (Treatment B `.b-amt`).
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
