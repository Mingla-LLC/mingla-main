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
// ORCH-1165: Modal inputs (e.g. CancelOrderDialog) live in this Modal's own
// native window — mount a Done bar inside RNModal so they get the toolbar too.
import { KeyboardToolbarRoot } from "../../wrappers/KeyboardToolbarRoot";
// ORCH-1170: the ORCH-1165 toolbar above mounted inside RNModal's native window
// but received NO keyboard frames — react-native-keyboard-controller's
// KeyboardToolbar/KeyboardStickyView only animate when a KeyboardProvider lives
// in their OWN native window, and the app-root provider (KeyboardRoot in
// app/_layout.tsx) does NOT propagate into a RN Modal window. Wrap the Modal
// content in its own KeyboardProvider so the dialog's inputs + the Done bar
// share one provider scoped to this window. KeyboardRoot is the web-split
// wrapper (native = <KeyboardProvider>, web = passthrough) — keeps the library
// import out of the web bundle exactly like the app-root mount.
import { KeyboardRoot } from "../../wrappers/KeyboardRoot";

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

// ORCH-1136 R3: dispatcher. Web renders the compositor-CSS-transition variant
// (ModalWeb — zero reanimated hooks); native renders the byte-identical
// reanimated variant (ModalNative). Each variant calls ONLY its own hooks.
export const Modal: React.FC<ModalProps> = (props) => {
  if (Platform.OS === "web") {
    return <ModalWeb {...props} />;
  }
  return <ModalNative {...props} />;
};

const ModalNative: React.FC<ModalProps> = ({
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
      {/* ORCH-1170: KeyboardProvider scoped to THIS RNModal's native window so
          the Done bar below actually receives keyboard frames here (the
          app-root provider does not reach into a separate RN Modal window).
          Wraps the whole panel so the dialog's inputs + the toolbar share one
          provider. */}
      <KeyboardRoot>
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
          {/* ORCH-1165: Done bar for Modal-hosted inputs (CancelOrderDialog,
              future Modal forms) — last overlay child inside RNModal so it
              floats on the keyboard above the panel. Native-only (null on web).
              ORCH-1170: now inside the per-window KeyboardProvider above. */}
          <KeyboardToolbarRoot />
        </View>
      </KeyboardRoot>
    </RNModal>
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
 * ORCH-1136 R3 — WEB variant of Modal.
 *
 * Drives open/close with a COMPOSITOR CSS transition on `opacity` +
 * `transform: scale(...)` instead of the JS-main-thread reanimated rAF
 * (withTiming on panelScale/panelOpacity/scrimOpacity), which freezes mid-anim
 * under a heavy-page long task on web (F-1/F-2 — a ConfirmDialog over a busy
 * wizard). Open: 200ms ease-out-cubic; close: 160ms ease-in-cubic (matching
 * native ENTRY_DURATION/EXIT_DURATION). Reduce-motion: opacity-only (scale 1).
 *
 * Calls ZERO reanimated hooks. Animates transform/opacity ONLY.
 */
const MODAL_OPEN_EASE_CSS = "cubic-bezier(0.33, 1, 0.68, 1)"; // Easing.out(cubic)
const MODAL_CLOSE_EASE_CSS = "cubic-bezier(0.33, 0, 0.67, 1)"; // Easing.in(cubic)

const ModalWeb: React.FC<ModalProps> = ({
  visible,
  onClose,
  children,
  maxWidth = 480,
  dismissOnScrimTap = true,
  testID,
  style,
}) => {
  const [mounted, setMounted] = useState<boolean>(visible);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduceMotion = useWebReducedMotion();

  const [animateOpen, setAnimateOpen] = useState<boolean>(false);
  const rafRef = useRef<number | null>(null);

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

  // Web Escape-key handler.
  useEffect(() => {
    if (!visible) return;
    const docLike = globalThis as unknown as {
      document?: {
        addEventListener: (type: string, listener: (event: { key: string }) => void) => void;
        removeEventListener: (type: string, listener: (event: { key: string }) => void) => void;
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

  const handleScrimPress = (): void => {
    if (dismissOnScrimTap) onClose();
  };

  if (!mounted) return null;

  const dur = animateOpen ? ENTRY_DURATION : EXIT_DURATION;
  const ease = animateOpen ? MODAL_OPEN_EASE_CSS : MODAL_CLOSE_EASE_CSS;
  const scrimWebStyle = {
    transition: `opacity ${dur}ms ${ease}`,
    opacity: animateOpen ? 1 : 0,
    willChange: "opacity",
  } as unknown as ViewStyle;
  const panelWebStyle = {
    transition: reduceMotion
      ? `opacity ${dur}ms ${ease}`
      : `opacity ${dur}ms ${ease}, transform ${dur}ms ${ease}`,
    opacity: animateOpen ? 1 : 0,
    transform: reduceMotion ? "scale(1)" : animateOpen ? "scale(1)" : "scale(0.96)",
    willChange: "transform",
  } as unknown as ViewStyle;

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
        <View style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM_COLOR }, scrimWebStyle]}>
          <Pressable
            style={styles.scrimPress}
            onPress={handleScrimPress}
            accessibilityLabel="Dismiss modal"
            accessibilityRole="button"
          />
        </View>
        <View style={styles.center} pointerEvents="box-none">
          <View style={[styles.panelWrap, { maxWidth }, panelWebStyle, style]}>
            <GlassCard variant="elevated" radius="xl" padding={spacing.lg}>
              {children}
            </GlassCard>
          </View>
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
