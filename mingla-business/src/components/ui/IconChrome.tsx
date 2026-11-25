/**
 * IconChrome — 36×36 circular glass icon button.
 *
 * Source: `Mingla_Artifacts/design-package/.../chrome.jsx:89–111`.
 *
 * Composed from `GlassChrome` + `Icon`. #4420: control material (onPhoto over
 * photos); active = the selected material. Orange is not used here.
 * Optional badge dot in the top-right.
 *
 * Press: scale 0.96 over 120ms (`easings.press`). Reduce-motion fallback
 * collapses to opacity 0.7. Light haptic on native press-down.
 */

import React, { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type {
  PressableProps,
  PressableStateCallbackType,
  StyleProp,
  ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import {
  durations,
  motion,
  shadow as shadowTokens,
  size as sizeTokens,
  type,
} from "../../constants/designSystem";
import { useTouchFloor } from "../../hooks/useTouchFloor";
import { color, themedStyles } from "../../theme/surfaceTokens";
import { HapticFeedback } from "../../utils/hapticFeedback";

import { GlassChrome } from "./GlassChrome";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export interface IconChromeProps {
  icon: IconName;
  /** Numeric badge (top-right corner). Hidden when `0` or `undefined`. */
  badge?: number;
  /**
   * Cap above which the badge renders `{cap}+`. Defaults to 99 (back-compat
   * for every existing call-site). META-ORCH-1074 passes `badgeCap={9}` on the
   * notifications bell to reduce operator noise (SUB-C_DESIGN §6).
   */
  badgeCap?: number;
  active?: boolean;
  onPress?: (restoreFocus?: () => void) => void | Promise<void>;
  size?: number;
  disabled?: boolean;
  /**
   * Required per I-38 / I-39 (Cycle 17c). Removed `?? icon` silent fallback —
   * every consumer must provide a human-readable label. CI gate `i39-pressable-label`
   * enforces, TS strict-build enforces.
   */
  accessibilityLabel: string;
  /**
   * Optional override of the primitive's baked-in default `hitSlop`. The default
   * `{top:4,bottom:4,left:4,right:4}` makes the effective touchable area `36 + 4×2 = 44`
   * per side, satisfying WCAG AA + Apple HIG floor (per I-38, Cycle 17c §A.1).
   * Consumer overrides honored verbatim — combined effective extent must remain ≥ 44.
   */
  hitSlop?: PressableProps["hitSlop"];
  /**
   * #4420: the control floats over a photo (event covers, media). Uses the
   * onPhoto material (Android .84, the one near-opaque exception).
   */
  onPhoto?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** #4420 kit IconButton sizes: 36 / 44 / 48. */
export const ICON_BUTTON_SIZE = sizeTokens.iconBtn;
const DEFAULT_SIZE = sizeTokens.iconBtn.sm;
const ICON_SIZE_RATIO = 0.5; // 18 of 36
const PRESS_TIMING = { duration: durations.fast } as const;
const BADGE_SIZE = 18;
// Cycle 17c §A.1 — effective touch area = 36 + 4×2 = 44 per side (WCAG AA + Apple HIG floor).
const DEFAULT_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 } as const;

interface FocusCapable {
  focus: () => void;
}

function hasFocusCapability(value: unknown): value is FocusCapable {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "focus" in value &&
    typeof value.focus === "function"
  );
}

export const IconChrome = forwardRef<View, IconChromeProps>(function IconChrome({
  icon,
  badge,
  badgeCap = 99,
  active = false,
  onPress,
  size: sizeProp = DEFAULT_SIZE,
  disabled = false,
  accessibilityLabel,
  hitSlop = DEFAULT_HIT_SLOP,
  onPhoto = false,
  testID,
  style,
}, forwardedRef) {
  // #4490: no hitSlop on a phone-width browser, so the chrome button is drawn 44 there.
  const size = Math.max(sizeProp, useTouchFloor());
  const pressableRef = useRef<View | null>(null);
  useImperativeHandle(forwardedRef, () => pressableRef.current as View, []);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const reduceMotion = useReducedMotion();
  const interactive = !disabled && onPress !== undefined;

  const handlePressIn = useCallback((): void => {
    if (!interactive) return;
    if (Platform.OS !== "web") {
      HapticFeedback.buttonPress();
    }
    if (reduceMotion) {
      opacity.value = withTiming(0.7, PRESS_TIMING);
    } else {
      scale.value = withTiming(motion.pressScale, PRESS_TIMING);
    }
  }, [interactive, opacity, reduceMotion, scale]);

  const handlePressOut = useCallback((): void => {
    if (reduceMotion) {
      opacity.value = withTiming(1, PRESS_TIMING);
    } else {
      scale.value = withTiming(1, PRESS_TIMING);
    }
  }, [opacity, reduceMotion, scale]);

  const restoreFocus = useCallback((): void => {
    const control = pressableRef.current;
    if (control === null) return;
    if (Platform.OS === "web") {
      if (hasFocusCapability(control)) control.focus();
      return;
    }
    const handle = findNodeHandle(control);
    if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
  }, []);

  const handlePress = useCallback(async (): Promise<void> => {
    if (onPress === undefined) return;
    try {
      await onPress(restoreFocus);
    } catch (error) {
      if (__DEV__) {
        console.error("[IconChrome] onPress threw:", error);
      }
    }
  }, [onPress, restoreFocus]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: disabled ? 0.32 : opacity.value,
  }));

  const iconSize = Math.round(size * ICON_SIZE_RATIO);
  const showBadge = badge !== undefined && badge > 0;
  const badgeLabel =
    badge !== undefined && badge > badgeCap ? `${badgeCap}+` : String(badge);

  const renderInteractive = (
    _state: PressableStateCallbackType,
  ): React.ReactNode => (
    <Animated.View style={animatedStyle}>
      <GlassChrome
        material={active ? "selected" : onPhoto ? "onPhoto" : "control"}
        shadow={onPhoto ? shadowTokens.none : shadowTokens.paper}
        radius="full"
        style={[styles.glass, { width: size, height: size }]}
      >
        <View style={[styles.iconContainer, { width: size, height: size }]}>
          <Icon
            name={icon}
            size={iconSize}
            color={onPhoto ? color.textOnPhoto : color.text1}
          />
        </View>
      </GlassChrome>
      {showBadge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeLabel} numberOfLines={1}>
            {badgeLabel}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );

  if (!interactive) {
    return (
      <View testID={testID} style={style}>
        {renderInteractive({ pressed: false, hovered: false })}
      </View>
    );
  }

  return (
    <Pressable
      ref={pressableRef}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={style}
    >
      {renderInteractive}
    </Pressable>
  );
});

const styles = themedStyles(() => StyleSheet.create({
  glass: {
    overflow: "visible",
  },
  iconContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    backgroundColor: color.badge,
    borderWidth: 2,
    borderColor: color.badgeRing,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeLabel: {
    color: color.textStrong,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: type.label.fontWeight,
  },
}));

export default IconChrome;
