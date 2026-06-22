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
 *
 * # Overlay portal (Cycle 2 J-A8 polish — RC-1 fix)
 * Wrapped in React Native's native `Modal` component so the overlay
 * (scrim + panel) renders at the OS-level root window regardless of
 * where in the React tree the consumer mounts this Sheet. Without this
 * portal, `StyleSheet.absoluteFill` would resolve to the nearest
 * positioned ancestor — for consumers inside a ScrollView, that's the
 * ScrollView's content container (not the screen), causing the scrim
 * and bottomDock to anchor to invisible coordinates.
 *
 * If you remove the Modal wrapper, the Sheet will appear to "work"
 * for short forms (where contentContainer ≈ viewport) but will silently
 * break for long forms (BrandEditView, EventCreator, etc.). Always
 * keep the Modal wrapper. Same pattern recommended for Modal.tsx and
 * ConfirmDialog.tsx (HF-1 — separate dispatch). Codified as invariant
 * I-13: kit overlay primitives must portal to screen root.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  Dimensions,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { Gesture } from "react-native-gesture-handler";
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
  blurIntensity as blurIntensityTokens,
  glass,
  radius as radiusTokens,
  shadows,
  spacing,
} from "../../constants/designSystem";

import { WebSafeGestureDetector } from "./WebSafeGestureDetector";
import { shouldUseRealBlur } from "../../utils/glassBlur";
// ORCH-1165: sheet inputs live in the sheet's own native Modal window, so the
// root app-level toolbar can't reach them — mount a toolbar inside this Modal.
import { KeyboardToolbarRoot } from "../../wrappers/KeyboardToolbarRoot";
// ORCH-1170: the ORCH-1165 toolbar above mounted inside the sheet's native
// Modal window but received NO keyboard frames — react-native-keyboard-
// controller's KeyboardToolbar/KeyboardStickyView only animate when a
// KeyboardProvider lives in their OWN native window, and the app-root provider
// (KeyboardRoot in app/_layout.tsx) does NOT propagate into a RN Modal window.
// Wrap the sheet's Modal content in its own KeyboardProvider so inputs + the
// Done bar share one provider scoped to this window. KeyboardRoot is the
// web-split wrapper (native = <KeyboardProvider>, web = passthrough) — keeps
// the library import out of the web bundle exactly like the app-root mount.
import { KeyboardRoot } from "../../wrappers/KeyboardRoot";

// Inline glass-stack background — mirrors GlassChrome's L1-L4 visual layers
// but with each layer absolute-filled at the body level so the body can be
// `flex: 1` with internal `flex: 1` children that fill correctly. Going via
// GlassCard/GlassChrome was causing flex-collapse for consumers like the
// country picker (D-IMPL-44 family — GlassChrome's content View has
// `position: relative` with no flex, so `flex: 1` children inside collapse).
// Same pattern that TopSheet uses for the same reason.
const FALLBACK_BACKGROUND = "rgba(20, 22, 26, 0.92)";

export type SheetSnapPoint = "peek" | "half" | "full";

/**
 * Sheet snap value — string preset (peek/half/full) or numeric pixel
 * height. Numeric values are clamped to [120px, 95% screen]. Pass a
 * measured content height (e.g. from `onLayout`) for content-fit sheets
 * with no wasted bottom padding. NEW in Cycle 3 J-A12 polish — additive
 * to Sheet's API; existing string callers (peek/half/full) unaffected.
 *
 * Example:
 * ```ts
 * const [contentH, setContentH] = useState<number | null>(null);
 * <Sheet snapPoint={contentH ?? "half"}>
 *   <View onLayout={(e) => setContentH(e.nativeEvent.layout.height)}>
 *     ...
 *   </View>
 * </Sheet>
 * ```
 *
 * Per Cycle 3 rework v3 ticket-sheet auto-fit (DEC-pending — additive
 * carve-out of DEC-079; documented as discovery for orchestrator).
 */
