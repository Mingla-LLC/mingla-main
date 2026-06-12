/**
 * DraftSelectCheckbox — ORCH-1123 [Hub multi-select draft delete].
 *
 * Purely presentational circular check control overlaid on a draft card's cover
 * while selection mode is active. It does NOT own the press — the card body is
 * the hit target (SPEC §3.5), and the ROW carries the `checkbox` a11y role
 * (DESIGN §8). DESIGN §9.1:
 *   - 24pt circle, top-left over the cover (placed by the card)
 *   - unchecked: rgba(12,14,18,0.55) fill + rgba(255,255,255,0.85) 1.5px ring
 *   - checked:   solid accent.warm + white check glyph (shape change, not hue-only)
 *   - bounce on toggle (check 1→1.18→1, uncheck 1→0.85→1)
 * Color is never the only indicator (shape + glyph differ) → a11y safe.
 */

import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { accent, durations } from "../../constants/designSystem";
import { Icon } from "../ui/Icon";

export interface DraftSelectCheckboxProps {
  selected: boolean;
  testID?: string;
}

export const DraftSelectCheckbox: React.FC<DraftSelectCheckboxProps> = ({
  selected,
  testID,
}) => {
  const reducedMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const enter = useRef(new Animated.Value(0)).current;
  const mounted = useRef(false);

  // Enter motion (DESIGN §9.1): opacity 0→1 + scale 0.6→1 on first mount.
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: reducedMotion ? durations.fast : durations.entry,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter, reducedMotion]);

  // Bounce on toggle (DESIGN §9.1 / §5.3). Skip the first render (mount).
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (reducedMotion) return;
    const peak = selected ? 1.18 : 0.85;
    Animated.sequence([
      Animated.spring(scale, {
        toValue: peak,
        damping: 12,
        stiffness: 320,
        mass: 0.7,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        damping: 12,
        stiffness: 320,
        mass: 0.7,
        useNativeDriver: true,
      }),
    ]).start();
  }, [selected, scale, reducedMotion]);

  const enterScale = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 1],
  });

  return (
    <Animated.View
      testID={testID ?? "draft-select-checkbox"}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.box,
        selected ? styles.boxChecked : styles.boxUnchecked,
        {
          opacity: enter,
          transform: [{ scale: Animated.multiply(scale, enterScale) }],
        },
      ]}
    >
      {selected ? <Icon name="check" size={14} color="#ffffff" /> : null}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  box: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  boxUnchecked: {
    backgroundColor: "rgba(12, 14, 18, 0.55)",
    borderColor: "rgba(255, 255, 255, 0.85)",
  },
  boxChecked: {
    backgroundColor: accent.warm,
    borderColor: accent.warm,
  },
});

export default DraftSelectCheckbox;
