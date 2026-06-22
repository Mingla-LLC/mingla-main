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
import type { GestureType } from "react-native-gesture-handler";
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

// ORCH-1136 R3: prefers-reduced-motion read for the WEB variant. On web,
// `react-native-reanimated`'s `useReducedMotion` is itself a JSReanimated hook;
// the web variant must call ZERO reanimated hooks (§4.0 gating shape), so it
// reads the media query directly. Returns false on native / SSR.
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

// Inline glass-stack — mirrors GlassChrome's L1-L4 visual layers but with
// each layer absolute-filled at the panel level so heights are
// panel-driven, not content-driven (GlassChrome's content-driven sizing
// breaks when used as a background-only layer — see D-IMPL-44).
//
// ORCH-1173 R2: FULLY OPAQUE (alpha 1.0). This is the L1 base used ONLY on the
// non-blur fallback path (`shouldUseRealBlur` false → Android + unsupported
// mobile-web). When real blur is unavailable there is nothing behind the panel
// to blur, so the base MUST be solid — at 0.92 the home screen bled through on
// Android (ANDROID_GLASS_USES_OPAQUE_FALLBACK). iOS blur path (blurOk true)
// renders a `BlurView` instead and is unaffected by this constant.
const FALLBACK_BACKGROUND = "rgb(20, 22, 26)";

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

/**
 * ORCH-1136 R3: dispatcher. Web renders the compositor-CSS-transition variant
 * (TopSheetWeb — zero reanimated hooks); native renders the byte-identical
 * reanimated variant (TopSheetNative). Splitting into two components is
 * load-bearing: React hooks cannot be conditionally called, so each variant
 * calls ONLY its own animation hooks (the web variant calls no
 * useSharedValue/useAnimatedStyle/withTiming — §4.0 gating shape).
 */
export const TopSheet: React.FC<TopSheetProps> = (props) => {
  if (Platform.OS === "web") {
    return <TopSheetWeb {...props} />;
  }
  return <TopSheetNative {...props} />;
};

const TopSheetNative: React.FC<TopSheetProps> = ({
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

  // ORCH-1173 R2: the dismiss-pan is the SIMPLE upward-drag→translateY dismiss
  // it was before R1, and it is attached ONLY to the drag HANDLE (see
  // `TopSheetPanelInner` — the handle area wraps in `WebSafeGestureDetector`
  // with this gesture). It NEVER wraps the scroll body, so the brand list is a
  // plain native `ScrollView` with zero competing Pan and scrolls normally on
  // Android. The R1 scroll-offset-gated `Gesture.Simultaneous`/`Gesture.Native`
  // coordination was removed (it failed on-device).
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
          {/* ORCH-1173 R2: the dismiss-pan attaches ONLY to the drag handle
              (rendered inside TopSheetPanelInner via `dismissGesture`), never
              around the scroll body — so the brand list is a plain native
              ScrollView that scrolls normally on Android. The Animated.View
              panel still owns the `translateY` transform; the handle gesture
              drives the shared value directly (no parent-child wrap needed). */}
          <TopSheetPanelInner
            blurOk={blurOk}
            blurIntensity={blurIntensity}
            heightMode={heightMode}
            bodyHeight={bodyHeight}
            handleAreaHeight={handleAreaHeight}
            handleCompactLayout={handleCompactLayout}
            dismissGesture={panGesture}
          >
            {children}
          </TopSheetPanelInner>
        </Animated.View>
      </View>
    </View>
  );
};

/**
 * ORCH-1136 R3: shared panel glass-stack + content. Identical between the web
 * and native variants — only the animated wrapper (the parent `Animated.View`
 * vs the web CSS-transition View) differs. Extracted to avoid duplicating the
 * L1-L4 stack + body + handle across both variants.
 */
interface TopSheetPanelInnerProps {
  blurOk: boolean;
  blurIntensity: number;
  heightMode: TopSheetHeightMode;
  bodyHeight: number;
  handleAreaHeight: number;
  handleCompactLayout: (event: LayoutChangeEvent) => void;
  /**
   * ORCH-1173 R2: the upward-drag dismiss gesture, attached ONLY to the drag
   * HANDLE region (never the scroll body). Native variant passes the
   * `Gesture.Pan()`; web passes `undefined` (web has no pan — dismiss is via
   * scrim-tap / Escape / close affordances). Gating on this keeps the body a
   * plain scrollable so the brand list scrolls natively on Android.
   */
  dismissGesture?: GestureType;
  children: React.ReactNode;
}

