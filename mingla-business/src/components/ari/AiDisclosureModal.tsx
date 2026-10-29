/**
 * ORCH-0821 / #3355 — first-open Ari trust sheet.
 *
 * First-launch consent. Shown when agent_user_profile.ai_disclosure_acknowledged_at
 * IS NULL. User taps "Start with Ari" → persists timestamp + dismisses.
 *
 * FIXES vs first cut:
 *   - CTA moved OUT of the ScrollView into a fixed footer. The previous
 *     ScrollView-wrapped Pressable swallowed taps when the content fit
 *     without scrolling.
 *   - Sheet wrapped in BlurView for true liquid-glass feel.
 *   - Compact three-ring Ari identity and a decision-first trust hierarchy.
 *   - Solid, shadow-free actions: no decorative gradients or glow.
 */

import React, { useEffect } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import {
  ariPalette,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { shouldUseRealBlur } from "../../utils/glassBlur";
import { resolveSheetMaxHeight } from "./aiDisclosureSheetLayout";
import { AriActionButton } from "./AriActionButton";
import { AriOrb } from "./AriOrb";

export interface AiDisclosureModalProps {
  visible: boolean;
  onAccept: () => void;
}

const TrustRow: React.FC<{ number: string; title: string; detail: string }> = ({
  number,
  title,
  detail,
}) => (
  <View style={styles.trustRow}>
    <View style={styles.trustNumber}>
      <Text style={styles.trustNumberText}>{number}</Text>
    </View>
    <View style={styles.trustCopy}>
      <Text style={styles.trustTitle}>{title}</Text>
      <Text style={styles.trustDetail}>{detail}</Text>
    </View>
  </View>
);

// META-ORCH-1002 Sub-D / ORCH-1100: on Android expo-blur renders a thin
// near-transparent view, and on phone web (< 768px) the blur-kill media rule
// strips `backdrop-filter` — both leak busy content through the 0.78 tint. Route
// those cases to a solid opaque frosted surface; iOS + wide desktop web keep the
// real blur. The width-aware decision lives in `shouldUseRealBlur(windowWidth)`.
//
// ORCH-1248 (Apple 2.1a): the blur/opaque surface is now a PURELY VISUAL
// BACKGROUND layer with `pointerEvents="none"`. It sits BEHIND the interactive
// content (which is a sibling overlay), so a real iOS UIVisualEffectView can
// never sit in the touch path of the CTA or the close (X) button and swallow
// their taps — the iOS-26 hit-testing hazard that trapped the reviewer.
const SheetBackdropSurface: React.FC = () => {
  const { width: windowWidth } = useWindowDimensions();
  if (!shouldUseRealBlur(windowWidth)) {
    return <View pointerEvents="none" style={[styles.surfaceFill, styles.opaqueSheet]} />;
  }
  return (
    <BlurView
      pointerEvents="none"
      intensity={40}
      tint="dark"
      style={[styles.surfaceFill, styles.blur]}
    />
  );
};

export const AiDisclosureModal: React.FC<AiDisclosureModalProps> = ({
  visible,
  onAccept,
}) => {
  // ORCH-1246 (Apple 2.1a): the footer holds the ONLY dismiss path
  // ("Got it — let's start"). On iPad's tall viewport the bottom-anchored sheet
  // stretches and a flat paddingBottom can push the CTA under the home-indicator.
  // Make the footer clearance safe-area aware so the CTA is always on-screen.
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const sheetMaxHeight = resolveSheetMaxHeight(windowHeight);
  // Scrim fade-in for premium entrance feel (Modal's slide handles the sheet).
  const scrimOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      scrimOpacity.value = withTiming(1, {
        duration: 320,
        easing: Easing.bezier(0.4, 0.0, 0.2, 1),
      });
    } else {
      scrimOpacity.value = 0;
    }
  }, [visible, scrimOpacity]);

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: scrimOpacity.value,
  }));

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      // ORCH-1248 (Apple 2.1a): hardware back / system gesture dismiss now closes
      // the sheet (was a no-op → reviewer could get trapped).
      onRequestClose={onAccept}
    >
      <Animated.View style={[styles.scrim, scrimStyle]}>
        {/* ORCH-1248 (Apple 2.1a): full-bleed backdrop tap-to-dismiss behind the
            sheet. Sits UNDER the sheet in z-order so it only receives taps on the
            dimmed area around the sheet, never the sheet's own content. Every
            escape route funnels to the same onAccept (optimistic close + bg-ack). */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onAccept}
          accessibilityRole="button"
          accessibilityLabel="Dismiss and continue"
        />
        <View style={[styles.sheetWrap, { maxHeight: sheetMaxHeight }]}>
          {/* ORCH-1248 (Apple 2.1a): the blur/opaque surface is a purely visual
              BACKGROUND sibling (pointerEvents="none"). All interactive content
              is a separate overlay ABOVE it, so no UIVisualEffectView ever sits
              in the touch path of the X or the CTA. */}
          <SheetBackdropSurface />
          <View style={styles.sheet}>
            <View pointerEvents="none" style={styles.grabber} />

            {/* ORCH-1248 (Apple 2.1a): ALWAYS-VISIBLE close (X) affordance,
                rendered OUTSIDE the blur layer so its touch target can never be
                swallowed. Redundant escape route #3 (with back-gesture + backdrop
                + CTA). ≥44pt hit target. */}
            <Pressable
              onPress={onAccept}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={12}
            >
              <Text style={styles.closeGlyph}>✕</Text>
            </Pressable>

            <ScrollView
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.hero}>
                <View style={styles.orbWrap}>
                  <AriOrb size="lg" decorative={false} accessibilityLabel="Ari" />
                </View>
                <Text style={styles.eyebrow}>MINGLA INTELLIGENCE</Text>
                <Text style={styles.title}>Meet Ari, your Mingla copilot.</Text>
                <Text style={styles.body}>
                  Ask Ari to plan, research, and prepare work across your business. You stay in
                  control of every consequential change.
                </Text>
              </View>
              <View style={styles.trustList}>
                <TrustRow
                  number="1"
                  title="You approve important changes"
                  detail="Ari shows what will happen before creating, publishing, sending, or spending."
                />
                <TrustRow
                  number="2"
                  title="Memory stays under your control"
                  detail="Conversations and brand context are saved, editable, and deletable in Settings."
                />
                <TrustRow
                  number="3"
                  title="Research shows its evidence"
                  detail="Sources, uncertainty, and blocked pages stay visible instead of being guessed."
                />
              </View>
              <View style={styles.boundaryCard}>
                <Text style={styles.boundaryTitle}>Important</Text>
                <Text style={styles.boundaryCopy}>
                  Ari can make mistakes and is not a financial, legal, or tax advisor. Double-check
                  decisions that matter.
                </Text>
              </View>
            </ScrollView>

            {/* Footer is OUTSIDE the ScrollView so the Pressable hit target
                is never swallowed by ScrollView gesture handling. ORCH-1248:
                it also renders ABOVE the visual blur sibling (not inside it), so
                the primary CTA is never gated on UIVisualEffectView touch-forwarding. */}
            <View
              style={[
                styles.footer,
                { paddingBottom: Math.max(insets.bottom, spacing.lg) },
              ]}
            >
              <AriActionButton
                onPress={onAccept}
                label="Start with Ari"
                variant="primary"
                accessibilityLabel="Acknowledge and continue to Ari"
              />
            </View>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(8, 9, 12, 0.65)",
    justifyContent: "flex-end",
  },
  sheetWrap: {
    // ORCH-1246 (Apple 2.1a): maxHeight is a POINT cap (see SHEET_MAX_HEIGHT)
    // applied inline so the sheet never stretches to fill a tall iPad viewport
    // and bury the footer CTA. Constrain width + center on large screens so the
    // bottom-anchored sheet reads as a contained card on iPad, not a full bleed.
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: "hidden",
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: glass.border.profileElevated,
  },
  // ORCH-1248: the visual surface is an absolutely-positioned background layer
  // filling the sheetWrap, behind the interactive content overlay.
  surfaceFill: {
    ...StyleSheet.absoluteFillObject,
  },
  blur: {
    backgroundColor: "rgba(20, 17, 19, 0.78)",
  },
  // META-ORCH-1002 Sub-D: opaque Android sheet surface (≥0.92 policy). Warm
  // dark frosted fill matching the iOS blur's intent, fully opaque so busy
  // content never bleeds through.
  opaqueSheet: {
    backgroundColor: "#1a1416",
  },
  sheet: {
    flexShrink: 1,
  },
  grabber: {
    width: 38,
    height: 4,
    alignSelf: "center",
    borderRadius: radius.full,
    backgroundColor: "#51565c",
    marginTop: spacing.sm,
  },
  // ORCH-1248 (Apple 2.1a): always-visible close affordance, top-right, above
  // the blur layer. ≥44pt effective target via size + hitSlop.
  closeButton: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#3b4248",
    backgroundColor: "#20242a",
    zIndex: 2,
  },
  closeGlyph: {
    fontSize: 18,
    lineHeight: 20,
    fontWeight: "600",
    color: textTokens.primary,
  },
  content: {
    padding: spacing.xl,
    paddingTop: spacing.lg,
    gap: spacing.lg,
  },
  hero: {
    alignItems: "center",
  },
  orbWrap: {
    alignItems: "center",
    marginBottom: spacing.md,
  },
  eyebrow: {
    color: ariPalette.flame,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 1.35,
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: typography.h1.fontSize,
    fontWeight: typography.h1.fontWeight,
    color: textTokens.primary,
    textAlign: "center",
    marginBottom: spacing.sm,
    letterSpacing: -0.45,
  },
  body: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
    maxWidth: 420,
  },
  trustList: {
    borderWidth: 1,
    borderColor: "#32383e",
    borderRadius: radius.lg,
    backgroundColor: "#171a1f",
    overflow: "hidden",
  },
  trustRow: {
    minHeight: 74,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#30353b",
  },
  trustNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#8b4a2d",
    backgroundColor: "#2a1d18",
  },
  trustNumberText: {
    color: "#f49a66",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
  },
  trustCopy: { flex: 1, minWidth: 0, gap: 3 },
  trustTitle: {
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "700",
  },
  trustDetail: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
  },
  boundaryCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#3b4147",
    backgroundColor: "#1d2126",
    padding: spacing.md,
    gap: spacing.xs,
  },
  boundaryTitle: {
    color: textTokens.primary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "700",
  },
  boundaryCopy: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.tertiary,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    // paddingBottom is applied inline as Math.max(insets.bottom, spacing.lg)
    // — see render (ORCH-1246): keeps the CTA above the home-indicator on iPad.
    borderTopWidth: 1,
    borderTopColor: glass.border.profileBase,
  },
});

export default AiDisclosureModal;
