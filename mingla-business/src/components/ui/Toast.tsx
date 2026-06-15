/**
 * Toast — top-of-screen notification banner.
 *
 * 4 kinds (success / info / warn / error). Auto-dismiss timing per kind:
 * success/info 2600ms, warn 6000ms, error 12000ms (bounded fallback).
 *
 * Slide-down + opacity entrance 220ms `easings.out`; exit 160ms
 * `easings.in`. Reduce-motion fallback: opacity-only.
 *
 * # Dismissal affordances (canonical for the entire app — ORCH-0821 rework)
 *
 * Every Toast in mingla-business is dismissible four ways:
 *   1. Tap anywhere on the card (Pressable onPress)
 *   2. Tap the explicit close (×) button (32×32 with hitSlop=12 → 56×56 hit)
 *   3. Swipe UP — drag the toast upward past 40pt OR fling it with
 *      velocityY < -500. Pan follows the finger with light resistance,
 *      rubber-bands on pull-down. Pan only activates after 8pt of vertical
 *      movement, so a static tap is never misread as a swipe. Horizontal
 *      swipes past 24pt cancel the pan gesture entirely.
 *   4. Auto-dismiss timer (per-kind default; nullable per-instance)
 *
 * This is THE canonical toast for the app — any new notification UX uses
 * this primitive. Do not build custom error banners. (ErrorBanner in the
 * Ari surface was migrated to this Toast on 2026-05-12.)
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

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
  Gesture,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import { BlurView } from "expo-blur";

import {
  blurIntensity as blurIntensityTokens,
  radius as radiusTokens,
  shadows,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

import { WebSafeGestureDetector } from "./WebSafeGestureDetector";
import { shouldUseRealBlur } from "../../utils/glassBlur";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { AUTO_DISMISS, type ToastKind } from "./toastTimings";

export type { ToastKind };

export interface ToastProps {
  visible: boolean;
  kind: ToastKind;
  message: string;
  onDismiss: () => void;
  testID?: string;
  /** Optional override on the Animated.View wrap. Rarely needed — Toast self-positions. */
  style?: StyleProp<ViewStyle>;
  /**
   * ORCH-0789: optional per-instance override for auto-dismiss timing (ms).
   * Default per kind: success/info = 2600, warn = 6000, error = 12000.
   * Pass `null` to disable auto-dismiss for this instance — only valid for
   * callers that guarantee an external dismiss path. Error toasts MUST stay
   * user-dismissible (close icon + tap-to-dismiss are always rendered).
   */
  autoDismissMs?: number | null;
}

const ENTRY_DURATION = 220;
const EXIT_DURATION = 160;
const TRANSLATE_FROM = -40;
const UNMOUNT_DELAY_MS = EXIT_DURATION + 40; // exit anim + safety
// Swipe-to-dismiss thresholds — match the Sheet primitive's UX feel.
const SWIPE_DISMISS_DISTANCE = 40;      // pt past the resting position
const SWIPE_DISMISS_VELOCITY = 500;     // pt/s upward velocity
const SWIPE_FOLLOW_RESISTANCE = 0.6;    // 1.0 = follow finger 1:1 upward
const SWIPE_DOWNWARD_RESISTANCE = 0.25; // rubber-band on pull-down

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

// ORCH-0789: AUTO_DISMISS lives in toastTimings.ts so the
// I-PROPOSED-ERROR-TOAST-DISMISSIBLE invariant can be unit-tested
// without mounting the full RN render tree. error: 12000 — bounded
// fallback paired with the close icon + tap-anywhere affordances below
// so an error toast can never strand a buyer.

// META-ORCH-1002 Sub-D / ORCH-1100: glass blur fallback decision is now
// centralized in `utils/glassBlur.shouldUseRealBlur(windowWidth)`. iOS uses real
// UIVisualEffectView blur; Android's expo-blur backdrop renders near-transparent
// against busy content → solid `FALLBACK_BACKGROUND`; web uses real blur only
// when backdrop-filter is supported AND the viewport is wide enough to be above
// the mobile-web (< 768px) blur-kill media rule. Computed per-render (not at
// module scope) so the width is live.
const FALLBACK_BACKGROUND = "rgba(20, 22, 26, 0.92)";

