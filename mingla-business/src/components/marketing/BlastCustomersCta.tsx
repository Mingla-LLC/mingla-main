/**
 * BlastCustomersCta — sticky bottom CTA in Mingla glass + accent style
 * (ORCH-0815-A2-ui, restyled 2026-05-12 for aesthetic consistency).
 *
 * Used by:
 *   - Brand Blasts tab    ("Blast these N customers →")
 *   - Event Blasts tab    ("Blast these N buyers →")
 *   - Audience detail     ("Blast these N people →")  [sub-ORCH-B]
 *
 * Visual contract — Mingla glass capsule with confident accent presence,
 * tuned 2026-05-12 per operator live-device review (the original
 * `shadows.glassChromeActive` orange-halo treatment read as a warning
 * state instead of a primary CTA on the dark canvas):
 *   - GlassChrome wrapper (5-layer translucent glass with backdrop blur)
 *   - Custom accent tint `rgba(235,120,37,0.42)` — slightly stronger
 *     than `accent.tint` (0.28) for confident primary-action weight
 *   - `accent.border` 1px border (rgba(235,120,37,0.55))
 *   - `shadows.glassCardElevated` (black drop shadow, no orange halo)
 *     for clean lift without the warning aesthetic
 *   - `radius="full"` capsule shape
 *   - 60pt height (matches BottomNav rhythm + extra weight for primary)
 *
 * Safe-area awareness: the component reads `useSafeAreaInsets()` and adds
 * the bottom inset to its own padding so the CTA never bleeds into the
 * iPhone home-indicator zone or the Android nav-bar safe area. Callers
 * mount this absolutely-positioned at `bottom: 0` and the component
 * handles safe-area internally — no caller-side inset math required.
 *
 * Phase A: the composer route does NOT exist yet (sub-ORCH-B builds it).
 * Caller passes a toast handler via `onPress`; CTA itself just fires the
 * callback. Disabled state shown when reachableCount === 0 OR `disabled`
 * prop true.
 *
 * Design ref: §7.3 + §7.7 sticky bottom CTA + §8.13 props contract.
 * Pattern precedent: `BottomNav.tsx:200-220` active spotlight, plus
 * existing accent-glass uses in `Avatar.tsx`, `Pill.tsx`, `IconChrome.tsx`.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  blurIntensity,
  glass,
  radius,
  shadows,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export type BlastAudienceKind = "brand" | "event" | "audience";

export interface BlastCustomersCtaProps {
  audienceKind: BlastAudienceKind;
  audienceTargetId: string;
  reachableCount: number;
  /** Disabled when reachableCount = 0 or caller lacks event_manager rank. */
  disabled?: boolean;
  /** Phase A: composer route not yet wired. Caller passes a toast handler. */
  onPress?: (audienceKind: BlastAudienceKind, audienceTargetId: string) => void;
  testID?: string;
}

// Kind discriminator preserved for analytics / future copy variants — the
// current label is universal ("Send Blast (N)") so kind only routes the
// onPress side-effect, not the label.
const UNIT_BY_KIND: Record<BlastAudienceKind, { singular: string; plural: string }> = {
  brand: { singular: "customer", plural: "customers" },
  event: { singular: "buyer", plural: "buyers" },
  audience: { singular: "person", plural: "people" },
};

const CTA_HEIGHT = 60;

// Custom accent tint — stronger than `accent.tint` (0.28) for confident
// primary-action presence on dark canvas without the orange-halo shadow.
const CTA_ACCENT_TINT = "rgba(235, 120, 37, 0.42)";

