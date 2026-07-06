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

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { LayoutChangeEvent, StyleProp, ViewStyle } from "react-native";

import {
  accent,
  glass,
  shadows,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useReducedMotionNative } from "../../hooks/useReducedMotionNative";
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
// ORCH-1320: layout props (`left`/`width`) require the JS driver
// (`useNativeDriver: false`). The JS-driven RN-core Animated loop runs through
// the Animated module on the JS thread — NOT the Reanimated worklets runtime —
// so there is no second runtime, no AroundLock, no cross-runtime UAF race with
// the Fabric mount-commit. That is the load-bearing property of this fix.
const SPRING_CONFIG = {
  damping: 18,
  stiffness: 260,
  mass: 0.9,
  useNativeDriver: false,
} as const;
const REDUCE_TIMING = {
  duration: 200,
  easing: Easing.out(Easing.cubic),
  useNativeDriver: false,
} as const;
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
  const left = useRef(new Animated.Value(0)).current;
  const width = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotionNative();

  const activeLayout = layouts[active];

  // ORCH-1320 (biz Account-tab Apple crash): this spotlight animation MUST NOT
  // use a Reanimated worklet. A worklet here races the Fabric mount-commit on
  // the New Architecture → EXC_BAD_ACCESS use-after-free (Apple rejection 3).
  // Keep it RN-core `Animated` (JS-driven, no worklets runtime) or a static
  // highlight. See I-PROPOSED-1320-NO-WORKLET-ON-TAB-COMMIT-PATH.
  useEffect(() => {
    if (activeLayout === undefined) return;
    // ORCH-1320 A.2 (defense-in-depth): defer the `.start()` to the next frame
    // so the spotlight animation begins AFTER the tab route mount-commit has
    // settled and never interleaves with the Fabric tab-swap commit.
    const rafId = requestAnimationFrame(() => {
      if (reduceMotion) {
        Animated.timing(left, {
          toValue: activeLayout.x,
          ...REDUCE_TIMING,
        }).start();
        Animated.timing(width, {
          toValue: activeLayout.width,
          ...REDUCE_TIMING,
        }).start();
      } else {
        Animated.spring(left, {
          toValue: activeLayout.x,
          ...SPRING_CONFIG,
        }).start();
        Animated.spring(width, {
          toValue: activeLayout.width,
          ...SPRING_CONFIG,
        }).start();
      }
    });
    return (): void => cancelAnimationFrame(rafId);
  }, [activeLayout, left, reduceMotion, width]);

  useEffect(() => {
    return (): void => {
      left.stopAnimation();
      width.stopAnimation();
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
            style={[styles.spotlight, shadows.glassChromeActive, { left, width }]}
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
