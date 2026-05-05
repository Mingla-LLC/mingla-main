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
 *
 * # Overlay portal (Cycle 3 rework v3 fix)
 * Wrapped in React Native's native `Modal` component (aliased as
 * `RNModal`) so the overlay (scrim + panel) renders at the OS-level
 * root window regardless of where in the React tree the consumer
 * mounts this Modal. Without this portal, `StyleSheet.absoluteFill`
 * would resolve to the nearest positioned ancestor — for consumers
 * inside a ScrollView (e.g. ConfirmDialog rendered inside a step body
 * inside the wizard's ScrollView), the scrim + panel anchor to the
 * ScrollView's content rect rather than the screen, causing the
 * dialog to appear off-center. Same fix Sheet primitive received in
 * Cycle 2 J-A8 polish (RC-1) for the I-13 overlay-portal contract.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  Modal as RNModal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
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
const UNMOUNT_DELAY_MS = 200; // 160ms exit anim + 40ms safety

export const Modal: React.FC<ModalProps> = ({
  visible,
  onClose,
  children,
  maxWidth = 480,
  dismissOnScrimTap = true,
  testID,
  style,
}) => {
  // Lazy-mount: keep the Modal out of the View tree when not visible to
  // prevent inline-render leaks (Sub-phase E.4 / ORCH-BIZ-0a-E12). Stay
  // mounted long enough for the close animation to finish, then unmount.
  const [mounted, setMounted] = useState<boolean>(visible);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrimOpacity = useSharedValue(0);
  const panelScale = useSharedValue(0.96);
  const panelOpacity = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (visible) {
      setMounted(true);
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    } else if (mounted) {
      closeTimerRef.current = setTimeout(() => {
        setMounted(false);
        closeTimerRef.current = null;
      }, UNMOUNT_DELAY_MS);
    }
    return (): void => {
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [mounted, visible]);

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

  if (!mounted) return null;

  return (
    <RNModal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View
        pointerEvents={visible ? "auto" : "none"}
        style={StyleSheet.absoluteFill}
        testID={testID}
      >
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM_COLOR }, scrimStyle]}
        >
          <Pressable
            style={styles.scrimPress}
            onPress={handleScrimPress}
            accessibilityLabel="Dismiss modal"
            accessibilityRole="button"
          />
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
    </RNModal>
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
