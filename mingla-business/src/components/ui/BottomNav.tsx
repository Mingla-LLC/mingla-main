/**
 * BottomNav — 3-tab capsule navigation per DEC-073.
 *
 * Wrapper: `GlassChrome` with `radius="full"`, intensity `chrome`, tint
 * `glass.tint.chrome.idle`. Each tab is a Pressable with vertical-stack
 * `<Icon>` + `<Text>` label.
 *
 * Spotlight: an absolutely-positioned `Animated.View` behind the active
 * tab — background `accent.tint`, border `accent.border`, shadow
 * `shadows.glassChromeActive`, radius `full`. Animates `left` and
 * `width` via spring (damping 18, stiffness 260, mass 0.9) on `active`
 * change. Reduce-motion: 200ms timing.
 *
 * Active tab: white icon, weight-600 label. Inactive: 55%-alpha white
 * icon, weight-500 label.
 *
 * Per DEC-073, the `tabs` prop accepts arbitrary length so Cycle 12 can
 * swap to 4-tab when Marketing ships, but Cycle 0a default is 3.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { LayoutChangeEvent, StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import {
  accent,
  glass,
  shadows,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { HapticFeedback } from "../../utils/hapticFeedback";

import { GlassChrome } from "./GlassChrome";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export interface BottomNavTab {
  id: string;
  icon: IconName;
  label: string;
}

export interface BottomNavProps {
  tabs: BottomNavTab[];
  active: string;
  onChange: (id: string) => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const NAV_HEIGHT = 64;
const NAV_PADDING_X = spacing.sm;
const NAV_PADDING_Y = spacing.sm;
const SPOTLIGHT_HEIGHT = 48;
const SPRING_CONFIG = { damping: 18, stiffness: 260, mass: 0.9 } as const;
const REDUCE_TIMING = { duration: 200, easing: Easing.out(Easing.cubic) } as const;
const INACTIVE_ICON = "rgba(255, 255, 255, 0.55)";

interface TabLayout {
  x: number;
  width: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  tabs,
  active,
  onChange,
  testID,
  style,
}) => {
  const [layouts, setLayouts] = useState<Record<string, TabLayout>>({});
  const left = useSharedValue(0);
  const width = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  const activeLayout = layouts[active];

  useEffect(() => {
    if (activeLayout === undefined) return;
    if (reduceMotion) {
      left.value = withTiming(activeLayout.x, REDUCE_TIMING);
      width.value = withTiming(activeLayout.width, REDUCE_TIMING);
    } else {
      left.value = withSpring(activeLayout.x, SPRING_CONFIG);
      width.value = withSpring(activeLayout.width, SPRING_CONFIG);
    }
  }, [activeLayout, left, reduceMotion, width]);

  useEffect(() => {
    return (): void => {
      cancelAnimation(left);
      cancelAnimation(width);
    };
  }, [left, width]);

  const handleLayout = useCallback(
    (id: string) =>
      (event: LayoutChangeEvent): void => {
        const { x, width: w } = event.nativeEvent.layout;
        setLayouts((prev) => {
          const existing = prev[id];
          if (existing !== undefined && existing.x === x && existing.width === w) {
            return prev;
          }
          return { ...prev, [id]: { x, width: w } };
        });
      },
    [],
  );

  const handlePress = useCallback(
    (id: string) =>
      (): void => {
        if (Platform.OS !== "web") {
          HapticFeedback.buttonPress();
        }
        onChange(id);
      },
    [onChange],
  );

  const spotlightStyle = useAnimatedStyle(() => ({
    left: left.value,
    width: width.value,
  }));

  return (
    <View testID={testID} style={[styles.host, style]}>
      <GlassChrome
        intensity="cardElevated"
        tintColor="rgba(12, 14, 18, 0.55)"
        borderColor={glass.border.chrome}
        radius="full"
        style={styles.bar}
      >
        <View style={styles.tabsRow}>
          <Animated.View
            pointerEvents="none"
            style={[styles.spotlight, shadows.glassChromeActive, spotlightStyle]}
          />
          {tabs.map((tab) => {
            const isActive = tab.id === active;
            return (
              <Pressable
                key={tab.id}
                onPress={handlePress(tab.id)}
                onLayout={handleLayout(tab.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={tab.label}
                style={styles.tab}
              >
                <Icon
                  name={tab.icon}
                  size={22}
                  color={isActive ? textTokens.inverse : INACTIVE_ICON}
                />
                <Text
                  style={[
                    styles.label,
                    {
                      color: isActive ? textTokens.inverse : INACTIVE_ICON,
                      fontWeight: isActive ? "600" : "500",
                    },
                  ]}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </GlassChrome>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: spacing.md,
  },
  bar: {
    height: NAV_HEIGHT,
  },
  tabsRow: {
    height: NAV_HEIGHT,
    paddingHorizontal: NAV_PADDING_X,
    paddingVertical: NAV_PADDING_Y,
    flexDirection: "row",
    alignItems: "center",
  },
  spotlight: {
    position: "absolute",
    top: NAV_PADDING_Y,
    height: SPOTLIGHT_HEIGHT,
    backgroundColor: accent.tint,
    borderColor: accent.border,
    borderWidth: 1,
    borderRadius: SPOTLIGHT_HEIGHT / 2,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  label: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    letterSpacing: typography.micro.letterSpacing,
  },
});

export default BottomNav;
