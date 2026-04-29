/**
 * Sheet — bottom-anchored drag-to-dismiss panel.
 *
 * Snap points relative to screen height:
 *   peek = 25%, half = 50%, full = 90%.
 *
 * Drag handle (36×4 rounded) at the top of the panel. Drag down by
 * more than 80px or with downward velocity > 600 fires `onClose()`.
 *
 * Open: spring (damping 22, stiffness 200, mass 1.0) translateY from
 * full-height to snap-point. Reduce-motion: 200ms timing fade-in only.
 * Close: 240ms `easings.in` translateY back to full-height + scrim fade.
 *
 * Uses `react-native-gesture-handler` `Gesture.Pan()` v2 API combined
 * with Reanimated v4 shared values.
 *
 * Caller MUST wrap the app root in `GestureHandlerRootView` (Expo Router
 * 6 includes one by default; if not, add at the top of `app/_layout.tsx`).
 */

import React, { useEffect } from "react";
import { Dimensions, Pressable, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import {
  glass,
  radius as radiusTokens,
  spacing,
} from "../../constants/designSystem";

import { GlassCard } from "./GlassCard";

export type SheetSnapPoint = "peek" | "half" | "full";

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  snapPoint?: SheetSnapPoint;
  /** Tap on scrim closes sheet. Default `true`. */
  dismissOnScrimTap?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const SNAP_RATIOS: Record<SheetSnapPoint, number> = {
  peek: 0.25,
  half: 0.5,
  full: 0.9,
};

const SCRIM_COLOR = "rgba(0, 0, 0, 0.5)";
const CLOSE_THRESHOLD_PX = 80;
const CLOSE_VELOCITY = 600;
const SPRING_CONFIG = { damping: 22, stiffness: 200, mass: 1 } as const;
const REDUCE_MOTION_OPEN = { duration: 200, easing: Easing.out(Easing.cubic) } as const;
const TIMING_CLOSE = { duration: 240, easing: Easing.in(Easing.cubic) } as const;

export const Sheet: React.FC<SheetProps> = ({
  visible,
  onClose,
  children,
  snapPoint = "half",
  dismissOnScrimTap = true,
  testID,
  style,
}) => {
  const screenHeight = Dimensions.get("window").height;
  const sheetHeight = screenHeight * SNAP_RATIOS[snapPoint];
  const closedY = sheetHeight; // pushed fully off-screen
  const openY = 0;

  const translateY = useSharedValue(closedY);
  const scrimOpacity = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (visible) {
      scrimOpacity.value = withTiming(1, REDUCE_MOTION_OPEN);
      if (reduceMotion) {
        translateY.value = withTiming(openY, REDUCE_MOTION_OPEN);
      } else {
        translateY.value = withSpring(openY, SPRING_CONFIG);
      }
    } else {
      scrimOpacity.value = withTiming(0, TIMING_CLOSE);
      translateY.value = withTiming(closedY, TIMING_CLOSE);
    }
  }, [closedY, openY, reduceMotion, scrimOpacity, translateY, visible]);

  useEffect(() => {
    return (): void => {
      cancelAnimation(translateY);
      cancelAnimation(scrimOpacity);
    };
  }, [scrimOpacity, translateY]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: scrimOpacity.value,
  }));

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      // Allow drag down only.
      if (event.translationY > 0) {
        translateY.value = event.translationY;
      }
    })
    .onEnd((event) => {
      const shouldClose =
        event.translationY > CLOSE_THRESHOLD_PX ||
        event.velocityY > CLOSE_VELOCITY;
      if (shouldClose) {
        runOnJS(onClose)();
      } else {
        translateY.value = reduceMotion
          ? withTiming(openY, REDUCE_MOTION_OPEN)
          : withSpring(openY, SPRING_CONFIG);
      }
    });

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
      <View style={styles.bottomDock} pointerEvents="box-none">
        <GestureDetector gesture={panGesture}>
          <Animated.View
            style={[
              styles.panel,
              { height: sheetHeight },
              panelStyle,
              style,
            ]}
          >
            <View style={styles.handleWrap}>
              <View style={styles.handle} />
            </View>
            <View style={styles.body}>
              <GlassCard
                variant="elevated"
                radius="xl"
                padding={spacing.lg}
                style={styles.card}
              >
                {children}
              </GlassCard>
            </View>
          </Animated.View>
        </GestureDetector>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  scrimPress: {
    flex: 1,
  },
  bottomDock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  panel: {
    width: "100%",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  handleWrap: {
    alignItems: "center",
    paddingVertical: spacing.sm + 2,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: glass.border.pending,
  },
  body: {
    flex: 1,
  },
  card: {
    flex: 1,
    borderTopLeftRadius: radiusTokens.xl,
    borderTopRightRadius: radiusTokens.xl,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
});

export default Sheet;