const TopSheetPanelInner: React.FC<TopSheetPanelInnerProps> = ({
  blurOk,
  blurIntensity,
  heightMode,
  bodyHeight,
  handleAreaHeight,
  handleCompactLayout,
  dismissGesture,
  children,
}) => (
  <>
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
    {/* ORCH-1173 R2: the dismiss-pan is attached ONLY to this handle region
        (native). The visual bar stays the same size; the touch target is the
        full handleWrap row + `hitSlop` so it's easy to grab. The web variant
        passes `dismissGesture={undefined}` → the bare handle renders with no
        gesture (web dismiss is scrim-tap / Escape). */}
    {dismissGesture !== undefined ? (
      <WebSafeGestureDetector gesture={dismissGesture}>
        <View
          style={[styles.handleWrap, { height: handleAreaHeight }]}
          hitSlop={16}
        >
          <View style={styles.handle} />
        </View>
      </WebSafeGestureDetector>
    ) : (
      <View style={[styles.handleWrap, { height: handleAreaHeight }]}>
        <View style={styles.handle} />
      </View>
    )}
  </>
);

/**
 * ORCH-1136 R3 — WEB variant of TopSheet.
 *
 * Drives the open/close animation with a COMPOSITOR-THREAD CSS transition on
 * `transform: translateY(...)` (panel) + `opacity` (scrim) — NOT a
 * `withTiming`-driven `useAnimatedStyle` on the JS main-thread rAF. On web,
 * reanimated 4 is JSReanimated: `withTiming` computes each frame inside the
 * browser-native requestAnimationFrame and writes inline styles per frame, so
 * a heavy page's long main-thread task (>50ms) FREEZES the half-open panel at
 * a mid-slide position then snaps it to rest (F-1/F-2, harness-proven). The
 * CSS transition advances the slide on the compositor independently of the
 * starved main thread.
 *
 * This variant calls ZERO reanimated hooks (no useSharedValue /
 * useAnimatedStyle / withTiming) — both fixing the freeze and removing the
 * reanimated-on-web fragility for this primitive.
 *
 * ORCH-1210: this variant ALSO has a pointer-driven swipe-UP-to-dismiss (the
 * native variant already had a reanimated upward PanGesture; web had only
 * scrim-tap + Escape). A drag-catch band at the BOTTOM of the panel (over the
 * handle) translates the panel UP with the finger via the `dragY` offset on the
 * SAME transform pipeline (transition disabled while dragging); release past 25%
 * of panel height / an upward flick velocity calls onClose(), else it springs
 * back. The drag-catch carries `touch-action:none` itself (ORCH-1208 lesson —
 * the panel's does not inherit) so Android/Samsung don't steal the drag as a page
 * scroll.
 *
 * Transitions (matching the native timings):
 *   - Open: panel transform 280ms ease-out-cubic; scrim opacity 220ms ease-out.
 *   - Close: panel transform 240ms ease-in-cubic; scrim opacity 220ms ease-in.
 *   - Reduce-motion: opacity-only (no translate), matching the native contract.
 *
 * Animates `transform`/`opacity` ONLY — never height/top/layout (those reflow
 * on the main thread and defeat the fix). Overlay root stays
 * StyleSheet.absoluteFill (NO position:'fixed' — I-PROPOSED-TOPSHEET-WEB-
 * OVERLAY-NO-FIXED).
 */
const TOPSHEET_OPEN_EASE = "cubic-bezier(0.33, 1, 0.68, 1)"; // Easing.out(cubic)
const TOPSHEET_CLOSE_EASE = "cubic-bezier(0.33, 0, 0.67, 1)"; // Easing.in(cubic)

// ORCH-1210 [business-web top sheet swipe-up-to-dismiss] — mirror SheetWeb's
// pointer drag-to-dismiss (ORCH-1207/1208), INVERTED for the top-anchored sheet.
// The top sheet opens at translateY 0 and dismisses by sliding UP toward
// `closedY = -panelHeight`, so a dismiss is an UPWARD drag (negative offset).
const TOPSHEET_DRAG_CLOSE_RATIO = 0.25; // fraction of panel height to commit a close
const TOPSHEET_DRAG_CLOSE_VELOCITY = 0.5; // px/ms UPWARD flick that commits a close

