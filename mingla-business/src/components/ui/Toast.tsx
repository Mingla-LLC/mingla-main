/**
 * Toast — top-of-screen notification banner.
 *
 * 4 kinds (success / info / warn / error). Auto-dismiss timing per kind:
 * success/info 2600ms, warn 6000ms, error persistent (caller must close).
 *
 * Slide-down + opacity entrance 220ms `easings.out`; exit 160ms
 * `easings.in`. Reduce-motion fallback: opacity-only.
 *
 * # Self-positioning portal (revised 2026-05-02)
 *
 * Toast self-positions at the TOP of the screen via a native `<Modal>`
 * portal (mirrors Sheet primitive's DEC-085 portal pattern). Anchored
 * `top: insets.top + spacing.sm` below the safe-area inset. ALL toasts
 * across the app behave uniformly — top-anchored, full-width with
 * max-width 480, slides down from above into view.
 *
 * Callers no longer need a `toastWrap` View. Just render `<Toast
 * visible kind message onDismiss />` anywhere in the tree — it portals
 * to the OS-level root window and positions itself.
 *
 * Old `toastWrap` Views in call sites are NO-OPS (Toast escapes the
 * parent's coordinate space via Modal). Cleaning them up is housekeeping
 * — leaving them in place doesn't break anything.
 *
 * # Visual contract (revised 2026-05-02)
 *
 * Orange glass-liquid for success / info / warn (Mingla brand-prominent
 * surface — high contrast against dark app chrome). Red glass-liquid for
 * error (preserves emergency semantic). 5-layer glass stack composed
 * inline (BlurView + tint floor + top-edge highlight + warm border +
 * drop shadow). Taller body (paddingVertical = spacing.md + 2) for
 * legibility. Icon in a 32px filled circle on the left, message in
 * primary white text at body fontSize.
 */