export type SheetSnapValue = SheetSnapPoint | number;

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  snapPoint?: SheetSnapValue;
  /** Tap on scrim closes sheet. Default `true`. */
  dismissOnScrimTap?: boolean;
  /**
   * Wide-desktop web only: vertical placement of the centred card.
   * `"center"` (default) vertically centres it; `"top"` anchors it near the
   * top so the card can grow/shrink with content without the whole sheet
   * re-centring (e.g. a search palette whose result count changes as you type).
   * Ignored by the mobile bottom sheet, which is always bottom-anchored.
   */
  verticalAlign?: "center" | "top";
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /**
   * ORCH-1186 Fix 3 — opt-in SOLID panel fill (a brand `palette.page` color),
   * replacing the default L1–L4 glass stack so a brand-themed sheet fills the
   * ENTIRE panel edge-to-edge (rounded top + handle + bottom safe-area), with
   * NO dark glass gaps around the brand fill. Undefined → the default glass.
   */
  panelBackground?: string;
}

const SNAP_RATIOS: Record<SheetSnapPoint, number> = {
  peek: 0.25,
  half: 0.5,
  full: 0.9,
};

const MIN_SNAP_PX = 120;
const MAX_SNAP_RATIO = 0.95;

const SCRIM_COLOR = "rgba(0, 0, 0, 0.5)";
const CLOSE_THRESHOLD_PX = 80;
const CLOSE_VELOCITY = 600;
const SPRING_CONFIG = { damping: 22, stiffness: 200, mass: 1 } as const;
const REDUCE_MOTION_OPEN = { duration: 200, easing: Easing.out(Easing.cubic) } as const;
const TIMING_CLOSE = { duration: 240, easing: Easing.in(Easing.cubic) } as const;
const UNMOUNT_DELAY_MS = 280; // 240ms close anim + 40ms safety

// ORCH-1136 R3: dispatcher. Web renders the compositor-CSS-transition variant
// (SheetWeb — zero reanimated hooks); native renders the byte-identical
// reanimated variant (SheetNative, with its withSpring open + withTiming
// close). Each variant calls ONLY its own animation hooks.
export const Sheet: React.FC<SheetProps> = (props) => {
  if (Platform.OS === "web") {
    return <SheetWeb {...props} />;
  }
  return <SheetNative {...props} />;
};

