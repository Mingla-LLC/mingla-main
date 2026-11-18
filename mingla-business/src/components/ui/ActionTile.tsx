/**
 * ActionTile — composition tile for action grids on Home / Events.
 *
 * GlassCard + circular icon container + label + optional sub. The
 * `primary` variant elevates the card and warms the icon container
 * with `accent.tint` background + `accent.border` + `glassChromeActive`
 * shadow; the icon itself becomes `accent.warm`.
 *
 * Press: scale 0.97 over 120ms (`easings.press`). Reduce-motion fallback
 * collapses to opacity 0.85. Light haptic on native press-down.
 */

import React, { useCallback } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type {
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
  radius as radiusTokens,
  space,
  shadow,
  color,
  type,
} from "../../constants/designSystem";
import { HapticFeedback } from "../../utils/hapticFeedback";

import { GlassCard } from "./GlassCard";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export interface ActionTileProps {
  icon: IconName;
  label: string;
  sub?: string;
  onPress: () => void | Promise<void>;
  primary?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const PRESS_TIMING = { duration: durations.fast } as const;
const ICON_CONTAINER_SIZE = 40;
const ICON_SIZE = 22;

export const ActionTile: React.FC<ActionTileProps> = ({
  icon,
  label,
  sub,
  onPress,
  primary = false,
  disabled = false,
  accessibilityLabel,
  testID,
  style,
}) => {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const reduceMotion = useReducedMotion();
  const interactive = !disabled;

  const handlePressIn = useCallback((): void => {
    if (!interactive) return;
    if (Platform.OS !== "web") {
      HapticFeedback.buttonPress();
    }
    if (reduceMotion) {
      opacity.value = withTiming(0.85, PRESS_TIMING);
    } else {
      scale.value = withTiming(0.97, PRESS_TIMING);
    }
  }, [interactive, opacity, reduceMotion, scale]);

  const handlePressOut = useCallback((): void => {
    if (reduceMotion) {
      opacity.value = withTiming(1, PRESS_TIMING);
    } else {
      scale.value = withTiming(1, PRESS_TIMING);
    }
  }, [opacity, reduceMotion, scale]);

  const handlePress = useCallback(async (): Promise<void> => {
    try {
      await onPress();
    } catch (error) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.error("[ActionTile] onPress threw:", error);
      }
    }
  }, [onPress]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: disabled ? 0.32 : opacity.value,
  }));

  const renderInteractive = (
    _state: PressableStateCallbackType,
  ): React.ReactNode => (
    <Animated.View style={animatedStyle}>
      <GlassCard
        variant={primary ? "elevated" : "base"}
        padding={space[4]}
        style={[styles.card, primary ? shadow.liquid : null]}
      >
        <View style={styles.row}>
          <View
            style={[
              styles.iconContainer,
              {
                backgroundColor: primary ? color.accentLine : color.fill.tile,
                borderColor: primary ? color.accentLine : color.lineStrong,
              },
            ]}
          >
            <Icon
              name={icon}
              size={ICON_SIZE}
              color={primary ? color.accent : color.text1}
            />
          </View>
          <View style={styles.textCol}>
            <Text style={styles.label} numberOfLines={1}>
              {label}
            </Text>
            {sub !== undefined ? (
              <Text style={styles.sub} numberOfLines={2}>
                {sub}
              </Text>
            ) : null}
          </View>
        </View>
      </GlassCard>
    </Animated.View>
  );

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
      style={style}
    >
      {renderInteractive}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    minHeight: 96,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
  },
  iconContainer: {
    width: ICON_CONTAINER_SIZE,
    height: ICON_CONTAINER_SIZE,
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  textCol: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontSize: type.row.fontSize,
    lineHeight: type.row.lineHeight,
    fontWeight: "600",
    color: color.text1,
  },
  sub: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: type.small.fontWeight,
    color: color.text2,
  },
});

export default ActionTile;
