/**
 * Modal — centred overlay panel.
 *
 * Scrim `rgba(0,0,0,0.5)` over full screen, tap to dismiss. Web only:
 * Escape key fires `onClose`. Native back-button handling deferred.
 *
 * Open: scrim fade 200ms; modal scale 0.96 → 1.0 + opacity over 200ms
 * `easings.out`. Close: scale 1.0 → 0.96 + opacity 0 over 160ms
 * `easings.in`. Reduce-motion: opacity-only.
 *
 * Body uses `GlassCard variant="elevated"` with radius `xl`.
 */

import React, { useEffect } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import {
  radius as radiusTokens,
  spacing,
} from "../../constants/designSystem";

import { GlassCard } from "./GlassCard";

export interface ModalProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Max width on web; ignored on native (which fills available width minus padding). */
  maxWidth?: number;
  /** Tap on scrim closes modal. Default `true`. Set `false` for destructive modals. */
  dismissOnScrimTap?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const ENTRY_DURATION = 200;
const EXIT_DURATION = 160;
const SCRIM_COLOR = "rgba(0, 0, 0, 0.5)";

export const Modal: React.FC<ModalProps> = ({
  visible,
  onClose,
  children,
  maxWidth = 480,
  dismissOnScrimTap = true,
  testID,
  style,
}) => {
  const scrimOpacity = useSharedValue(0);
  const panelScale = useSharedValue(0.96);
  const panelOpacity = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (visible) {
      scrimOpacity.value = withTiming(1, { duration: ENTRY_DURATION, easing: Easing.out(Easing.cubic) });
      panelOpacity.value = withTiming(1, { duration: ENTRY_DURATION, easing: Easing.out(Easing.cubic) });
      if (!reduceMotion) {
        panelScale.value = withTiming(1, { duration: ENTRY_DURATION, easing: Easing.out(Easing.cubic) });
      } else {
        panelScale.value = 1;
      }
    } else {
      scrimOpacity.value = withTiming(0, { duration: EXIT_DURATION, easing: Easing.in(Easing.cubic) });
      panelOpacity.value = withTiming(0, { duration: EXIT_DURATION, easing: Easing.in(Easing.cubic) });
      if (!reduceMotion) {
        panelScale.value = withTiming(0.96, { duration: EXIT_DURATION, easing: Easing.in(Easing.cubic) });
      }
    }
  }, [panelOpacity, panelScale, reduceMotion, scrimOpacity, visible]);

  useEffect(() => {
    return (): void => {
      cancelAnimation(scrimOpacity);
      cancelAnimation(panelOpacity);
      cancelAnimation(panelScale);
    };
  }, [panelOpacity, panelScale, scrimOpacity]);

  // Web Escape-key handler.
  useEffect(() => {
    if (Platform.OS !== "web" || !visible) return;
    const docLike = globalThis as unknown as {
      document?: {
        addEventListener: (type: string, listener: (event: { key: string }) => void) => void;
        removeEventListener: (type: string, listener: (event: { key: string }) => void) => void;
      };
    };
    if (docLike.document === undefined) return;
    const handler = (event: { key: string }): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    docLike.document.addEventListener("keydown", handler);
    return (): void => {
      docLike.document!.removeEventListener("keydown", handler);
    };
  }, [onClose, visible]);

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: scrimOpacity.value,
  }));

  const panelStyle = useAnimatedStyle(() => ({
    opacity: panelOpacity.value,
    transform: [{ scale: panelScale.value }],
  }));

  const handleScrimPress = (): void => {
    if (dismissOnScrimTap) onClose();
  };

  return (
    <View
      pointerEvents={visible ? "auto" : "none"}
      style={StyleSheet.absoluteFill}
      testID={testID}
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM_COLOR }, scrimStyle]}
      >
        <Pressable style={styles.scrimPress} onPress={handleScrimPress} />
      </Animated.View>
      <View style={styles.center} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.panelWrap,
            Platform.OS === "web" ? { maxWidth } : null,
            panelStyle,
            style,
          ]}
        >
          <GlassCard variant="elevated" radius="xl" padding={spacing.lg}>
            {children}
          </GlassCard>
        </Animated.View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  scrimPress: {
    flex: 1,
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  panelWrap: {
    width: "100%",
    borderRadius: radiusTokens.xl,
  },
});

export default Modal;