const SheetNative: React.FC<SheetProps> = ({
  visible,
  onClose,
  children,
  snapPoint = "half",
  dismissOnScrimTap = true,
  testID,
  style,
  panelBackground,
}) => {
  const screenHeight = Dimensions.get("window").height;
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Compute panel height: numeric snap (clamped) OR ratio-based preset.
  const requestedSheetHeight =
    typeof snapPoint === "number"
      ? Math.min(
          Math.max(snapPoint, MIN_SNAP_PX),
          screenHeight * MAX_SNAP_RATIO,
        )
      : screenHeight * SNAP_RATIOS[snapPoint];

  // ORCH-0892-B v2: Sheet primitive no longer owns keyboard handling. The
  // panel rests at its designed snap point regardless of keyboard state.
  // Sheet consumers with TextInputs use SmartScrollView for their internal
  // body ScrollView — KAS (react-native-keyboard-controller) scrolls the
  // focused input above the keyboard within that consumer's own scrollable.
  // Sheet panel + header + handle stay put.
  //
  // Per SPEC_ORCH-0892-B_v2 §7.E + operator clarification 2026-05-20:
  // "Sheet drops keyboard logic entirely; consumers migrate their own
  // ScrollView." Supersedes ORCH-0884 follow-up #3.
  const sheetHeight = Math.min(
    requestedSheetHeight,
    screenHeight * MAX_SNAP_RATIO,
  );

  const closedY = sheetHeight; // pushed fully off-screen
  // ORCH-0892-B v2: panel rests at its docked position (translateY = 0
  // when open). No keyboard-driven panel translate.
  const openY = 0;

  // Lazy-mount: keep the Sheet out of the View tree when not visible to
  // prevent inline-render leaks (Sub-phase E.4 / ORCH-BIZ-0a-E12). Stay
  // mounted long enough for the close animation to finish, then unmount.
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

  if (!mounted) return null;

  // ORCH-0964 / ORCH-1100: on mobile web (< 768px) `backdrop-filter` is globally
  // disabled (inject-mobile-blur-css injects a `@media (max-width:767px){*{
  // backdrop-filter:none}}` rule to dodge the mobile-web blur crash). A BlurView
  // there renders FULLY transparent — the sheet's page content shows straight
  // through it. The shared `shouldUseRealBlur(windowWidth)` helper encapsulates
  // that width-aware blur-kill awareness (plus the iOS/Android/desktop-web
  // cases) so it can't drift per-component.
  const blurOk = shouldUseRealBlur(windowWidth);
  const blurIntensity = blurIntensityTokens.cardElevated;

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* ORCH-1170: KeyboardProvider scoped to THIS Modal's native window so the
          Done bar below actually receives keyboard frames here (the app-root
          provider does not reach into a separate RN Modal window). Wraps the
          whole panel so the sheet's inputs + the toolbar share one provider. */}
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
              accessibilityLabel="Dismiss sheet"
              accessibilityRole="button"
            />
          </Animated.View>
          <View style={styles.bottomDock} pointerEvents="box-none">
            <WebSafeGestureDetector gesture={panGesture}>
              <Animated.View
                style={[
                  styles.panel,
                  { height: sheetHeight },
                  shadows.glassCardElevated,
                  panelStyle,
                  style,
                ]}
              >
                <SheetMobilePanelInner
                  blurOk={blurOk}
                  blurIntensity={blurIntensity}
                  bottomInset={insets.bottom}
                  panelBackground={panelBackground}
                >
                  {children}
                </SheetMobilePanelInner>
              </Animated.View>
            </WebSafeGestureDetector>
          </View>
          {/* ORCH-1165: Done bar for sheet-hosted inputs — last child of the
              Modal's root absoluteFill so it overlays the sheet and floats on
              the keyboard. KeyboardStickyView keeps it off-screen until focus.
              ORCH-1170: now inside the per-window KeyboardProvider above. */}
          <KeyboardToolbarRoot />
        </View>
      </KeyboardRoot>
    </Modal>
  );
};

/**
 * ORCH-1136 R3: shared panel glass-stack + content for the bottom sheet.
 * Identical between web and native variants — only the animated wrapper
 * differs (the parent Animated.View vs the web CSS-transition View).
 */
interface SheetMobilePanelInnerProps {
  blurOk: boolean;
  blurIntensity: number;
  bottomInset: number;
  children: React.ReactNode;
  /** ORCH-1186 Fix 3 — solid brand fill replacing the glass stack when set. */
  panelBackground?: string;
}

const SheetMobilePanelInner: React.FC<SheetMobilePanelInnerProps> = ({
  blurOk,
  blurIntensity,
  bottomInset,
  children,
  panelBackground,
}) =>
  panelBackground !== undefined ? (
    // ORCH-1186 Fix 3 — a single solid brand fill clipped to the rounded panel
    // (covers the handle + bottom safe-area), so the brand color reads edge-to-
    // edge with no dark glass gaps. The handle + body sit ON TOP of it.
    <>
      <View
        style={[
          StyleSheet.absoluteFill,
          styles.bodyClip,
          { backgroundColor: panelBackground },
        ]}
      />
      <View style={styles.handleWrap}>
        <View style={styles.handle} />
      </View>
      <View style={[styles.body, { paddingBottom: spacing.lg + bottomInset }]}>
        {children}
      </View>
    </>
  ) : (
  <>
    {/* L1 — Blur base */}
    {blurOk ? (
      <BlurView
        intensity={blurIntensity}
        tint="dark"
        style={[StyleSheet.absoluteFill, styles.bodyClip]}
      />
    ) : (
      <View
        style={[
          StyleSheet.absoluteFill,
          styles.bodyClip,
          { backgroundColor: FALLBACK_BACKGROUND },
        ]}
      />
    )}
    {/* L2 — Tint floor */}
    <View
      style={[
        StyleSheet.absoluteFill,
        styles.bodyClip,
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
        styles.bodyClip,
        {
          borderColor: glass.border.profileElevated,
          borderWidth: StyleSheet.hairlineWidth,
        },
      ]}
      pointerEvents="none"
    />
    {/* Content layer — handle + flex:1 body, layered above visuals */}
    <View style={styles.handleWrap}>
      <View style={styles.handle} />
    </View>
    {/* ORCH-0964: pad past the bottom safe-area / nav bar so sheet
        content doesn't bleed into the bottom edge of the screen. */}
    <View style={[styles.body, { paddingBottom: spacing.lg + bottomInset }]}>
      {children}
    </View>
  </>
  );

