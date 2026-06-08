/**
 * ORCH-0821 — AI disclosure modal (rework 2026-05-12 — fixed tap + liquid glass)
 *
 * First-launch consent. Shown when agent_user_profile.ai_disclosure_acknowledged_at
 * IS NULL. User taps "Got it — let's start" → persists timestamp + dismisses.
 *
 * FIXES vs first cut:
 *   - CTA moved OUT of the ScrollView into a fixed footer. The previous
 *     ScrollView-wrapped Pressable swallowed taps when the content fit
 *     without scrolling.
 *   - Sheet wrapped in BlurView for true liquid-glass feel.
 *   - Calmer Ari palette on the CTA (warm coral, not punchy brand orange).
 *   - Subtle inner highlight ring at the sheet top for premium glass edge.
 */

import React, { useEffect } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
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
const BlurViewOrOpaque: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { width: windowWidth } = useWindowDimensions();
  if (!shouldUseRealBlur(windowWidth)) {
    return <View style={styles.opaqueSheet}>{children}</View>;
  }
  return (
    <BlurView intensity={40} tint="dark" style={styles.blur}>
      {children}
    </BlurView>
  );
};

export const AiDisclosureModal: React.FC<AiDisclosureModalProps> = ({
  visible,
  onAccept,
}) => {
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
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent>
      <Animated.View style={[styles.scrim, scrimStyle]}>
        <View style={styles.sheetWrap}>
          {/* META-ORCH-1002 Sub-D: Android renders an opaque frosted surface
              instead of expo-blur's thin near-transparent fallback. iOS keeps
              the real BlurView. */}
          <BlurViewOrOpaque>
            <View style={styles.sheet}>
              {/* Inner highlight ring at the top of the sheet — premium glass edge */}
              <View pointerEvents="none" style={styles.topHighlight} />

              <ScrollView
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.orbWrap}>
                  <AriOrb size="lg" decorative={false} accessibilityLabel="Ari" />
                </View>
                <Text style={styles.title}>Meet Ari.</Text>
                <Text style={styles.body}>
                  Ari is your AI co-pilot, powered by Google Gemini. It can create brands and events
                  for you, and answer questions about your business.
                </Text>
                <Text style={styles.subhead}>How it works</Text>
                <Text style={styles.bullet}>
                  • Ari never makes changes without asking — you always confirm before anything is
                  created or changed.
                </Text>
                <Text style={styles.bullet}>
                  • Your conversations are saved so Ari remembers context across visits.
                </Text>
                <Text style={styles.bullet}>
                  • You can see and delete everything Ari knows about you in Settings.
                </Text>
                <Text style={[styles.body, styles.disclaimer]}>
                  Ari is not a financial, legal, or tax advisor. Always double-check anything
                  important.
                </Text>
              </ScrollView>

              {/* Footer is OUTSIDE the ScrollView so the Pressable hit target
                  is never swallowed by ScrollView gesture handling. This is the
                  root-cause fix for the "Got it doesn't tap" bug. */}
              <View style={styles.footer}>
                <Pressable
                  onPress={onAccept}
                  style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Acknowledge and continue to Ari"
                  hitSlop={8}
                >
                  <Text style={styles.ctaText}>Got it — let&apos;s start</Text>
                </Pressable>
              </View>
            </View>
          </BlurViewOrOpaque>
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
    maxHeight: "88%",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: "hidden",
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: glass.border.profileElevated,
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
  topHighlight: {
    position: "absolute",
    top: 0,
    left: spacing.lg,
    right: spacing.lg,
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    zIndex: 1,
  },
  content: {
    padding: spacing.xl,
    paddingTop: spacing.xl + spacing.sm,
  },
  orbWrap: {
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: typography.h1.fontSize,
    fontWeight: typography.h1.fontWeight,
    color: textTokens.primary,
    textAlign: "center",
    marginBottom: spacing.md,
    letterSpacing: -0.2,
  },
  body: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    marginBottom: spacing.md,
  },
  subhead: {
    fontSize: typography.bodyLg.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  bullet: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    marginBottom: spacing.xs,
  },
  disclaimer: {
    marginTop: spacing.md,
    fontSize: typography.bodySm.fontSize,
    color: textTokens.tertiary,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: glass.border.profileBase,
  },
  cta: {
    height: 54,
    borderRadius: radius.lg,
    backgroundColor: ariPalette.flame,
    alignItems: "center",
    justifyContent: "center",
    // Premium soft glow shadow under the CTA
    shadowColor: ariPalette.flame,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 0,
  },
  ctaPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  ctaText: {
    fontSize: typography.bodyLg.fontSize,
    fontWeight: "600",
    color: textTokens.inverse,
    letterSpacing: 0.2,
  },
});

export default AiDisclosureModal;
