/**
 * TopSheet — top-anchored drop-down panel.
 *
 * Slides down from below the topbar to its open position. Internal scroll
 * for content with a pinned footer. Swipe-up to dismiss; tap scrim to
 * dismiss; web Escape and Android hardware back also close.
 *
 * Geometry (per Cycle 1 spec lock-in):
 *   - Anchored below the topbar: `top = insets.top + TOPBAR_OFFSET`. Topbar
 *     stays visible (drop-down "issues" from the chip vertically).
 *   - Width matches the topbar: `marginHorizontal: spacing.md`. Visual
 *     consistency with the chrome above.
 *   - Fixed height: 70% of screen height. Content scrolls internally; the
 *     pinned footer never disappears regardless of brand list length.
 *
 * Animations:
 *   - Open: scrim fade in 220ms; panel translateY from `-panelHeight` to
 *           `0` over 280ms (`easings.out`). Panel slides DOWN from behind
 *           the topbar to its anchor.
 *   - Close: scrim fade out 220ms; panel translateY from `0` to
 *            `-panelHeight` over 240ms (`easings.in`). Panel slides UP back
 *            behind the topbar — same motion as the user's swipe.
 *   - Reduce-motion: opacity-only fade (no translate).
 *
 * Lazy-mount per E.4 — returns null when not mounted, schedules unmount
 * 280ms after `visible` flips false (matches exit anim + 40ms safety).
 *
 * Caller MUST wrap the app root in `GestureHandlerRootView` (already done
 * in `app/_layout.tsx` for Sheet primitive — same dependency).
 *
 * Kit extension: DEC-080 — TopSheet added post-Cycle-0a as a one-off
 * primitive carve-out for the brand-switcher dropdown UX (where bottom
 * Sheet + centered Modal both felt wrong). Kit closure rule still applies:
 * no further primitives without orchestrator approval + DEC entry.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  BackHandler,
  Dimensions,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  blurIntensity as blurIntensityTokens,
  glass,
  radius as radiusTokens,
  shadows,
  spacing,
} from "../../constants/designSystem";

// Inline glass-stack — mirrors GlassChrome's L1-L4 visual layers but with
// each layer absolute-filled at the panel level so heights are
// panel-driven, not content-driven (GlassChrome's content-driven sizing
// breaks when used as a background-only layer — see D-IMPL-44).
const FALLBACK_BACKGROUND = "rgba(20, 22, 26, 0.92)";

const supportsBackdropFilter: boolean =
  Platform.OS === "web" &&
  typeof globalThis !== "undefined" &&
  typeof (globalThis as { CSS?: { supports?: (prop: string, value: string) => boolean } }).CSS?.supports === "function" &&
  ((globalThis as { CSS?: { supports?: (prop: string, value: string) => boolean } }).CSS!.supports!("backdrop-filter", "blur(10px)") ||
    (globalThis as { CSS?: { supports?: (prop: string, value: string) => boolean } }).CSS!.supports!("-webkit-backdrop-filter", "blur(10px)"));

// iOS uses real UIVisualEffectView blur. Web uses CSS backdrop-filter when
// supported. Android's expo-blur backdrop is too thin to read against busy
// content (renders near-transparent), so we route Android to the same solid
// fallback the web path uses when backdrop-filter is unavailable.
const shouldUseRealBlur = (): boolean => {
  if (Platform.OS === "ios") return true;
  if (Platform.OS === "android") return false;
  return supportsBackdropFilter;
};

export interface TopSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Tap on scrim closes. Default `true`. */
  dismissOnScrimTap?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const ENTRY_DURATION = 280;
const EXIT_DURATION = 240;
const SCRIM_DURATION = 220;
const SCRIM_COLOR = "rgba(0, 0, 0, 0.5)";
const UNMOUNT_DELAY_MS = 280;
const PANEL_HEIGHT_RATIO = 0.7;
const TOPBAR_OFFSET = 76; // insets.top + this = anchor (topbar bottom + small gap)
const PANEL_HORIZONTAL_INSET = spacing.md; // matches topbar's barWrap padding
const CLOSE_THRESHOLD_PX = 80;
const CLOSE_VELOCITY = 600;