// ORCH-1197 / ORCH-1199: web-only VISIBLE-viewport metrics for a bottom-anchored
// sheet. The Modal's absoluteFill fills the LAYOUT viewport (`window.innerHeight`),
// so a `bottom:0` dock anchors to the LAYOUT bottom. But the VISIBLE band a user can
// actually see is `window.visualViewport` — and on mobile that band is BOTH shorter
// than the layout viewport AND can be shifted DOWN from the top:
//
//   • iOS Safari (ORCH-1197): a dynamic BOTTOM toolbar makes the layout viewport
//     TALLER than the visible area → `innerHeight − visualViewport.height` > 0,
//     `offsetTop == 0`. The panel must lift up by that bottom gap.
//   • Android Chrome / Samsung Internet (ORCH-1199): when the on-screen keyboard
//     opens the page scrolls to keep the focused field visible, so the visual
//     viewport shifts DOWN → `visualViewport.offsetTop > 0`. With Chrome's
//     resizes-content behaviour `innerHeight` shrinks to equal `visualViewport
//     .height`, so the iOS-only `innerHeight − height` gap is ZERO and the 1197
//     lift does nothing — yet the true visible bottom is `offsetTop + height`, BELOW
//     the layout bottom the dock anchors to. The panel must lift by the FULL gap
//     between the layout bottom and the true visible bottom:
//         visibleBottomGap = innerHeight − (offsetTop + height)
//     which equals the 1197 `(innerHeight − height)` when `offsetTop == 0` (no iOS
//     regression) and additionally absorbs the Android `offsetTop` shift.
//
// Tracks both the visualViewport `resize` AND `scroll` events (offsetTop changes on
// scroll). Native is unaffected (this hook is web-only).
interface WebViewportMetrics {
  /** Visible (visual) viewport height — toolbar/keyboard excluded. Panel SIZE bound. */
  visibleHeight: number;
  /** Layout viewport height (`window.innerHeight`) — the Modal absoluteFill's
   *  actual pixel height; the `bottom:0` dock anchors to THIS bottom. */
  layoutHeight: number;
  /** ORCH-1199: amount by which the visible band is shifted DOWN from the top of the
   *  layout viewport (`visualViewport.offsetTop`) — nonzero on Android when the
   *  keyboard pushes the page up; always 0 on iOS Safari / desktop. */
  offsetTop: number;
  /** Gap between the LAYOUT bottom and the TRUE visible bottom
   *  (`innerHeight − (offsetTop + visibleHeight)`) = how far the panel must lift so
   *  its bottom aligns to the visible bottom on EVERY browser. */
  visibleBottomGap: number;
}

