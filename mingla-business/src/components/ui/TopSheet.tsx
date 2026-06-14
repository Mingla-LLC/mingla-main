/**
 * TopSheet — top-anchored drop-down panel.
 *
 * Slides down from below the topbar to its open position. Internal scroll
 * for content with a pinned footer. Swipe-up to dismiss; tap scrim to
 * dismiss; web Escape and Android hardware back also close.
 *
 * Geometry (per Cycle 1 spec lock-in + ORCH-0826 compact-mode extension):
 *   - Anchored below the topbar: `top = insets.top + TOPBAR_OFFSET`. Topbar
 *     stays visible (drop-down "issues" from the chip vertically).
 *   - Width matches the topbar: `marginHorizontal: spacing.md`. Visual
 *     consistency with the chrome above.
 *   - Two height modes (per `heightMode` prop):
 *     - `"fixed-70"` (default) — 70% of screen height; content scrolls
 *       internally with a pinned footer. Brand switcher behavior.
 *     - `"compact"` — content-measured height via onLayout. Suitable for
 *       short fixed-row sheets (UniversalCreatorSheet's 3-option picker).
 *
 * Animations:
 *   - Open: scrim fade in 220ms; panel translateY from `-panelHeight` to
 *           `0` over 280ms (`easings.out`). Panel slides DOWN from behind
 *           the topbar to its anchor.
 *   - Close: scrim fade out 220ms; panel translateY from `0` to
 *            `-panelHeight` over 240ms (`easings.in`). Panel slides UP back
 *            behind the topbar — same motion as the user's swipe.
 *   - Reduce-motion: opacity-only fade (no translate).
 *   - Compact mode: panel renders invisibly at height 0 until first onLayout
 *     measurement; then animates from `-measuredHeight` to `0` on next open.
 *
 * Lazy-mount per E.4 — returns null when not mounted, schedules unmount
 * 280ms after `visible` flips false (matches exit anim + 40ms safety).
 *
 * Caller MUST wrap the app root in `GestureHandlerRootView` (already done
 * in `app/_layout.tsx` for Sheet primitive — same dependency).
 *
 * Kit extensions:
 *   - DEC-080 — TopSheet added post-Cycle-0a as a one-off primitive carve-out
 *     for the brand-switcher dropdown UX (where bottom Sheet + centered Modal
 *     both felt wrong).
 *   - DEC-NEW-A (ORCH-0826) — TopSheet usage extended to UniversalCreatorSheet.
 *     Two acceptable consumers now: BrandSwitcherSheet + UniversalCreatorSheet.
 *     Future additional consumers still require orchestrator approval + DEC entry.
 *   - DEC-NEW-B (ORCH-0826) — `heightMode="compact"` mode added. Additive prop;
 *     existing consumers default to `"fixed-70"` and stay unchanged.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  BackHandler,
  Dimensions,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import type { LayoutChangeEvent, StyleProp, ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { Gesture } from "react-native-gesture-handler";
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

import { WebSafeGestureDetector } from "./WebSafeGestureDetector";
import { shouldUseRealBlur } from "../../utils/glassBlur";

// Inline glass-stack — mirrors GlassChrome's L1-L4 visual layers but with
// each layer absolute-filled at the panel level so heights are
// panel-driven, not content-driven (GlassChrome's content-driven sizing
// breaks when used as a background-only layer — see D-IMPL-44).
const FALLBACK_BACKGROUND = "rgba(20, 22, 26, 0.92)";

export type TopSheetHeightMode = "fixed-70" | "compact";

export interface TopSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Tap on scrim closes. Default `true`. */
  dismissOnScrimTap?: boolean;
  /**
   * Panel height mode (ORCH-0826).
   *   - `"fixed-70"` (default) — panel fills 70% of screen height; content
   *     scrolls internally with a pinned footer. Backwards-compatible with
   *     existing BrandSwitcherSheet usage.
   *   - `"compact"` — panel height fits content via `onLayout` measurement.
   *     Suitable for short fixed-row sheets (e.g., UniversalCreatorSheet's
   *     3-option picker). Panel renders invisibly until first measurement;
   *     animations use the measured height.
   *
   * Per DEC-NEW-B (ORCH-0826) — additive prop, fully backwards compatible.
   */
  heightMode?: TopSheetHeightMode;
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
  heightMode = "fixed-70",
  testID,
  style,
}) => {
  const insets = useSafeAreaInsets();
  // ORCH-1136 R2: reverted the round-1 F-3 live-window-height web split. The
  // panel height uses the original `Dimensions.get('window').height` snapshot
  // on ALL platforms (native byte-identical to pre-round-1; removes the
  // round-1 mobile-web URL-bar short-panel contributor). `windowWidth` below
  // is still consumed by `shouldUseRealBlur(windowWidth)` (ORCH-1100).
  const screenHeight = Dimensions.get("window").height;
  // ORCH-1100: width-aware so the mobile-web (< 768px) blur-kill triggers the
  // opaque fallback (the brand-switcher TopSheet was the worst RC-2 offender —
  // it rendered `background-color: rgba(0,0,0,0)` on phone web).
  const { width: windowWidth } = useWindowDimensions();

  // ORCH-0826: heightMode="compact" uses content-measured height via
  // onLayout. Before first measurement, panel renders invisibly (opacity 0)
  // at height 0; after measurement, animations use the measured height.
  // heightMode="fixed-70" (default) preserves Brand Switcher's 70% behavior.
  const [measuredCompactHeight, setMeasuredCompactHeight] = useState<number | null>(null);
  const fixedHeight = screenHeight * PANEL_HEIGHT_RATIO;
  const panelHeight =
    heightMode === "compact"
      ? (measuredCompactHeight ?? 0)
      : fixedHeight;

  const handleCompactLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      if (heightMode !== "compact") return;
      const contentHeight = event.nativeEvent.layout.height;
      if (contentHeight <= 0) return;
      // Add handle area to total panel height
      const total = contentHeight + HANDLE_AREA_HEIGHT;
      setMeasuredCompactHeight((prev) => {
        if (prev !== null && Math.abs(prev - total) < 1) return prev;
        return total;
      });
    },
    [heightMode],
  );

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

  // ORCH-0826: in compact mode, hide the panel until first measurement
  // completes so the open animation doesn't snap from height-0 to measured.
  const compactInvisible = heightMode === "compact" && measuredCompactHeight === null;

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
  const blurOk = shouldUseRealBlur(windowWidth);
  const blurIntensity = blurIntensityTokens.cardElevated;

  // ORCH-1136 R2: the overlay root is bare `StyleSheet.absoluteFill`
  // (position:absolute) on ALL platforms. The round-1 web `position:'fixed'`
  // split was a REGRESSION — `position:'fixed'` is captured by ANY ancestor
  // with transform/filter/backdrop-filter/will-change/contain/perspective in
  // the real Home/Hub shell, collapsing the scrim (see-through) and short-
  // anchoring the panel (harness-proven `drive4.mjs`). `position:absolute` is
  // immune to those ancestors and is harness-proven correct on Home AND Hub
  // under the real expo-router `body{overflow:hidden}` reset (the page never
  // document-scrolls, so the round-1 "scrolled host offset" premise was
  // physically impossible). `position:'fixed'` is BANNED on this overlay root
  // (invariant I-PROPOSED-TOPSHEET-WEB-OVERLAY-NO-FIXED).
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
        <WebSafeGestureDetector gesture={panGesture}>
          <Animated.View
            style={[
              styles.panel,
              // Compact mode pre-measurement: render with NATURAL height (no
              // explicit `height` style) + opacity 0 so children can lay out
              // freely and `onLayout` reports their true height. Earlier
              // attempt set `height: 0` here which clipped children to 0 and
              // produced a permanent height=0 measurement (chicken-and-egg).
              // Post-measurement: explicit measured height + opacity 1 for
              // normal animation. Fixed-70 mode: explicit height always.
              heightMode === "compact"
                ? compactInvisible
                  ? { opacity: 0 }
                  : { height: panelHeight, opacity: 1 }
                : { height: panelHeight },
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
            {/* Content layer.
                - fixed-70 mode: explicit body height (panelHeight - handle).
                - compact mode: content-driven; onLayout measures children
                  height into measuredCompactHeight. */}
            <View
              style={[
                styles.body,
                heightMode === "compact" ? null : { height: bodyHeight },
              ]}
              onLayout={heightMode === "compact" ? handleCompactLayout : undefined}
            >
              {children}
            </View>
            <View style={[styles.handleWrap, { height: handleAreaHeight }]}>
              <View style={styles.handle} />
            </View>
          </Animated.View>
        </WebSafeGestureDetector>
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