// ORCH-1136 R3: dispatcher. Web renders the compositor-CSS-transition variant
// (ToastWeb — zero reanimated hooks, no pan gesture since it's a no-op on web);
// native renders the byte-identical reanimated variant (ToastNative, incl.
// swipeOffset + the Android pan-freeze fix). Each variant calls ONLY its own
// hooks.
export const Toast: React.FC<ToastProps> = (props) => {
  if (Platform.OS === "web") {
    return <ToastWeb {...props} />;
  }
  return <ToastNative {...props} />;
};

const ToastNative: React.FC<ToastProps> = ({
  visible,
  kind,
  message,
  onDismiss,
  testID,
  style,
  autoDismissMs,
}) => {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  // ORCH-1100: width-aware so the mobile-web (< 768px) blur-kill paints the
  // opaque fallback instead of a see-through toast card.
  const blurOk = shouldUseRealBlur(windowWidth);
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(TRANSLATE_FROM);
  // Independent shared value for swipe drag offset — added to translateY at render.
  const swipeOffset = useSharedValue(0);
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
    // ORCH-0789: per-instance autoDismissMs overrides per-kind default;
    // null explicitly disables auto-dismiss for that one instance.
    const ms = autoDismissMs === undefined ? AUTO_DISMISS[kind] : autoDismissMs;
    if (ms === null) return;
    const timer = setTimeout(onDismiss, ms);
    return (): void => clearTimeout(timer);
  }, [autoDismissMs, kind, onDismiss, visible]);

  useEffect(() => {
    return (): void => {
      cancelAnimation(opacity);
      cancelAnimation(translateY);
      cancelAnimation(swipeOffset);
    };
  }, [opacity, swipeOffset, translateY]);

  // Reset swipe offset whenever a new toast becomes visible.
  useEffect(() => {
    if (visible) {
      swipeOffset.value = 0;
    }
  }, [swipeOffset, visible]);

  // Pan gesture — swipe up (or hard fling upward) to dismiss. Pull-down
  // is rubber-banded. Memoized so we don't rebuild the gesture object on
  // every render — Android's GestureHandler is sensitive to that.
  //
  // Dismiss behaviour: fire onDismiss() IMMEDIATELY on threshold met. The
  // parent flips visible→false; the standard exit useEffect runs the
  // opacity-out + slide-up; the swipeOffset stays at its release value so
  // the dismiss feels continuous from where the user let go. Doing this
  // synchronously (instead of running a 140ms timing animation before the
  // dismiss callback) is what stops the toast freezing half-way on
  // Android — the Modal unmounts on the standard schedule and pointer
  // events release cleanly.
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((event) => {
          "worklet";
          if (event.translationY < 0) {
            // Upward — follow with light resistance
            swipeOffset.value = event.translationY * SWIPE_FOLLOW_RESISTANCE;
          } else {
            // Downward — rubber band (heavy resistance)
            swipeOffset.value = event.translationY * SWIPE_DOWNWARD_RESISTANCE;
          }
        })
        .onEnd((event) => {
          "worklet";
          const shouldDismiss =
            event.translationY < -SWIPE_DISMISS_DISTANCE ||
            event.velocityY < -SWIPE_DISMISS_VELOCITY;
          if (shouldDismiss) {
            runOnJS(onDismiss)();
          } else {
            // Snap back to resting position with a soft spring.
            swipeOffset.value = withSpring(0, {
              damping: 18,
              stiffness: 220,
              mass: 0.8,
            });
          }
        })
        .activeOffsetY([-8, 8])
        .failOffsetX([-24, 24]),
    [onDismiss, swipeOffset],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value + swipeOffset.value }],
  }));

  if (!mounted) return null;

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
          pass through to underlying UI when Toast doesn't intercept.
          GestureHandlerRootView is REQUIRED here on Android: the app-root
          GestureHandlerRootView (mounted by expo-router) does NOT extend
          into Modal's window, so without this inner root the pan gesture
          on Android either no-ops OR freezes the entire screen because
          the gesture system thinks a pan is still in flight. */}
      <GestureHandlerRootView style={styles.portalRoot} pointerEvents="box-none">
        <WebSafeGestureDetector gesture={panGesture}>
          <Animated.View
            pointerEvents={visible ? "auto" : "none"}
            style={[
              styles.wrap,
              { top: topInset + spacing.sm },
              animatedStyle,
              style,
            ]}
            testID={testID}
            accessibilityHint="Swipe up or tap to dismiss"
          >
          <ToastCard
            kind={kind}
            message={message}
            onDismiss={onDismiss}
            blurOk={blurOk}
          />
          </Animated.View>
        </WebSafeGestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
};

