/**
 * Toast — non-modal notification (#4420 Graphite Glass, spec §3.3 / B4).
 *
 * # Source-compatible
 * `<Toast visible kind message onDismiss />` keeps every prop it had, so none
 * of the call sites change. New and additive: `action` (one quiet action
 * button, e.g. "Retry").
 *
 * # Non-modal (the B4 fix)
 * Toast no longer renders a native `<Modal>`. A Modal window on iOS captures
 * every touch until it closes, which froze the screen under every toast. Now
 * Toast registers its props in `toastStore` while it is visible and renders
 * nothing; `ToastHost` draws it in an absolutely positioned
 * `pointerEvents="box-none"` layer: no scrim, no focus capture.
 * Layering: a host lives at the app root AND inside the SheetMobile, Modal and
 * ConfirmDialog windows; a toast shows only in the top-most one (see
 * `toastStore.ts`). If no host is mounted at all (an isolated render), Toast
 * draws its card inline so a message is never silently lost.
 *
 * # Dismissal (ORCH-0789, canonical for the whole app)
 *   1. Tap anywhere on the card.
 *   2. Tap the close (×) button (32×32 + hitSlop 12 → 56×56).
 *   3. Swipe UP (native): past 40pt or a fling faster than 500pt/s.
 *   4. The timer (`toastTimings.ts`): success/info 4s, warn 6s, error with an
 *      action 8s; an error with no action stays until dismissed. The timer
 *      pauses while the card is pressed or hovered.
 *
 * # Placement
 * Phone: top, under the status bar. Web >= 1024: top-centre stack of at
 * most 3, 380 wide.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
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
import { Gesture } from "react-native-gesture-handler";

import { radius, shadow, size, space, type } from "../../constants/designSystem";
import { color, themed, themedStyles } from "../../theme/surfaceTokens";

import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { Material } from "./Material";
import { WebSafeGestureDetector } from "./WebSafeGestureDetector";
import { AUTO_DISMISS, resolveAutoDismissMs, type ToastKind } from "./toastTimings";
import { nextToastEntryId, useToastStore } from "./toastStore";
import { useToastTimer } from "./useToastTimer";
import type { ToastAction, ToastEntry } from "./toastStore";

export type { ToastKind };
export type { ToastAction };
export { AUTO_DISMISS };

export interface ToastProps {
  visible: boolean;
  kind: ToastKind;
  message: string;
  onDismiss: () => void;
  testID?: string;
  /** Kept for source compatibility; the host positions every toast. */
  style?: StyleProp<ViewStyle>;
  /**
   * ORCH-0789: per-instance auto-dismiss override (ms). `null` disables the
   * timer for this instance. Error toasts always stay user-dismissible.
   */
  autoDismissMs?: number | null;
  /** #4420: one optional action ("Retry"). Pressing it also dismisses. */
  action?: ToastAction;
  /** Called once after the visible toast surface has mounted. */
  onPresented?: () => void;
  /**
   * Web recovery mode: announce the toast as an assertive alert. Toasts never
   * trap focus any more, so a caller may always move focus to the invalid control.
   */
  preservePageFocusOnWeb?: boolean;
}

export const ENTRY_DURATION = 220;
export const EXIT_DURATION = 160;
const TRANSLATE_FROM = -40;
const SWIPE_DISMISS_DISTANCE = 40;
const SWIPE_DISMISS_VELOCITY = 500;
const SWIPE_FOLLOW_RESISTANCE = 0.6;
const SWIPE_DOWNWARD_RESISTANCE = 0.25;

interface KindTokens {
  icon: IconName;
  iconBg: string;
  iconFg: string;
}

const kindTokens = themed((): Record<ToastKind, KindTokens> => ({
  success: { icon: "check", iconBg: color.success, iconFg: color.ink },
  info: { icon: "bell", iconBg: color.fill.step, iconFg: color.text1 },
  warn: { icon: "flag", iconBg: color.warning, iconFg: color.ink },
  error: { icon: "close", iconBg: color.danger, iconFg: color.onDanger },
}));

/**
 * Toast registers itself in the store while visible and renders nothing (or
 * its card inline when no host is mounted anywhere).
 */