const TopSheetWeb: React.FC<TopSheetProps> = ({
  visible,
  onClose,
  children,
  dismissOnScrimTap = true,
  heightMode = "fixed-70",
  testID,
  style,
}) => {
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get("window").height;
  const { width: windowWidth } = useWindowDimensions();

  const [measuredCompactHeight, setMeasuredCompactHeight] = useState<number | null>(null);
  const fixedHeight = screenHeight * PANEL_HEIGHT_RATIO;
  const panelHeight =
    heightMode === "compact" ? (measuredCompactHeight ?? 0) : fixedHeight;

  const handleCompactLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      if (heightMode !== "compact") return;
      const contentHeight = event.nativeEvent.layout.height;
      if (contentHeight <= 0) return;
      const total = contentHeight + HANDLE_AREA_HEIGHT;
      setMeasuredCompactHeight((prev) => {
        if (prev !== null && Math.abs(prev - total) < 1) return prev;
        return total;
      });
    },
    [heightMode],
  );

  const panelTop = insets.top + TOPBAR_OFFSET;
  const closedY = -panelHeight;
  const reduceMotion = useWebReducedMotion();

  const [mounted, setMounted] = useState<boolean>(visible);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The animateOpen state flip drives the CSS transition. It starts false so
  // the panel mounts at its CLOSED transform; the next-frame flip to true fires
  // the transition to OPEN (flipping in the same commit as mount = no
  // transition, instant pop — the next-frame flip is load-bearing).
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

  // Open/close flip. On open, register the CLOSED start state, then flip to
  // OPEN on the NEXT frame so the browser registers the start transform first
  // (otherwise the transition never fires and the panel pops open). For compact
  // mode, this re-fires when `panelHeight` transitions 0 → measured so the
  // slide starts from the correct off-screen position (not from -0px).
  const compactReady = heightMode !== "compact" || measuredCompactHeight !== null;
  useEffect(() => {
    const cancelRaf = (): void => {
      if (rafRef.current !== null) {
        const caf = (globalThis as unknown as { cancelAnimationFrame?: (h: number) => void })
          .cancelAnimationFrame;
        caf?.(rafRef.current);
        rafRef.current = null;
      }
    };
    if (visible && mounted && compactReady) {
      // Ensure we start from CLOSED, then flip OPEN next frame.
      setAnimateOpen(false);
      const raf = (globalThis as unknown as { requestAnimationFrame?: (cb: () => void) => number })
        .requestAnimationFrame;
      if (raf !== undefined) {
        rafRef.current = raf(() => {
          rafRef.current = raf(() => {
            setAnimateOpen(true);
          });
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
  }, [visible, mounted, compactReady]);

  // Web Escape key.
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

  // ORCH-1210 — WEB swipe-UP-to-dismiss. TopSheetWeb previously closed ONLY via a
  // scrim tap / Escape (it calls zero reanimated hooks and had no PanGesture,
  // unlike TopSheetNative which has a reanimated upward PanGesture). Mirror the
  // SheetWeb pointer drag (ORCH-1207/1208) but INVERTED: the top sheet dismisses
  // by sliding UP, so an UPWARD pointer drag on the drag-catch band (at the BOTTOM
  // edge of the panel, over the handle) translates the panel up with the finger;
  // on release past a threshold (dragged up > 25% of panel height OR an upward
  // flick velocity) we onClose(), else we spring back to the open position. A
  // DOWNWARD drag is clamped to 0 (no rubber-band below the open rest). Only the
  // bottom handle band initiates the drag, so the scrollable body is never
  // hijacked.
  const [dragY, setDragY] = useState<number>(0); // live finger offset (px, <= 0 = up)
  const [dragging, setDragging] = useState<boolean>(false);
  const dragStartYRef = useRef<number | null>(null);
  const dragYRef = useRef<number>(0); // live offset (ref = end-decision source of truth)
  const lastMoveRef = useRef<{ y: number; t: number } | null>(null);
  const velocityRef = useRef<number>(0); // px/ms, negative = upward

  const endDrag = (commitClose: boolean): void => {
    dragStartYRef.current = null;
    lastMoveRef.current = null;
    dragYRef.current = 0;
    setDragging(false);
    if (commitClose) {
      // Let the CSS close transition (re-enabled once dragging=false) carry the
      // panel the rest of the way as onClose flips `visible`.
      setDragY(0);
      onClose();
    } else {
      // Spring back to open — dragging=false restores the transition, dragY=0
      // animates the panel home.
      setDragY(0);
    }
  };

  const handleDragStart = (clientY: number): void => {
    dragStartYRef.current = clientY;
    dragYRef.current = 0;
    lastMoveRef.current = { y: clientY, t: Date.now() };
    velocityRef.current = 0;
    setDragging(true);
  };

  const handleDragMove = (clientY: number): void => {
    if (dragStartYRef.current === null) return;
    const delta = clientY - dragStartYRef.current;
    // Clamp to UPWARD-only (no rubber-band downward past the open rest position).
    const next = delta < 0 ? delta : 0;
    const prev = lastMoveRef.current;
    if (prev !== null) {
      const dt = Date.now() - prev.t;
      if (dt > 0) velocityRef.current = (clientY - prev.y) / dt;
    }
    lastMoveRef.current = { y: clientY, t: Date.now() };
    dragYRef.current = next;
    setDragY(next);
  };

  const handleDragEnd = (): void => {
    if (dragStartYRef.current === null) return;
    // Use the REF, not the `dragY` state: the final pointermove's setState may not
    // have re-rendered (and so re-closured handleDragEnd) before pointerup fires.
    const dragged = dragYRef.current; // <= 0 (upward)
    const velocity = velocityRef.current; // < 0 = upward
    const shouldClose =
      -dragged > panelHeight * TOPSHEET_DRAG_CLOSE_RATIO ||
      velocity < -TOPSHEET_DRAG_CLOSE_VELOCITY;
    endDrag(shouldClose);
  };

  // Pointer Events cover mouse (desktop) + touch + pen in one path. react-native-
  // web forwards onPointerDown/Move/Up/Cancel to the DOM node. setPointerCapture
  // on down keeps move/up targeting the handle band even after the finger drags
  // off it (otherwise the events retarget to whatever element is under the cursor
  // and the drag silently stops).
  const dragHandlers = {
    onPointerDown: (e: {
      nativeEvent?: { clientY?: number; pointerId?: number };
      clientY?: number;
      pointerId?: number;
      currentTarget?: { setPointerCapture?: (id: number) => void };
    }): void => {
      const y = e.nativeEvent?.clientY ?? e.clientY;
      const id = e.nativeEvent?.pointerId ?? e.pointerId;
      if (typeof id === "number") {
        try {
          e.currentTarget?.setPointerCapture?.(id);
        } catch {
          // setPointerCapture can throw if the pointer is already gone — ignore;
          // the move/up handlers still work without capture in that edge case.
        }
      }
      if (typeof y === "number") handleDragStart(y);
    },
    onPointerMove: (e: { nativeEvent?: { clientY?: number }; clientY?: number }): void => {
      if (dragStartYRef.current === null) return;
      const y = e.nativeEvent?.clientY ?? e.clientY;
      if (typeof y === "number") handleDragMove(y);
    },
    onPointerUp: (): void => handleDragEnd(),
    onPointerCancel: (): void => endDrag(false),
  } as unknown as Record<string, (e: unknown) => void>;

  if (!mounted) return null;

  const handleAreaHeight = HANDLE_AREA_HEIGHT;
  const bodyHeight = panelHeight - handleAreaHeight;
  const blurOk = shouldUseRealBlur(windowWidth);
  const blurIntensity = blurIntensityTokens.cardElevated;

  // Compact pre-measurement: render at opacity 0 with NO transition fired yet
  // (matches native's compactInvisible) so children lay out and onLayout
  // measures their true height.
  const compactInvisible = heightMode === "compact" && measuredCompactHeight === null;

  // Compositor CSS transition. transform/opacity ONLY — never height/layout.
  const ease = animateOpen ? TOPSHEET_OPEN_EASE : TOPSHEET_CLOSE_EASE;
  const panelDur = animateOpen ? ENTRY_DURATION : EXIT_DURATION;
  // ORCH-1210 — while the finger is dragging, the panel must track it 1:1 with NO
  // transition (otherwise CSS would lag the drag). The drag offset (`dragY`,
  // upward <= 0) is added to the open resting transform (0). On release `dragging`
  // flips false → the transition is restored and `dragY` returns to 0, so the
  // panel either springs home or rides the close transition out (translateY 0 →
  // closedY). Reduce-motion: opacity-only, no translate (drag offset suppressed).
  const openWithDrag = dragY; // openTranslateY (0) + dragY
  const panelWebStyle = {
    transition: dragging
      ? "none"
      : reduceMotion
        ? `opacity ${panelDur}ms ${ease}`
        : `transform ${panelDur}ms ${ease}`,
    transform: reduceMotion
      ? "translateY(0px)"
      : animateOpen
        ? `translateY(${openWithDrag}px)`
        : `translateY(${closedY}px)`,
    opacity: reduceMotion ? (animateOpen ? 1 : 0) : 1,
    willChange: "transform",
  } as unknown as ViewStyle;
  const scrimWebStyle = {
    transition: `opacity ${SCRIM_DURATION}ms ${ease}`,
    opacity: animateOpen ? 1 : 0,
    willChange: "opacity",
  } as unknown as ViewStyle;

  return (
    <View
      pointerEvents={visible ? "auto" : "none"}
      style={StyleSheet.absoluteFill}
      testID={testID}
    >
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: SCRIM_COLOR },
          scrimWebStyle,
        ]}
      >
        <Pressable
          style={styles.scrimPress}
          onPress={handleScrimPress}
          accessibilityLabel="Dismiss sheet"
          accessibilityRole="button"
        />
      </View>
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
        <View
          style={[
            styles.panel,
            heightMode === "compact"
              ? compactInvisible
                ? { opacity: 0 }
                : { height: panelHeight, opacity: 1 }
              : { height: panelHeight },
            shadows.glassCardElevated,
            // compactInvisible: no transition fired yet — keep it parked off
            // screen at opacity 0 until measured, then the next-frame flip
            // slides it in from the measured off-screen position.
            compactInvisible ? null : panelWebStyle,
            style,
          ]}
        >
          <TopSheetPanelInner
            blurOk={blurOk}
            blurIntensity={blurIntensity}
            heightMode={heightMode}
            bodyHeight={bodyHeight}
            handleAreaHeight={handleAreaHeight}
            handleCompactLayout={handleCompactLayout}
          >
            {children}
          </TopSheetPanelInner>
          {/* ORCH-1210 — transparent drag-catch band over the handle at the
              BOTTOM edge of the panel (the top sheet's handle renders last, below
              the body). Pointer-drag UP here dismisses the sheet (mirrors the
              native upward PanGesture). Sits above the inner glass + handle but is
              short enough that it never overlaps the scrollable body, so form
              scrolling is untouched. Pointer Events cover mouse (desktop) + touch
              + pen, so scrim-tap dismissal still works independently. */}
          <View
            testID={testID !== undefined ? `${testID}-drag-handle` : undefined}
            accessibilityLabel="Drag up to dismiss sheet"
            style={[
              styles.webDragCatch,
              { height: handleAreaHeight + 28 },
              // Web-only `cursor` (RN-web maps it; the string-style cast keeps it
              // off the native ViewStyle surface).
              { cursor: dragging ? "grabbing" : "grab" } as unknown as ViewStyle,
            ]}
            {...dragHandlers}
          />
        </View>
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
  // ORCH-1210 (WEB) — transparent drag-catch band pinned to the BOTTOM of the top
  // sheet panel, over the handle (the top sheet renders its handle LAST, at the
  // bottom edge). Tall enough to be an easy upward-drag target (handle area +
  // margin), short enough that it never overlaps the scrollable body above it.
  // Web-only style object (cursor + touchAction) — only applied inside the
  // TopSheetWeb panel.
  webDragCatch: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    // ORCH-1208 lesson (mirrored): the panel's `touchAction:"none"` does NOT
    // inherit to this element, so on real touch devices (Samsung/Android Chrome)
    // the browser computes `touch-action:auto` here and interprets the upward drag
    // as a page scroll → pointercancel → the dismiss gesture never completes. Pin
    // `touch-action:none` directly on the drag-catch so the vertical pan is routed
    // to the pointer handler. Web-only string-cast (never reaches the native
    // ViewStyle surface); the scrollable body keeps its own scrolling.
    touchAction: "none",
  } as unknown as ViewStyle,
});

export default TopSheet;