/**
 * ORCH-1136 R3: shared toast card body (glass stack + content row). Identical
 * between web and native variants — only the animated wrapper differs (the
 * parent Animated.View vs the web CSS-transition View).
 */
interface ToastCardProps {
  kind: ToastKind;
  message: string;
  onDismiss: () => void;
  blurOk: boolean;
}

const ToastCard: React.FC<ToastCardProps> = ({ kind, message, onDismiss, blurOk }) => {
  const tokens = KIND_TOKENS[kind];
  return (
    // ORCH-0789: tap-anywhere-on-card dismisses. The inner close Pressable
    // below also calls onDismiss directly; onDismiss is idempotent.
    <Pressable
      onPress={onDismiss}
      accessibilityRole="button"
      accessibilityLabel="Dismiss notification"
      style={[styles.card, shadows.glassCardElevated]}
    >
      {/* L1 — Blur base (or solid fallback on web w/o backdrop-filter) */}
      {blurOk ? (
        <BlurView
          intensity={blurIntensityTokens.cardElevated}
          tint="dark"
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: FALLBACK_BACKGROUND }]}
        />
      )}

      {/* L2 — Warm/error tint floor */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: tokens.tint }]} />

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

      {/* Content row — icon badge + message + close button */}
      <View style={styles.body}>
        <View style={[styles.iconBadge, { backgroundColor: tokens.iconBg }]}>
          <Icon name={tokens.icon} size={18} color="#ffffff" />
        </View>
        <Text style={styles.message} numberOfLines={3}>
          {message}
        </Text>
        {/* ORCH-0789: explicit close affordance. 32×32 visible target
            with hitSlop 12 → 56×56 effective hit area (I-38). */}
        <Pressable
          onPress={onDismiss}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
          style={styles.closeButton}
        >
          <Icon name="close" size={16} color={textTokens.primary} />
        </Pressable>
      </View>
    </Pressable>
  );
};