export const TopSheet: React.FC<TopSheetProps> = ({
  visible,
  onClose,
  children,
  dismissOnScrimTap = true,
  testID,
  style,
}) => {
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get("window").height;
  const panelHeight = screenHeight * PANEL_HEIGHT_RATIO;
  const panelTop = insets.top + TOPBAR_OFFSET;
  const closedY = -panelHeight; // hidden above its anchor (slid up behind topbar)
  const openY = 0;

  const [mounted, setMounted] = useState<boolean>(visible);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const translateY = useSharedValue(closedY);
  const scrimOpacity = useSharedValue(0);
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
      scrimOpacity.value = withTiming(1, {
        duration: SCRIM_DURATION,
        easing: Easing.out(Easing.cubic),
      });
      if (reduceMotion) {
        translateY.value = openY;
      } else {
        translateY.value = withTiming(openY, {
          duration: ENTRY_DURATION,
          easing: Easing.out(Easing.cubic),
        });
      }
    } else {
      scrimOpacity.value = withTiming(0, {
        duration: SCRIM_DURATION,
        easing: Easing.in(Easing.cubic),
      });
      if (reduceMotion) {
        translateY.value = closedY;
      } else {
        translateY.value = withTiming(closedY, {
          duration: EXIT_DURATION,
          easing: Easing.in(Easing.cubic),
        });
      }
    }
  }, [closedY, openY, reduceMotion, scrimOpacity, translateY, visible]);

  useEffect(() => {
    return (): void => {
      cancelAnimation(translateY);
      cancelAnimation(scrimOpacity);
    };
  }, [scrimOpacity, translateY]);

  // Web Escape key
  useEffect(() => {
    if (Platform.OS !== "web" || !visible) return;
    const docLike = globalThis as unknown as {
      document?: {
        addEventListener: (
          type: string,
          listener: (event: { key: string }) => void,
        ) => void;
        removeEventListener: (
          type: string,
          listener: (event: { key: string }) => void,
        ) => void;
      };
    };
    if (docLike.document === undefined) return;
    const handler = (event: { key: string }): void => {
      if (event.key === "Escape") onClose();
    };
    docLike.document.addEventListener("keydown", handler);
    return (): void => {
      docLike.document!.removeEventListener("keydown", handler);
    };
  }, [onClose, visible]);

  // Android hardware back
  useEffect(() => {
    if (Platform.OS !== "android" || !visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return (): void => sub.remove();
  }, [onClose, visible]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: scrimOpacity.value,
  }));

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      // Allow upward drag only (swipe-up to dismiss).
      if (event.translationY < 0) {
        translateY.value = event.translationY;
      }
    })
    .onEnd((event) => {
      const shouldClose =
        event.translationY < -CLOSE_THRESHOLD_PX ||
        event.velocityY < -CLOSE_VELOCITY;
      if (shouldClose) {
        runOnJS(onClose)();
      } else {
        translateY.value = withTiming(openY, {
          duration: 200,
          easing: Easing.out(Easing.cubic),
        });
      }
    });

  const handleScrimPress = (): void => {
    if (dismissOnScrimTap) onClose();
  };

  if (!mounted) return null;

  const handleAreaHeight = HANDLE_AREA_HEIGHT;
  const bodyHeight = panelHeight - handleAreaHeight;
  const blurOk = shouldUseRealBlur();
  const blurIntensity = blurIntensityTokens.cardElevated;

  return (
    <View
      pointerEvents={visible ? "auto" : "none"}
      style={StyleSheet.absoluteFill}
      testID={testID}
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: SCRIM_COLOR },
          scrimStyle,
        ]}
      >
        <Pressable
          style={styles.scrimPress}
          onPress={handleScrimPress}
          accessibilityLabel="Dismiss sheet"
          accessibilityRole="button"
        />
      </Animated.View>
      <View
        style={[
          styles.anchor,
          {
            top: panelTop,
            marginHorizontal: PANEL_HORIZONTAL_INSET,
          },
        ]}
        pointerEvents="box-none"
      >
        <GestureDetector gesture={panGesture}>
          <Animated.View
            style={[
              styles.panel,
              { height: panelHeight },
              shadows.glassCardElevated,
              panelStyle,
              style,
            ]}
          >
            {/* L1 — Blur base */}
            {blurOk ? (
              <BlurView
                intensity={blurIntensity}
                tint="dark"
                style={StyleSheet.absoluteFill}
              />
            ) : (
              <View
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: FALLBACK_BACKGROUND },
                ]}
              />
            )}
            {/* L2 — Tint floor */}
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: glass.tint.profileElevated },
              ]}
            />
            {/* L3 — Top edge highlight */}
            <View
              style={[
                styles.topHighlight,
                { backgroundColor: glass.highlight.profileElevated },
              ]}
            />
            {/* L4 — Hairline border */}
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  borderRadius: radiusTokens.xl,
                  borderColor: glass.border.profileElevated,
                  borderWidth: StyleSheet.hairlineWidth,
                },
              ]}
              pointerEvents="none"
            />
            {/* Content layer — explicit height, layered above the visual stack */}
            <View style={[styles.body, { height: bodyHeight }]}>{children}</View>
            <View style={[styles.handleWrap, { height: handleAreaHeight }]}>
              <View style={styles.handle} />
            </View>
          </Animated.View>
        </GestureDetector>
      </View>
    </View>
  );
};

const HANDLE_AREA_HEIGHT = 24;

const styles = StyleSheet.create({
  scrimPress: {
    flex: 1,
  },
  anchor: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  panel: {
    width: "100%",
    borderRadius: radiusTokens.xl,
    // Clip child content + visual layers to the rounded panel shape.
    overflow: "hidden",
  },
  topHighlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  body: {
    width: "100%",
  },
  handleWrap: {
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: glass.border.pending,
  },
});

export default TopSheet;