export const Toast: React.FC<ToastProps> = ({
  visible,
  kind,
  message,
  onDismiss,
  testID,
  autoDismissMs,
  action,
  onPresented,
  preservePageFocusOnWeb = false,
}) => {
  const idRef = useRef<number | null>(null);
  if (idRef.current === null) idRef.current = nextToastEntryId();
  const id = idRef.current;
  const hostCount = useToastStore((s) => s.hosts.length);
  const upsert = useToastStore((s) => s.upsert);
  const remove = useToastStore((s) => s.remove);

  const entry: ToastEntry | null = visible
    ? { id, kind, message, onDismiss, testID, autoDismissMs, action, onPresented, announce: preservePageFocusOnWeb }
    : null;

  useEffect(() => {
    if (entry === null) {
      remove(id);
      return;
    }
    upsert(entry);
    // entry is rebuilt each render; its fields are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, kind, message, onDismiss, testID, autoDismissMs, action, onPresented, preservePageFocusOnWeb]);

  useEffect(() => () => remove(id), [id, remove]);

  if (hostCount > 0 || entry === null) return null;
  return (
    <View pointerEvents="box-none" style={styles.inlineRoot}>
      <ToastItem entry={entry} placement="top" />
    </View>
  );
};

export type ToastPlacement = "top" | "stack";

export interface ToastItemProps {
  entry: ToastEntry;
  placement: ToastPlacement;
}

/** One drawn toast. Web never runs reanimated hooks (ORCH-1136 R3). */
export const ToastItem: React.FC<ToastItemProps> = (props) =>
  Platform.OS === "web" ? <ToastWeb {...props} /> : <ToastNative {...props} />;

const usePresented = (entry: ToastEntry): void => {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    entry.onPresented?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
};

const ToastNative: React.FC<ToastItemProps> = ({ entry, placement }) => {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(TRANSLATE_FROM);
  const swipeOffset = useSharedValue(0);
  const reduceMotion = useReducedMotion();
  const ms = resolveAutoDismissMs(entry.kind, entry.action !== undefined, entry.autoDismissMs);
  const timer = useToastTimer(ms, entry.onDismiss);
  usePresented(entry);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: ENTRY_DURATION, easing: Easing.out(Easing.cubic) });
    translateY.value = reduceMotion ? 0 : withTiming(0, { duration: ENTRY_DURATION, easing: Easing.out(Easing.cubic) });
    return (): void => {
      cancelAnimation(opacity);
      cancelAnimation(translateY);
      cancelAnimation(swipeOffset);
    };
  }, [opacity, reduceMotion, swipeOffset, translateY]);

  const onDismiss = entry.onDismiss;
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((event) => {
          "worklet";
          swipeOffset.value =
            event.translationY < 0
              ? event.translationY * SWIPE_FOLLOW_RESISTANCE
              : event.translationY * SWIPE_DOWNWARD_RESISTANCE;
        })
        .onEnd((event) => {
          "worklet";
          if (event.translationY < -SWIPE_DISMISS_DISTANCE || event.velocityY < -SWIPE_DISMISS_VELOCITY) {
            runOnJS(onDismiss)();
          } else {
            swipeOffset.value = withSpring(0, { damping: 18, stiffness: 220, mass: 0.8 });
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

  return (
    <WebSafeGestureDetector gesture={panGesture}>
      <Animated.View
        style={[placement === "stack" ? styles.stackItem : styles.topItem, animatedStyle]}
        testID={entry.testID}
        accessibilityHint="Swipe up or tap to dismiss"
      >
        <ToastCard entry={entry} onPressIn={timer.pause} onPressOut={timer.resume} />
      </Animated.View>
    </WebSafeGestureDetector>
  );
};

const TOAST_OPEN_EASE_CSS = "cubic-bezier(0.33, 1, 0.68, 1)";

const ToastWeb: React.FC<ToastItemProps> = ({ entry, placement }) => {
  const [open, setOpen] = useState(false);
  const ms = resolveAutoDismissMs(entry.kind, entry.action !== undefined, entry.autoDismissMs);
  const timer = useToastTimer(ms, entry.onDismiss);
  usePresented(entry);

  useEffect(() => {
    const raf = (globalThis as unknown as { requestAnimationFrame?: (cb: () => void) => number })
      .requestAnimationFrame;
    if (raf === undefined) {
      setOpen(true);
      return undefined;
    }
    const handle = raf(() => setOpen(true));
    return (): void => {
      (globalThis as unknown as { cancelAnimationFrame?: (h: number) => void }).cancelAnimationFrame?.(handle);
    };
  }, []);

  // #4490: the desktop stack is top-centre too, so it drops in from above.
  const from = placement === "stack" ? TRANSLATE_FROM / 2 : TRANSLATE_FROM;
  const webStyle = {
    transition: `transform ${ENTRY_DURATION}ms ${TOAST_OPEN_EASE_CSS}, opacity ${ENTRY_DURATION}ms ${TOAST_OPEN_EASE_CSS}`,
    transform: open ? "translateY(0px)" : `translateY(${from}px)`,
    opacity: open ? 1 : 0,
  } as unknown as ViewStyle;

  return (
    <View
      style={[placement === "stack" ? styles.stackItem : styles.topItem, webStyle]}
      testID={entry.testID}
      accessibilityRole={entry.announce ? "alert" : undefined}
      accessibilityLiveRegion={entry.announce ? "assertive" : "polite"}
      accessibilityHint="Tap to dismiss"
    >
      <ToastCard
        entry={entry}
        onPressIn={timer.pause}
        onPressOut={timer.resume}
        onHoverIn={timer.pause}
        onHoverOut={timer.resume}
      />
    </View>
  );
};


interface ToastCardProps {
  entry: ToastEntry;
  onPressIn: () => void;
  onPressOut: () => void;
  onHoverIn?: () => void;
  onHoverOut?: () => void;
}

const ToastCard: React.FC<ToastCardProps> = ({ entry, onPressIn, onPressOut, onHoverIn, onHoverOut }) => {
  const tokens = kindTokens()[entry.kind];
  const { action, onDismiss } = entry;
  // #4453: on web a "button" role draws a <button>, and the action and close
  // buttons inside it are <button>s too ("<button> cannot be a descendant of
  // <button>"). There the card is a plain clickable surface, out of the tab
  // order, and the close button is the keyboard and screen-reader way to dismiss.
  const web = Platform.OS === "web";
  return (
    // ORCH-0789: tap-anywhere-on-card dismisses; onDismiss is idempotent.
    <Pressable
      onPress={onDismiss}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      accessibilityRole={web ? undefined : "button"}
      tabIndex={web ? -1 : 0}
      accessibilityLabel="Dismiss notification"
      style={[styles.cardShadow, shadow.toast]}
    >
      <Material kind="sheet" radius={radius.lg} style={styles.card}>
        <View style={styles.body}>
          <View style={[styles.iconBadge, { backgroundColor: tokens.iconBg }]}>
            <Icon name={tokens.icon} size={16} color={tokens.iconFg} />
          </View>
          <Text style={styles.message} numberOfLines={3}>
            {entry.message}
          </Text>
          {action !== undefined ? (
            <Pressable
              onPress={() => {
                action.onPress();
                onDismiss();
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              style={styles.actionButton}
            >
              <Text style={styles.actionLabel}>{action.label}</Text>
            </Pressable>
          ) : null}
          {/* ORCH-0789: explicit close. 32×32 + hitSlop 12 → 56×56 (I-38). */}
          <Pressable
            onPress={onDismiss}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Dismiss notification"
            style={styles.closeButton}
          >
            <Icon name="close" size={14} color={color.text2} />
          </Pressable>
        </View>
      </Material>
    </Pressable>
  );
};

const styles = themedStyles(() => StyleSheet.create({
  inlineRoot: {
    position: "absolute",
    top: space[10],
    left: 0,
    right: 0,
    alignItems: "center",
    paddingHorizontal: space[4],
    zIndex: 1000,
  },
  topItem: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  stackItem: {
    width: size.toast,
  },
  cardShadow: {
    borderRadius: radius.lg,
  },
  card: {
    minHeight: 56,
  },
  body: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingLeft: space[3],
    paddingRight: space[2],
    paddingVertical: space[3],
  },
  iconBadge: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  message: {
    flex: 1,
    color: color.text1,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: "500",
  },
  actionButton: {
    minHeight: 32,
    paddingHorizontal: space[2],
    justifyContent: "center",
    flexShrink: 0,
  },
  actionLabel: {
    color: color.text1,
    fontSize: type.btnSm.fontSize,
    lineHeight: type.btnSm.lineHeight,
    fontWeight: type.btnSm.fontWeight,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    backgroundColor: color.fill.tile,
  },
}));

export default Toast;
