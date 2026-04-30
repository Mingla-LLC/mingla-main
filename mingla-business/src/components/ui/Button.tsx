/**
 * Button — primary CTA primitive.
 *
 * Variants: `primary | secondary | ghost | destructive`
 * Sizes:    `sm (36) | md (44) | lg (52)`
 * Shapes:   `pill` (radius full, default) | `square` (radius md)
 *
 * Press: scale 0.96 over 120ms (`easings.press`). Reduce-motion fallback
 * collapses to opacity 0.7 momentary. Disabled state opacity 0.32, no
 * haptic, no animation. Loading replaces leading icon with `<Spinner />`
 * and dims label to 0.7 opacity (layout stable).
 *
 * Native: light haptic on press-down. Web: hover bumps background by 6%
 * alpha; focus draws a 2px `accent.warm` outline (only when
 * `:focus-visible`).
 */

import React, { useCallback } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type {
  GestureResponderEvent,
  PressableStateCallbackType,
  StyleProp,
  TextStyle,
  ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import {
  accent,
  durations,
  easings,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { HapticFeedback } from "../../utils/hapticFeedback";

import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";
export type ButtonShape = "pill" | "square";

export interface ButtonProps {
  label: string;
  onPress: (event: GestureResponderEvent) => void | Promise<void>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  shape?: ButtonShape;
  leadingIcon?: IconName;
  trailingIcon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}

const SIZE_HEIGHT: Record<ButtonSize, number> = { sm: 36, md: 44, lg: 52 };
const SIZE_PADDING_X: Record<ButtonSize, number> = { sm: 12, md: 16, lg: 20 };
const SIZE_ICON: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20 };
// react-native-reanimated cannot animate to a literal-typed weight ("600"),
// so cast through the Animated style at the call site.
const SIZE_LABEL: Record<ButtonSize, TextStyle> = {
  sm: { fontSize: typography.buttonMd.fontSize, lineHeight: typography.buttonMd.lineHeight, fontWeight: typography.buttonMd.fontWeight, letterSpacing: typography.buttonMd.letterSpacing },
  md: { fontSize: typography.buttonMd.fontSize, lineHeight: typography.buttonMd.lineHeight, fontWeight: typography.buttonMd.fontWeight, letterSpacing: typography.buttonMd.letterSpacing },
  lg: { fontSize: typography.buttonLg.fontSize, lineHeight: typography.buttonLg.lineHeight, fontWeight: typography.buttonLg.fontWeight, letterSpacing: typography.buttonLg.letterSpacing },
};

interface VariantTokens {
  background: string;
  hoverBackground: string;
  border?: string;
  borderWidth?: number;
  text: string;
}

// Web-only hover backgrounds. For solid-fill variants (`primary`,
// `destructive`) we use a marginally lighter shade of the base colour;
// for translucent / transparent variants we bump alpha as the dispatch
// §3.6 specifies ("+6% alpha"). The two hardcoded hex values below
// (#f0843a, #f25656) are tracked as D-IMPL-1 in the implementation
// report — candidate for a `accent.warm.hover` / `semantic.errorHover`
// token in a future designSystem revision.
const VARIANT_TOKENS: Record<ButtonVariant, VariantTokens> = {
  primary: {
    background: accent.warm,
    hoverBackground: "#f0843a",
    text: textTokens.inverse,
  },
  secondary: {
    background: glass.tint.profileElevated,
    hoverBackground: "rgba(255, 255, 255, 0.10)",
    border: glass.border.profileElevated,
    borderWidth: 1,
    text: textTokens.primary,
  },
  ghost: {
    background: "transparent",
    hoverBackground: "rgba(235, 120, 37, 0.08)",
    text: accent.warm,
  },
  destructive: {
    background: semantic.error,
    hoverBackground: "#f25656",
    text: textTokens.inverse,
  },
};

const PRESS_TIMING = { duration: durations.fast } as const;

export const Button: React.FC<ButtonProps> = ({
  label,
  onPress,
  variant = "primary",
  size = "md",
  shape = "pill",
  leadingIcon,
  trailingIcon,
  loading = false,
  disabled = false,
  fullWidth = false,
  accessibilityLabel,
  testID,
  style,
  labelStyle,
}) => {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const reduceMotion = useReducedMotion();
  const tokens = VARIANT_TOKENS[variant];
  const interactive = !disabled && !loading;

  const handlePressIn = useCallback((): void => {
    if (!interactive) return;
    if (Platform.OS !== "web") {
      HapticFeedback.buttonPress();
    }
    if (reduceMotion) {
      opacity.value = withTiming(0.7, PRESS_TIMING);
    } else {
      scale.value = withTiming(0.96, PRESS_TIMING);
    }
  }, [interactive, opacity, reduceMotion, scale]);

  const handlePressOut = useCallback((): void => {
    if (reduceMotion) {
      opacity.value = withTiming(1, PRESS_TIMING);
    } else {
      scale.value = withTiming(1, PRESS_TIMING);
    }
  }, [opacity, reduceMotion, scale]);

  const handlePress = useCallback(
    async (event: GestureResponderEvent): Promise<void> => {
      try {
        await onPress(event);
      } catch (error) {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.error("[Button] onPress threw:", error);
        }
      }
    },
    [onPress],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const containerHeight = SIZE_HEIGHT[size];
  const containerRadius = shape === "pill" ? radiusTokens.full : radiusTokens.md;
  const iconSize = SIZE_ICON[size];

  // Disabled state visual — muted grey background + tertiary text +
  // light border. Replaces the previous opacity-only treatment which was
  // too subtle on saturated variants (the warm-orange `primary` at 0.32
  // opacity still read as active). Same disabled palette regardless of
  // variant — clarity over variant-specific dimming. Continues DEC-079
  // additive carve-out family (existing primitive, improved disabled
  // signal; no new variant, no API change).
  const DISABLED_BACKGROUND = "rgba(255, 255, 255, 0.06)";
  const DISABLED_BORDER = "rgba(255, 255, 255, 0.10)";

  const containerStaticStyle: ViewStyle = {
    height: containerHeight,
    paddingHorizontal: SIZE_PADDING_X[size],
    borderRadius: containerRadius,
    backgroundColor: disabled ? DISABLED_BACKGROUND : tokens.background,
    borderColor: disabled ? DISABLED_BORDER : tokens.border,
    borderWidth: disabled ? 1 : (tokens.borderWidth ?? 0),
    alignSelf: fullWidth ? "stretch" : "auto",
    opacity: disabled ? 0.6 : 1,
  };

  const resolvedTextColor = disabled ? textTokens.tertiary : tokens.text;

  // PressableStateCallbackType in the installed RN version does not declare
  // `focused`/`hovered` — both fields are passed at runtime on web. We widen
  // the callback param type with an intersection to read them safely without
  // sacrificing type discipline (no `any`, no escape casts).
  const renderInteractiveContent = (
    pressableState: PressableStateCallbackType & {
      hovered?: boolean;
      focused?: boolean;
    },
  ): React.ReactNode => {
    const hovered = pressableState.hovered === true;
    const focused = pressableState.focused === true;

    return (
      <Animated.View
        style={[
          styles.container,
          containerStaticStyle,
          hovered && Platform.OS === "web" ? { backgroundColor: tokens.hoverBackground } : null,
          focused && Platform.OS === "web" ? styles.focusRing : null,
          animatedStyle,
        ]}
      >
        <View style={styles.content}>
          {loading ? (
            <Spinner size={iconSize <= 18 ? 24 : iconSize <= 22 ? 24 : 36} color={resolvedTextColor} />
          ) : leadingIcon !== undefined ? (
            <Icon name={leadingIcon} size={iconSize} color={resolvedTextColor} />
          ) : null}
          <Text
            style={[
              SIZE_LABEL[size],
              { color: resolvedTextColor },
              loading ? styles.labelDimmed : null,
              labelStyle,
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
          {!loading && trailingIcon !== undefined ? (
            <Icon name={trailingIcon} size={iconSize} color={resolvedTextColor} />
          ) : null}
        </View>
      </Animated.View>
    );
  };

  return (
    <Pressable
      onPress={interactive ? handlePress : undefined}
      onPressIn={interactive ? handlePressIn : undefined}
      onPressOut={interactive ? handlePressOut : undefined}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: loading }}
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
      style={[fullWidth ? styles.fullWidth : undefined, style]}
    >
      {renderInteractiveContent}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  fullWidth: {
    alignSelf: "stretch",
  },
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  labelDimmed: {
    opacity: 0.7,
  },
  focusRing: {
    outlineColor: accent.warm,
    outlineWidth: 2,
    outlineStyle: "solid",
    outlineOffset: 2,
  },
});

export default Button;
