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
 *   - Compact three-ring Ari identity and one decision-first trust promise.
 *   - One boundary and one action: no nested cards or competing choices.
 */

import React, { useEffect } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import {
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { shouldUseRealBlur } from "../../utils/glassBlur";
import { resolveSheetMaxHeight } from "./aiDisclosureSheetLayout";
import { AriPremiumButton as Button } from "./AriPremiumButton";
import { AriOrb } from "./AriOrb";

export interface AiDisclosureModalProps {
  visible: boolean;
  onAccept: () => void;
}

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
    return (
      <View
        pointerEvents="none"
        style={[styles.surfaceFill, styles.opaqueSheet]}
      />
    );
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
      <Animated.View
        style={[
          styles.scrim,
          Platform.OS === "web" ? styles.webScrimVisible : scrimStyle,
        ]}
      >
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
                  <AriOrb
                    size="md"
                    decorative={false}
                    accessibilityLabel="Ari"
                  />
                </View>
                <Text style={styles.title}>Meet Ari.</Text>
                <Text style={styles.body}>
                  Ari is powered by Mingla's AI. Ari can plan, research, and prepare work.
                  Sources stay visible, and you approve anything important.
                  Ari can make mistakes, so double-check decisions that matter.
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
              <Button
                onPress={onAccept}
                label="Start with Ari"
                variant="primary"
                size="lg"
                fullWidth
                edgeEffect="animatedGradient"
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
  webScrimVisible: {
    // Reanimated's shared-value effect can remain at its initial opacity during
    // a React Native Web Modal mount. The Modal already owns the web entrance
    // transition, so keep the scrim visibly deterministic there.
    opacity: 1,
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
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  hero: {
    alignItems: "center",
  },
  orbWrap: {
    alignItems: "center",
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
