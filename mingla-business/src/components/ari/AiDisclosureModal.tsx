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
 *   - #4420: the sheet surface is `<Material kind="sheet">` (the one glass
 *     owner): iOS blur, solid graphite on Android and phone web.
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
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { color, radius, scrim, size, space, type } from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import { Material } from "../ui/Material";
import { resolveSheetMaxHeight } from "./aiDisclosureSheetLayout";
import { AriPremiumButton as Button } from "./AriPremiumButton";
import { AriOrb } from "./AriOrb";

export interface AiDisclosureModalProps {
  visible: boolean;
  onAccept: () => void;
}

// #4420 (was META-ORCH-1002 Sub-D / ORCH-1100): the sheet surface is drawn by
// `<Material kind="sheet">`, which owns the platform decision (iOS blur;
// Android, Reduce Transparency and phone web < 768 get the solid sheet fill via
// `shouldUseRealBlur`), so busy content never bleeds through.
//
// ORCH-1248 (Apple 2.1a): the surface is a PURELY VISUAL BACKGROUND layer with
// `pointerEvents="none"`. It sits BEHIND the interactive content (a sibling
// overlay), so a real iOS UIVisualEffectView can never sit in the touch path of
// the CTA or the close (X) button and swallow their taps.
const SheetBackdropSurface: React.FC = () => (
  <Material kind="sheet" pointerEvents="none" style={styles.surfaceFill} />
);

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
              <Text style={styles.closeGlyph}>
                <Icon name="close" size={18} color={color.text1} />
              </Text>
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
                { paddingBottom: Math.max(insets.bottom, space[6]) },
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
    backgroundColor: scrim.modal,
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
    borderTopLeftRadius: radius.xxxl,
    borderTopRightRadius: radius.xxxl,
    overflow: "hidden",
  },
  // ORCH-1248: the visual surface is an absolutely-positioned background layer
  // filling the sheetWrap, behind the interactive content overlay.
  surfaceFill: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    flexShrink: 1,
  },
  grabber: {
    width: size.handle.width,
    height: size.handle.height,
    alignSelf: "center",
    borderRadius: radius.full,
    backgroundColor: color.fill.handle,
    marginTop: space[2],
  },
  // ORCH-1248 (Apple 2.1a): always-visible close affordance, top-right, above
  // the blur layer. ≥44pt effective target via size + hitSlop.
  closeButton: {
    position: "absolute",
    top: space[2],
    right: space[2],
    width: size.iconBtn.sm,
    height: size.iconBtn.sm,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
    backgroundColor: color.fill.tile,
    zIndex: 2,
  },
  closeGlyph: {
    lineHeight: 18,
  },
  content: {
    padding: space[7],
    paddingTop: space[6],
    paddingBottom: space[4],
    gap: space[4],
  },
  // #4420 COPY_RULES 4: a paragraph reads left-aligned under the orb + title.
  hero: {
    alignItems: "flex-start",
  },
  orbWrap: {
    marginBottom: space[3],
  },
  title: {
    ...type.title,
    color: color.text1,
    marginBottom: space[2],
  },
  body: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: color.text2,
  },
  footer: {
    paddingHorizontal: space[7],
    paddingTop: space[4],
    // paddingBottom is applied inline as Math.max(insets.bottom, spacing.lg)
    // — see render (ORCH-1246): keeps the CTA above the home-indicator on iPad.
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
});

export default AiDisclosureModal;