const useWebViewportMetrics = (fallbackHeight: number): WebViewportMetrics => {
  const read = (): WebViewportMetrics => {
    if (Platform.OS !== "web") {
      return { visibleHeight: fallbackHeight, layoutHeight: fallbackHeight, offsetTop: 0, visibleBottomGap: 0 };
    }
    const g = globalThis as unknown as {
      visualViewport?: { height: number; offsetTop?: number };
      innerHeight?: number;
    };
    const inner = typeof g.innerHeight === "number" && g.innerHeight > 0 ? g.innerHeight : fallbackHeight;
    const visible =
      g.visualViewport !== undefined && typeof g.visualViewport.height === "number" && g.visualViewport.height > 0
        ? g.visualViewport.height
        : inner;
    const offsetTop =
      g.visualViewport !== undefined && typeof g.visualViewport.offsetTop === "number" && g.visualViewport.offsetTop > 0
        ? g.visualViewport.offsetTop
        : 0;
    return {
      visibleHeight: visible,
      layoutHeight: inner,
      offsetTop,
      visibleBottomGap: Math.max(inner - (offsetTop + visible), 0),
    };
  };
  const [metrics, setMetrics] = useState<WebViewportMetrics>(read);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const vv = (
      globalThis as unknown as {
        visualViewport?: {
          addEventListener?: (t: string, l: () => void) => void;
          removeEventListener?: (t: string, l: () => void) => void;
        };
      }
    ).visualViewport;
    const onResize = (): void => setMetrics(read());
    onResize();
    vv?.addEventListener?.("resize", onResize);
    // ORCH-1199: offsetTop changes on visualViewport SCROLL (Android keyboard) — must
    // re-read or the panel keeps the stale anchor while the page scrolls under it.
    vv?.addEventListener?.("scroll", onResize);
    (globalThis as unknown as { addEventListener?: (t: string, l: () => void) => void }).addEventListener?.(
      "resize",
      onResize,
    );
    return (): void => {
      vv?.removeEventListener?.("resize", onResize);
      vv?.removeEventListener?.("scroll", onResize);
      (globalThis as unknown as { removeEventListener?: (t: string, l: () => void) => void }).removeEventListener?.(
        "resize",
        onResize,
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return Platform.OS === "web"
    ? metrics
    : { visibleHeight: fallbackHeight, layoutHeight: fallbackHeight, offsetTop: 0, visibleBottomGap: 0 };
};

// ORCH-1136 R3: web reduced-motion read (no reanimated hook on the web path).
const useWebReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState<boolean>(false);
  useEffect(() => {
    if (Platform.OS !== "web") return;
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
 * ORCH-1136 R3 — WEB variant of the bottom sheet.
 *
 * Drives open/close with a COMPOSITOR CSS transition on `transform:
 * translateY(...)` (panel) + `opacity` (scrim) instead of the JS-main-thread
 * reanimated rAF (withSpring open + withTiming close), which freezes mid-slide
 * under a heavy-page long task on web (F-1/F-2).
 *
 * Native opens with a withSpring (damping 22, stiffness 200, mass 1) — a CSS
 * transition cannot reproduce a spring exactly, so web's open is a snappy
 * ease-out approximation (cubic-bezier(0.22, 1, 0.36, 1), 280ms) that reads as
 * a spring-like settle (§4.5; correctness/no-freeze > exact spring parity on
 * web — web has no off-thread spring driver). Close = 240ms ease-in-cubic
 * (matches native TIMING_CLOSE). Reduce-motion: opacity-only.
 *
 * Calls ZERO reanimated hooks. Animates transform/opacity ONLY.
 */
const SHEET_OPEN_EASE_CSS = "cubic-bezier(0.22, 1, 0.36, 1)"; // spring-like ease-out approximation
const SHEET_CLOSE_EASE_CSS = "cubic-bezier(0.33, 0, 0.67, 1)"; // Easing.in(cubic)
const SHEET_OPEN_DURATION = 280;
const SHEET_CLOSE_DURATION = 240;

const SheetWeb: React.FC<SheetProps> = ({
  visible,
  onClose,
  children,
  snapPoint = "half",
  dismissOnScrimTap = true,
  testID,
  style,
  panelBackground,
}) => {
  // ORCH-1197 / ORCH-1199: size + anchor the panel against the VISIBLE (visual)
  // viewport, not the LAYOUT viewport. The Modal's absoluteFill fills
  // `window.innerHeight` (the layout height); the visible band can be both shorter
  // than it (iOS bottom toolbar / Android keyboard) AND shifted down from the top
  // (Android `visualViewport.offsetTop` when the keyboard scrolls the page up).
  // `visibleHeight` bounds the panel SIZE; `visibleBottomGap` lifts it so its bottom
  // aligns to the TRUE visible bottom on iOS Safari, Android Chrome AND Samsung
  // Internet (all no-ops on desktop / no toolbar / no keyboard).
  const { visibleHeight: screenHeight, layoutHeight, visibleBottomGap } = useWebViewportMetrics(
    Dimensions.get("window").height,
  );
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const requestedSheetHeight =
    typeof snapPoint === "number"
      ? Math.min(Math.max(snapPoint, MIN_SNAP_PX), screenHeight * MAX_SNAP_RATIO)
      : screenHeight * SNAP_RATIOS[snapPoint];
  const sheetHeight = Math.min(requestedSheetHeight, screenHeight * MAX_SNAP_RATIO);
  const closedY = sheetHeight; // pushed fully off-screen (slides up from bottom)

  const reduceMotion = useWebReducedMotion();

  const [mounted, setMounted] = useState<boolean>(visible);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const handleScrimPress = (): void => {
    if (dismissOnScrimTap) onClose();
  };

  if (!mounted) return null;

  const blurOk = shouldUseRealBlur(windowWidth);
  const blurIntensity = blurIntensityTokens.cardElevated;

  // ORCH-1197 / ORCH-1199: the dock is `position:absolute; bottom:0` inside an
  // absoluteFill sized to the LAYOUT viewport (`window.innerHeight`). The visible
  // bottom can sit ABOVE the layout bottom — by a dynamic bottom toolbar (iOS) and/or
  // by the page scrolling up under the keyboard (Android `visualViewport.offsetTop`).
  // Lift the panel by `visibleBottomGap` (layout bottom − true visible bottom) via
  // its OPEN resting transform so its bottom aligns to the VISIBLE bottom on every
  // browser (the panel is already height-bounded to the visible viewport above).
  // Riding the existing transform pipeline keeps the open/close animation intact and
  // avoids the react-native-web atomic-class `bottom` merge conflict.
  void layoutHeight;
  const openTranslateY = -visibleBottomGap;

  const dur = animateOpen ? SHEET_OPEN_DURATION : SHEET_CLOSE_DURATION;
  const ease = animateOpen ? SHEET_OPEN_EASE_CSS : SHEET_CLOSE_EASE_CSS;
  const panelWebStyle = {
    transition: reduceMotion ? `opacity ${dur}ms ${ease}` : `transform ${dur}ms ${ease}`,
    transform: reduceMotion
      ? `translateY(${openTranslateY}px)`
      : animateOpen
        ? `translateY(${openTranslateY}px)`
        : `translateY(${closedY}px)`,
    opacity: reduceMotion ? (animateOpen ? 1 : 0) : 1,
    willChange: "transform",
    // ORCH-1197: pad the panel bottom past the iOS home-indicator safe area so the
    // CTA clears it. `env(safe-area-inset-bottom)` resolves to 0 where there's no
    // inset (desktop / Android web), so this is a no-op there. CSS string is web-
    // only — never reaches the native variant.
    paddingBottom: "env(safe-area-inset-bottom, 0px)",
  } as unknown as ViewStyle;
  const scrimWebStyle = {
    transition: `opacity ${dur}ms ${ease}`,
    opacity: animateOpen ? 1 : 0,
    willChange: "opacity",
  } as unknown as ViewStyle;

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
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
            accessibilityLabel="Dismiss sheet"
            accessibilityRole="button"
          />
        </View>
        <View style={styles.bottomDock} pointerEvents="box-none">
          <View
            style={[
              styles.panel,
              { height: sheetHeight },
              shadows.glassCardElevated,
              panelWebStyle,
              style,
            ]}
          >
            <SheetMobilePanelInner
              blurOk={blurOk}
              blurIntensity={blurIntensity}
              bottomInset={insets.bottom}
              panelBackground={panelBackground}
            >
              {children}
            </SheetMobilePanelInner>
          </View>
        </View>
      </View>
    </Modal>
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
    borderTopLeftRadius: radiusTokens.xl,
    borderTopRightRadius: radiusTokens.xl,
    // Clip child visual layers to the rounded panel shape (top corners
    // rounded; bottom edges flush with viewport bottom).
    overflow: "hidden",
  },
  bodyClip: {
    borderTopLeftRadius: radiusTokens.xl,
    borderTopRightRadius: radiusTokens.xl,
  },
  topHighlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1,
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
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
});

export default Sheet;