import React, { useEffect, useRef, useState } from "react";
import { Modal, Platform, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { BlurView } from "expo-blur";

import {
  blurIntensity as blurIntensityTokens,
  radius as radiusTokens,
  shadows,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export type ToastKind = "success" | "error" | "warn" | "info";

export interface ToastProps {
  visible: boolean;
  kind: ToastKind;
  message: string;
  onDismiss: () => void;
  testID?: string;
  /** Optional override on the Animated.View wrap. Rarely needed — Toast self-positions. */
  style?: StyleProp<ViewStyle>;
}

const ENTRY_DURATION = 220;
const EXIT_DURATION = 160;
const TRANSLATE_FROM = -40;
const UNMOUNT_DELAY_MS = EXIT_DURATION + 40; // exit anim + safety

// Glass tokens — composed inline. Warm = Mingla brand prominence; Red =
// emergency reserved for errors.
const WARM_TINT = "rgba(235, 120, 37, 0.32)";
const WARM_BORDER = "rgba(235, 120, 37, 0.55)";
const WARM_HIGHLIGHT = "rgba(255, 178, 110, 0.45)";
const WARM_ICON_BG = "rgba(235, 120, 37, 0.85)";

const ERROR_TINT = "rgba(239, 68, 68, 0.30)";
const ERROR_BORDER = "rgba(239, 68, 68, 0.55)";
const ERROR_HIGHLIGHT = "rgba(255, 138, 138, 0.45)";
const ERROR_ICON_BG = "rgba(239, 68, 68, 0.85)";

interface KindTokens {
  icon: IconName;
  tint: string;
  border: string;
  highlight: string;
  iconBg: string;
}

const KIND_TOKENS: Record<ToastKind, KindTokens> = {
  success: {
    icon: "check",
    tint: WARM_TINT,
    border: WARM_BORDER,
    highlight: WARM_HIGHLIGHT,
    iconBg: WARM_ICON_BG,
  },
  info: {
    icon: "bell",
    tint: WARM_TINT,
    border: WARM_BORDER,
    highlight: WARM_HIGHLIGHT,
    iconBg: WARM_ICON_BG,
  },
  warn: {
    icon: "flag",
    tint: WARM_TINT,
    border: WARM_BORDER,
    highlight: WARM_HIGHLIGHT,
    iconBg: WARM_ICON_BG,
  },
  error: {
    icon: "close",
    tint: ERROR_TINT,
    border: ERROR_BORDER,
    highlight: ERROR_HIGHLIGHT,
    iconBg: ERROR_ICON_BG,
  },
};

const AUTO_DISMISS: Record<ToastKind, number | null> = {
  success: 2600,
  info: 2600,
  warn: 6000,
  error: null,
};

// Web backdrop-filter detection (mirrors GlassChrome pattern).
const supportsBackdropFilter: boolean =
  Platform.OS === "web" &&
  typeof globalThis !== "undefined" &&
  typeof (globalThis as { CSS?: { supports?: (prop: string, value: string) => boolean } }).CSS?.supports === "function" &&
  ((globalThis as { CSS?: { supports?: (prop: string, value: string) => boolean } }).CSS!.supports!("backdrop-filter", "blur(10px)") ||
    (globalThis as { CSS?: { supports?: (prop: string, value: string) => boolean } }).CSS!.supports!("-webkit-backdrop-filter", "blur(10px)"));

const blurOk = Platform.OS !== "web" || supportsBackdropFilter;

const FALLBACK_BACKGROUND = "rgba(20, 22, 26, 0.92)";

export const Toast: React.FC<ToastProps> = ({
  visible,
  kind,
  message,
  onDismiss,
  testID,
  style,
}) => {
  const insets = useSafeAreaInsets();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(TRANSLATE_FROM);
  const reduceMotion = useReducedMotion();

  // Lazy mount/unmount via Modal — keep Toast in the tree long enough for
  // exit animation to finish, then unmount. Mirrors Sheet primitive
  // (DEC-085 portal pattern).
  const [mounted, setMounted] = useState<boolean>(visible);
  const unmountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      if (unmountTimerRef.current !== null) {
        clearTimeout(unmountTimerRef.current);
        unmountTimerRef.current = null;
      }
    } else if (mounted) {
      unmountTimerRef.current = setTimeout(() => {
        setMounted(false);
        unmountTimerRef.current = null;
      }, UNMOUNT_DELAY_MS);
    }
    return (): void => {
      if (unmountTimerRef.current !== null) {
        clearTimeout(unmountTimerRef.current);
        unmountTimerRef.current = null;
      }
    };
  }, [mounted, visible]);

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, {
        duration: ENTRY_DURATION,
        easing: Easing.out(Easing.cubic),
      });
      if (!reduceMotion) {
        translateY.value = withTiming(0, {
          duration: ENTRY_DURATION,
          easing: Easing.out(Easing.cubic),
        });
      } else {
        translateY.value = 0;
      }
    } else {
      opacity.value = withTiming(0, {
        duration: EXIT_DURATION,
        easing: Easing.in(Easing.cubic),
      });
      if (!reduceMotion) {
        translateY.value = withTiming(TRANSLATE_FROM, {
          duration: EXIT_DURATION,
          easing: Easing.in(Easing.cubic),
        });
      }
    }
  }, [opacity, reduceMotion, translateY, visible]);

  useEffect(() => {
    if (!visible) return;
    const ms = AUTO_DISMISS[kind];
    if (ms === null) return;
    const timer = setTimeout(onDismiss, ms);
    return (): void => clearTimeout(timer);
  }, [kind, onDismiss, visible]);

  useEffect(() => {
    return (): void => {
      cancelAnimation(opacity);
      cancelAnimation(translateY);
    };
  }, [opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  if (!mounted) return null;

  const tokens = KIND_TOKENS[kind];
  const topInset = insets.top > 0 ? insets.top : spacing.md;

  return (
    <Modal
      transparent
      visible
      animationType="none"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      {/* Portal root — full screen but pointerEvents box-none so taps
          pass through to underlying UI when Toast doesn't intercept. */}
      <View style={styles.portalRoot} pointerEvents="box-none">
        <Animated.View
          pointerEvents={visible ? "auto" : "none"}
          style={[
            styles.wrap,
            { top: topInset + spacing.sm },
            animatedStyle,
            style,
          ]}
          testID={testID}
        >
          <View style={[styles.card, shadows.glassCardElevated]}>
            {/* L1 — Blur base (or solid fallback on web w/o backdrop-filter) */}
            {blurOk ? (
              <BlurView
                intensity={blurIntensityTokens.cardElevated}
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

            {/* L2 — Warm/error tint floor */}
            <View
              style={[StyleSheet.absoluteFill, { backgroundColor: tokens.tint }]}
            />

            {/* L3 — Top-edge highlight (1px liquid sparkle) */}
            <View
              style={[styles.topHighlight, { backgroundColor: tokens.highlight }]}
              pointerEvents="none"
            />

            {/* L4 — Hairline border */}
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  borderRadius: radiusTokens.lg,
                  borderColor: tokens.border,
                  borderWidth: 1,
                },
              ]}
              pointerEvents="none"
            />

            {/* Content row — icon badge + message */}
            <View style={styles.body}>
              <View style={[styles.iconBadge, { backgroundColor: tokens.iconBg }]}>
                <Icon name={tokens.icon} size={18} color="#ffffff" />
              </View>
              <Text style={styles.message} numberOfLines={3}>
                {message}
              </Text>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  portalRoot: {
    flex: 1,
  },
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignSelf: "center",
    width: "100%",
    maxWidth: 480,
    paddingHorizontal: spacing.md,
    // Centers within parent — left:0/right:0 + maxWidth + alignSelf
    // align horizontally to viewport.
    alignItems: "stretch",
  },
  card: {
    position: "relative",
    overflow: "hidden",
    borderRadius: radiusTokens.lg,
    minHeight: 64,
  },
  topHighlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  body: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md + 2,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  message: {
    flex: 1,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "500",
  },
});

export default Toast;
