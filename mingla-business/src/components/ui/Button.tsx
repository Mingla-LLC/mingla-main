/**
 * Button — primary CTA primitive.
 *
 * Variants: `primary | secondary | ghost | destructive | step | destructiveOutline`
 * Sizes:    `sm (36) | md (44) | lg (52)`
 * Shapes:   `pill` (radius full, default) | `square` (radius md)
 *
 * Press: scale 0.96 over 120ms (`easings.press`). Reduce-motion fallback
 * collapses to opacity 0.7 momentary. Disabled state opacity 0.32, no
 * haptic, no animation. Loading replaces leading icon with `<Spinner />`
 * and dims label to 0.7 opacity (layout stable).
 *
 * Native: light haptic on press-down. Web: hover bumps background by 6%
 * alpha; focus draws the 2px canvas gap + 2px paper ring (only when
 * `:focus-visible`).
 */

import React, { forwardRef, useCallback } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type {
  AccessibilityRole,
  AccessibilityState,
  GestureResponderEvent,
  Insets,
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
  durations,
  edge,
  motion,
  radius as radiusTokens,
  shadow as shadowTokens,
  size as sizeTokens,
  space,
  type,
} from "../../constants/designSystem";
import { color, materials, themed } from "../../theme/surfaceTokens";
import { HapticFeedback } from "../../utils/hapticFeedback";
// ORCH-1162 Bug 3 — pure WCAG-contrast helpers for the optional accentColor.
import {
  mixHex,
  normalizeHex,
  readableTextFor,
} from "../../utils/buttonAccentContrast";

// #2211 — the app's one Dynamic Type ceiling. See src/constants/dynamicType.ts
// for why 200 % is the requirement rather than a concession to it.
import { BUTTON_MAX_FONT_SCALE } from "../../constants/dynamicType";

import { useTouchFloor } from "../../hooks/useTouchFloor";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { Spinner } from "./Spinner";

// #4420 Graphite Glass: primary = Paper (one per view), secondary = control,
// quiet, danger (solid red), dangerText (quiet red). The pre-#4420 names stay
// and map onto them: ghost → quiet, destructive → danger, destructiveOutline →
// dangerText, step → primary (Paper).
// The legacy unions stay exactly as they were (other modules key exhaustive
// records on them); the #4420 names are additive on the prop types.
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "destructive"
  | "step"
  | "destructiveOutline";
export type ButtonVariantName = ButtonVariant | "quiet" | "danger" | "dangerText";
export type ButtonSize = "sm" | "md" | "lg";
export type ButtonSizeName = ButtonSize | "xl";
export type ButtonShape = "pill" | "square";

const CHECKABLE_ACCESSIBILITY_ROLES: ReadonlySet<AccessibilityRole> = new Set([
  "checkbox",
  "radio",
  "togglebutton",
]);

// ORCH-1162 Bug 3 — optional brand-accent override for the `primary` variant.
// The WCAG contrast helpers live in the pure, unit-testable buttonAccentContrast
// util (they mirror packages/offering-rendering/themePalette.ts). The label color
// auto-resolves (black/white) for ≥4.5:1 on ANY brand hue, so the checkout CTAs
// stay legible on light AND dark themes. I-PROPOSED-1162-CHECKOUT-CTA-BRAND-THEMED.