export const BlastCustomersCta: React.FC<BlastCustomersCtaProps> = ({
  audienceKind,
  audienceTargetId,
  reachableCount,
  disabled,
  onPress,
  testID,
}) => {
  const insets = useSafeAreaInsets();
  const isDisabled = disabled === true || reachableCount === 0;
  // Unit kept available for any future kind-specific copy variant; current
  // label is universal per operator directive 2026-05-12.
  void UNIT_BY_KIND[audienceKind];
  const label = `Send Blast (${reachableCount})`;

  const handlePress = (): void => {
    if (isDisabled) return;
    if (onPress !== undefined) onPress(audienceKind, audienceTargetId);
  };

  // Glass layers rendered inline (not via the shared GlassChrome primitive)
  // because GlassChrome's internal `clip` View is content-sized — that
  // collapsed the visible capsule whenever the outer wrappers stretched.
  // Inlining lets the Pressable directly own the full-width clip + the
  // absoluteFill blur/tint/border layers inside, so width: "100%" on the
  // Pressable propagates correctly through every layer.
  const tintColor = isDisabled ? glass.tint.chrome.idle : CTA_ACCENT_TINT;
  const borderColor = isDisabled ? glass.border.chrome : accent.border;
  const shadowStyle = isDisabled
    ? shadows.glassChrome
    : shadows.glassCardElevated;

  return (
    <View
      style={[
        styles.host,
        { paddingBottom: Math.max(insets.bottom, spacing.md) },
      ]}
      pointerEvents="box-none"
    >
      <View style={[styles.shadowWrap, shadowStyle]}>
        <Pressable
          onPress={handlePress}
          disabled={isDisabled}
          style={({ pressed }) => [
            styles.capsule,
            pressed && !isDisabled ? styles.capsulePressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled: isDisabled }}
          testID={testID}
        >
          {/* L1 — Blur base (real backdrop blur on iOS / Android, web shim) */}
          <BlurView
            intensity={blurIntensity.chrome}
            tint="dark"
            style={StyleSheet.absoluteFill}
          />
          {/* L2 — Tint floor */}
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: tintColor }]}
          />
          {/* L3 — Hairline border */}
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                borderRadius: radius.full,
                borderColor,
                borderWidth: StyleSheet.hairlineWidth,
              },
            ]}
            pointerEvents="none"
          />
          {/* Label */}
          <View style={styles.labelHost}>
            <Text
              style={[
                styles.label,
                isDisabled ? styles.labelDisabled : styles.labelEnabled,
              ]}
              numberOfLines={1}
            >
              {label}
            </Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // Bottom-anchored host. Caller mounts at `position: 'absolute', bottom: 0`.
  // We own the bottom safe-area inset internally so callers don't have to.
  // `paddingHorizontal: spacing.xl` (32pt each side) gives the capsule a
  // floating ~84% screen-width appearance per operator review 2026-05-12
  // ("almost full width 80% and floating"). Capsule = screen − 64pt.
  // `flexDirection: "row"` + child `flex: 1` is the reliable way to force
  // the Pressable + GlassChrome to fill the inner width — `alignSelf:
  // "stretch"` doesn't propagate through GlassChrome's internal clip View
  // (which is content-sized for `overflow: hidden`), so the row+flex:1
  // pattern bypasses that entirely.
  // Width chain — every layer explicit. The load-bearing fix was actually
  // inside `GlassChrome` itself: its `clip` style now has `width:"100%"`
  // + `height:"100%"` so the BlurView + tint floor (both absoluteFill
  // inside clip) inherit a stretched parent. Without that, GlassChrome's
  // internal clip View collapsed to content-width and the visible glass
  // capsule rendered narrow even when the outer wrappers stretched.
  // Diagnosed 2026-05-12 via debug-tint screenshot (red host = full, blue
  // pressTarget = full, green glass = full, brown internal clip = narrow).
  host: {
    width: "100%",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  // Shadow wrapper sits OUTSIDE the clipping Pressable so the drop shadow
  // can extend beyond the rounded edges. The Pressable below has
  // `overflow: hidden` (to clip the BlurView + tint to the capsule's
  // rounded shape) which would otherwise also clip the shadow.
  shadowWrap: {
    width: "100%",
    borderRadius: radius.full,
  },
  capsule: {
    width: "100%",
    height: CTA_HEIGHT,
    borderRadius: radius.full,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  capsulePressed: {
    opacity: 0.88,
  },
  labelHost: {
    width: "100%",
    height: CTA_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    ...typography.buttonLg,
    textAlign: "center",
  },
  labelEnabled: {
    color: textTokens.primary,
  },
  labelDisabled: {
    color: textTokens.quaternary,
  },
});
