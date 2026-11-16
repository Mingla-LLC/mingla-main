/**
 * BottomNav — the phone tab bar (#4420 Graphite Glass, spec §3.4 / B5).
 *
 * A floating liquid-glass capsule (iOS `materials.liquid`; Android the SOLID
 * liquid fill with the same rim). Tabs: Home, Hub, [Create], Ari, Blast.
 *   - A tab whose id is `create` is not a destination: it renders as the
 *     centred orange ember (54) and calls `onCreate` (the shell opens the
 *     UniversalCreatorSheet through hubCreatorStore).
 *   - Active tab: orange icon (one of the places orange is allowed), text1
 *     label, and a soft `fill.tabOn` spotlight behind it.
 *
 * ORCH-1320 (biz Account-tab Apple crash): the spotlight animation MUST NOT
 * use a Reanimated worklet. A worklet here races the Fabric mount-commit on
 * the New Architecture → EXC_BAD_ACCESS use-after-free. It stays RN-core
 * `Animated` (JS driver, `useNativeDriver: false`) and its `.start()` is
 * deferred a frame. I-PROPOSED-1320-NO-WORKLET-ON-TAB-COMMIT-PATH.
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

import { color, shadow as shadowTokens, space, type } from "../../constants/designSystem";
import { useReducedMotionNative } from "../../hooks/useReducedMotionNative";
import { HapticFeedback } from "../../utils/hapticFeedback";

import { GlassChrome } from "./GlassChrome";
import { BOTTOM_NAV_CAPSULE_HEIGHT, BOTTOM_NAV_EMBER_SIZE } from "./bottomNavMetrics";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

/** The tab id that renders as the centred Create ember (not a route). */
export const CREATE_TAB_ID = "create";

export interface BottomNavTab {
  id: string;
  icon: IconName;
  label: string;
}

export interface BottomNavProps {
  tabs: BottomNavTab[];
  active: string;
  onChange: (id: string) => void;
  /** #4420: the centred Create ember was pressed. */
  onCreate?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const NAV_HEIGHT = BOTTOM_NAV_CAPSULE_HEIGHT;
const NAV_PADDING_X = space[2];
const NAV_PADDING_Y = space[2];
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
const INACTIVE_ICON = color.text3;

interface TabLayout {
  x: number;
  width: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  tabs,
  active,
  onChange,
  onCreate,
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
        if (id === CREATE_TAB_ID) {
          onCreate?.();
          return;
        }
        onChange(id);
      },
    [onChange],
  );

  return (
    <View testID={testID} style={[styles.host, style]}>
      <GlassChrome material="liquid" shadow={shadowTokens.liquid} radius="full" style={styles.bar}>
        <View style={styles.tabsRow}>
          <Animated.View
            pointerEvents="none"
            style={[styles.spotlight, { left, width, opacity: activeLayout === undefined ? 0 : 1 }]}
          />
          {tabs.map((tab) => {
            if (tab.id === CREATE_TAB_ID) {
              return (
                <View key={tab.id} style={styles.tab}>
                  <Pressable
                    onPress={handlePress(tab.id)}
                    accessibilityRole="button"
                    accessibilityLabel={tab.label}
                    testID="bottom-nav-create"
                    style={[styles.ember, shadowTokens.ember]}
                  >
                    <Icon name="plus" size={24} color={color.onAccent} />
                  </Pressable>
                </View>
              );
            }
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
                <Icon name={tab.icon} size={22} color={isActive ? color.accent : INACTIVE_ICON} />
                <Text
                  style={[
                    styles.label,
                    {
                      color: isActive ? color.text1 : INACTIVE_ICON,
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
    paddingHorizontal: space[4],
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
    backgroundColor: color.fill.tabOn,
    borderRadius: SPOTLIGHT_HEIGHT / 2,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  ember: {
    width: BOTTOM_NAV_EMBER_SIZE,
    height: BOTTOM_NAV_EMBER_SIZE - 8,
    borderRadius: (BOTTOM_NAV_EMBER_SIZE - 8) / 2,
    backgroundColor: color.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: type.nav.fontSize,
    lineHeight: type.nav.lineHeight,
    letterSpacing: type.nav.letterSpacing,
  },
});

export default BottomNav;