export interface ButtonProps {
  label: string;
  onPress: (event: GestureResponderEvent) => void | Promise<void>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  shape?: ButtonShape;
  /**
   * ORCH-1162 Bug 3 — optional brand-accent hex that overrides the `primary`
   * variant's background (ignored for secondary/ghost/destructive). The label
   * color auto-resolves for ≥4.5:1 contrast on any hue. Omit → unchanged Mingla
   * orange. Invalid hex → ignored (falls back to the default token).
   */
  accentColor?: string;
  /**
   * issue #1023 — the theme gradient's two stops (first = accentColor). The
   * `primary` fill paints a 135° gradient over accentColor. Ignored without
   * accentColor, for other variants, and while disabled.
   */
  accentGradient?: readonly [string, string] | null;
  leadingIcon?: IconName;
  trailingIcon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  /** #3040 §11 — what happens on press, read after the label. */
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  testID?: string;
  /** #4624 — extra touch area without changing the drawn size. */
  hitSlop?: Insets;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  /**
   * #3040 — explicit colour for the leading/trailing icon when `labelStyle`
   * sets a label colour the icon must match exactly (the cover sheet's dark
   * ink on orange). Ignored while disabled, so a disabled button stays one
   * muted colour. Omit → the icon follows the resolved label colour.
   */
  iconColor?: string;
}

// Kit button heights: 36 / 44 / 52 / 56 on web; phones use 50 / 54 for lg / xl.
const PHONE = Platform.OS !== "web";
const SIZE_HEIGHT: Record<ButtonSizeName, number> = {
  sm: sizeTokens.btn.sm,
  md: sizeTokens.btn.md,
  lg: PHONE ? sizeTokens.btn.phone : sizeTokens.btn.lg,
  xl: PHONE ? sizeTokens.btn.phoneLg : sizeTokens.btn.xl,
};
const SIZE_PADDING_X: Record<ButtonSizeName, number> = { sm: space[3], md: space[4], lg: space[5], xl: space[6] };
const SIZE_ICON: Record<ButtonSizeName, number> = { sm: 16, md: 18, lg: 20, xl: 20 };
const btnSm: TextStyle = {
  fontSize: type.btnSm.fontSize,
  lineHeight: type.btnSm.lineHeight,
  fontWeight: type.btnSm.fontWeight,
  letterSpacing: type.btnSm.letterSpacing,
};
const btn: TextStyle = {
  fontSize: type.btn.fontSize,
  lineHeight: type.btn.lineHeight,
  fontWeight: type.btn.fontWeight,
  letterSpacing: type.btn.letterSpacing,
};
const SIZE_LABEL: Record<ButtonSizeName, TextStyle> = { sm: btnSm, md: btnSm, lg: btn, xl: btn };

interface VariantTokens {
  background: string;
  hoverBackground: string;
  border?: string;
  borderWidth?: number;
  /** 1px top highlight (the material rim). */
  rim?: string;
  text: string;
  /** Paper buttons carry the small paper shadow. */
  shadow?: ViewStyle;
}

// #4518 — built per active surface tokens, so a button inside a host-themed
// checkout takes the host's colours and never a Graphite fill.
const variantTokens = themed((): Record<ButtonVariantName, VariantTokens> => {
  const PAPER: VariantTokens = {
    background: color.paper,
    hoverBackground: color.paperEnd,
    text: color.ink,
    shadow: shadowTokens.paper,
  };
  const CONTROL: VariantTokens = {
    background: materials.control.solidFill,
    hoverBackground: materials.selected.solidFill,
    border: materials.control.rim.edge,
    borderWidth: StyleSheet.hairlineWidth,
    rim: materials.control.rim.top ?? undefined,
    text: color.text1,
  };
  const QUIET: VariantTokens = {
    background: color.fill.quiet,
    hoverBackground: color.fill.quietHover,
    text: color.text1,
  };
  const DANGER: VariantTokens = {
    background: color.danger,
    hoverBackground: color.dangerPressed,
    text: color.onDanger,
  };
  const DANGER_TEXT: VariantTokens = {
    background: color.fill.quiet,
    hoverBackground: color.errorTint,
    text: color.errorText,
  };

  return {
    primary: PAPER,
    secondary: CONTROL,
    ghost: QUIET,
    destructive: DANGER,
    // #3655 — the "moves you on" look (wizard Continue): Paper since #4420.
    step: PAPER,
    // #3655 — quiet remove look; solid destructive stays inside ConfirmDialog.
    destructiveOutline: DANGER_TEXT,
    quiet: QUIET,
    danger: DANGER,
    dangerText: DANGER_TEXT,
  };
});