// ORCH-1136 R3: web reduced-motion read (no reanimated hook on the web path).
const useWebReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState<boolean>(false);
  useEffect(() => {
    const mql = (
      globalThis as unknown as {
        matchMedia?: (q: string) => {
          matches: boolean;
          addEventListener?: (t: string, l: () => void) => void;
          removeEventListener?: (t: string, l: () => void) => void;
        };
      }
    ).matchMedia?.("(prefers-reduced-motion: reduce)");
    if (mql === undefined) return;
    setReduced(mql.matches);
    const onChange = (): void => setReduced(mql.matches);
    mql.addEventListener?.("change", onChange);
    return (): void => mql.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
};

/**
 * ORCH-1136 R3 — WEB variant of Toast.
 *
 * Drives entry/exit with a COMPOSITOR CSS transition on `transform:
 * translateY(...)` + `opacity` instead of the JS-main-thread reanimated rAF
 * (withTiming on translateY/opacity), which freezes mid-slide under a
 * heavy-page long task on web (F-1 — a success toast right after a save that
 * re-renders a heavy list). Entry: 220ms ease-out-cubic; exit: 160ms
 * ease-in-cubic (matching native ENTRY_DURATION/EXIT_DURATION). Reduce-motion:
 * opacity-only.
 *
 * The pan/swipe gesture is a no-op on web (WebSafeGestureDetector renders
 * children directly), so swipeOffset is always 0 on web and is dropped here —
 * the web variant animates translateY (entry/exit) only. Calls ZERO reanimated
 * hooks. Animates transform/opacity ONLY.
 */
const TOAST_OPEN_EASE_CSS = "cubic-bezier(0.33, 1, 0.68, 1)"; // Easing.out(cubic)
const TOAST_CLOSE_EASE_CSS = "cubic-bezier(0.33, 0, 0.67, 1)"; // Easing.in(cubic)

const ToastWeb: React.FC<ToastProps> = ({
  visible,
  kind,
  message,
  onDismiss,
  testID,
  style,
  autoDismissMs,
}) => {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const blurOk = shouldUseRealBlur(windowWidth);
  const reduceMotion = useWebReducedMotion();

  const [mounted, setMounted] = useState<boolean>(visible);
  const unmountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [animateOpen, setAnimateOpen] = useState<boolean>(false);
  const rafRef = useRef<number | null>(null);

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
    const cancelRaf = (): void => {
      if (rafRef.current !== null) {
        const caf = (globalThis as unknown as { cancelAnimationFrame?: (h: number) => void })
          .cancelAnimationFrame;
        caf?.(rafRef.current);
        rafRef.current = null;
      }
    };
    if (visible && mounted) {
      setAnimateOpen(false);
      const raf = (globalThis as unknown as { requestAnimationFrame?: (cb: () => void) => number })
        .requestAnimationFrame;
      if (raf !== undefined) {
        rafRef.current = raf(() => {
          rafRef.current = raf(() => setAnimateOpen(true));
        });
      } else {
        const t = setTimeout(() => setAnimateOpen(true), 0);
        return (): void => clearTimeout(t);
      }
    } else if (!visible) {
      cancelRaf();
      setAnimateOpen(false);
    }
    return cancelRaf;
  }, [visible, mounted]);

  useEffect(() => {
    if (!visible) return;
    const ms = autoDismissMs === undefined ? AUTO_DISMISS[kind] : autoDismissMs;
    if (ms === null) return;
    const timer = setTimeout(onDismiss, ms);
    return (): void => clearTimeout(timer);
  }, [autoDismissMs, kind, onDismiss, visible]);

  if (!mounted) return null;

  const topInset = insets.top > 0 ? insets.top : spacing.md;
  const dur = animateOpen ? ENTRY_DURATION : EXIT_DURATION;
  const ease = animateOpen ? TOAST_OPEN_EASE_CSS : TOAST_CLOSE_EASE_CSS;
  const wrapWebStyle = {
    transition: reduceMotion
      ? `opacity ${dur}ms ${ease}`
      : `transform ${dur}ms ${ease}, opacity ${dur}ms ${ease}`,
    transform: reduceMotion
      ? "translateY(0px)"
      : animateOpen
        ? "translateY(0px)"
        : `translateY(${TRANSLATE_FROM}px)`,
    opacity: animateOpen ? 1 : 0,
    willChange: "transform",
  } as unknown as ViewStyle;

  return (
    <Modal
      transparent
      visible
      animationType="none"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <View style={styles.portalRoot} pointerEvents="box-none">
        <View
          pointerEvents={visible ? "auto" : "none"}
          style={[styles.wrap, { top: topInset + spacing.sm }, wrapWebStyle, style]}
          testID={testID}
          accessibilityHint="Tap to dismiss"
        >
          <ToastCard
            kind={kind}
            message={message}
            onDismiss={onDismiss}
            blurOk={blurOk}
          />
        </View>
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
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
});

export default Toast;