const PRESS_TIMING = { duration: durations.fast } as const;

/**
 * #4420: what `<Button>` accepts. `ButtonProps` keeps the legacy unions (it is
 * extended elsewhere, e.g. AriPremiumButton); the Graphite names are additive.
 */
export type GraphiteButtonProps = Omit<ButtonProps, "variant" | "size"> & {
  variant?: ButtonVariantName;
  size?: ButtonSizeName;
};

export const Button = forwardRef<
  React.ElementRef<typeof Pressable>,
  GraphiteButtonProps
>(function Button(
  {
    label,
    onPress,
    variant = "primary",
    size = "md",
    shape = "pill",
    accentColor,
    accentGradient,
    leadingIcon,
    trailingIcon,
    loading = false,
    disabled = false,
    fullWidth = false,
    accessibilityLabel,
    accessibilityHint,
    accessibilityRole = "button",
    accessibilityState,
    testID,
    hitSlop,
    style,
    labelStyle,
    iconColor,
  },
  forwardedRef,
) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const reduceMotion = useReducedMotion();
  const tokens = variantTokens()[variant];
  const interactive = !disabled && !loading;

  // ORCH-1162 Bug 3 — optional brand-accent override (primary variant only).
  // Label color auto-resolves for WCAG legibility on arbitrary hues; the web
  // hover lightens the brand bg by 6% toward white (mirrors the default token
  // hover shade). Invalid/absent accentColor → unchanged default tokens.
  const brandBg =
    variant === "primary" && typeof accentColor === "string"
      ? normalizeHex(accentColor)
      : null;
  const effectiveBg = brandBg ?? tokens.background;
  const effectiveText =
    brandBg !== null ? readableTextFor(brandBg) : tokens.text;
  const effectiveHoverBg =
    brandBg !== null
      ? mixHex(brandBg, color.paper, 0.06)
      : tokens.hoverBackground;

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

  // #4490: a phone-width browser has no hitSlop, so the small button is drawn 44 there.
  const touchFloor = useTouchFloor();
  const containerHeight = Math.max(SIZE_HEIGHT[size], touchFloor);
  const containerRadius =
    shape === "pill" ? radiusTokens.full : radiusTokens.md;
  const iconSize = SIZE_ICON[size];

  // Disabled state visual — muted grey background + tertiary text +
  // light border. Replaces the previous opacity-only treatment which was
  // too subtle on saturated variants (the warm-orange `primary` at 0.32
  // opacity still read as active). Same disabled palette regardless of
  // variant — clarity over variant-specific dimming. Continues DEC-079
  // additive carve-out family (existing primitive, improved disabled
  // signal; no new variant, no API change).
  // #4420: disabled = card2 with text4, no blur, no extra dimming.
  const DISABLED_BACKGROUND = color.card2;
  const DISABLED_BORDER = color.line;

  const containerStaticStyle: ViewStyle = {
    // #2211 — `minHeight`, NOT `height`. A hard `height` is what cropped every
    // one of this primitive's 161 call sites at accessibility text sizes: iOS
    // caps the Dynamic Type multiplier at 3.571 and applies it to line height
    // too, so a 14/20 label drew at 50/71.4 pt inside a 44 pt box and the
    // glyphs were simply cut off. `minHeight` keeps the same rendered height at
    // ordinary text sizes (the content is smaller than the floor) and lets the
    // pill GROW instead of cropping when the label genuinely needs the room.
    // The 44 pt minimum touch target is preserved either way.
    minHeight: containerHeight,
    paddingHorizontal: SIZE_PADDING_X[size],
    borderRadius: containerRadius,
    backgroundColor: disabled ? DISABLED_BACKGROUND : effectiveBg,
    borderColor: disabled ? DISABLED_BORDER : tokens.border,
    borderWidth: disabled ? StyleSheet.hairlineWidth : (tokens.borderWidth ?? 0),
    borderTopColor: !disabled && tokens.rim !== undefined ? tokens.rim : undefined,
    alignSelf: fullWidth ? "stretch" : "auto",
    ...(disabled || brandBg !== null || tokens.shadow === undefined ? null : tokens.shadow),
  };

  // issue #1023 — the brand gradient over the brand fill (web: CSS
  // backgroundImage; native: New Architecture experimental_backgroundImage).
  const gradientImage =
    brandBg !== null && !disabled && accentGradient !== undefined && accentGradient !== null
      ? `linear-gradient(135deg, ${accentGradient[0]} 0%, ${accentGradient[1]} 100%)`
      : null;
  const gradientStyle: (ViewStyle & { backgroundImage?: string }) | null =
    gradientImage === null
      ? null
      : Platform.OS === "web"
        ? { backgroundImage: gradientImage }
        : { experimental_backgroundImage: gradientImage };

  const resolvedTextColor = disabled ? color.text4 : effectiveText;
  const resolvedIconColor =
    !disabled && typeof iconColor === "string" ? iconColor : resolvedTextColor;

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
          gradientStyle,
          hovered && Platform.OS === "web"
            ? { backgroundColor: effectiveHoverBg }
            : null,
          focused && Platform.OS === "web" ? styles.focusRing : null,
          animatedStyle,
        ]}
      >
        <View style={styles.content}>
          {loading ? (
            <Spinner
              size={iconSize <= 18 ? 24 : iconSize <= 22 ? 24 : 36}
              color={resolvedTextColor}
            />
          ) : leadingIcon !== undefined ? (
            <Icon
              name={leadingIcon}
              size={iconSize}
              color={resolvedIconColor}
            />
          ) : null}
          <Text
            style={[
              SIZE_LABEL[size],
              { color: resolvedTextColor },
              loading ? styles.labelDimmed : null,
              labelStyle,
            ]}
            numberOfLines={1}
            // #2211 — THE CAP. Without it `numberOfLines={1}` above turns a
            // label the pill cannot fit into a TRUNCATED label: at AX5 all
            // three business sign-in CTAs read "Continue wi" and only a 22 pt
            // icon told Apple from Google. 200 % is WCAG 1.4.4's ask and is
            // exactly what a 44 pt pill hosts intact, so the cap IS the
            // requirement. Delete this line and the label renders at
            // `base x fontScale` again.
            maxFontSizeMultiplier={BUTTON_MAX_FONT_SCALE}
          >
            {label}
          </Text>
          {!loading && trailingIcon !== undefined ? (
            <Icon
              name={trailingIcon}
              size={iconSize}
              color={resolvedIconColor}
            />
          ) : null}
        </View>
      </Animated.View>
    );
  };

  return (
    <Pressable
      ref={forwardedRef}
      onPress={interactive ? handlePress : undefined}
      onPressIn={interactive ? handlePressIn : undefined}
      onPressOut={interactive ? handlePressOut : undefined}
      disabled={disabled || loading}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ ...accessibilityState, disabled, busy: loading }}
      aria-checked={
        CHECKABLE_ACCESSIBILITY_ROLES.has(accessibilityRole)
          ? accessibilityState?.checked
          : undefined
      }
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      testID={testID}
      hitSlop={hitSlop}
      style={[fullWidth ? styles.fullWidth : undefined, style]}
    >
      {renderInteractiveContent}
    </Pressable>
  );
});

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
    gap: space[2],
  },
  labelDimmed: {
    opacity: 0.7,
  },
  // #4420: a 2px canvas gap + 2px paper ring (kit `ringFocus`).
  focusRing: {
    outlineColor: edge.ringFocus.ring,
    outlineWidth: edge.ringFocus.ringWidth,
    outlineStyle: "solid",
    outlineOffset: edge.ringFocus.gapWidth,
  },
});

export default Button;
