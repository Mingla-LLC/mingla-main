/**
 * Skeleton — loading placeholder.
 *
 * Animates a translucent gradient sweep across a base shape over 1400ms.
 * Reduce-motion fallback renders a static base with no sweep.
 */

import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { LayoutChangeEvent, StyleProp, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { radius as radiusTokens } from "../../constants/designSystem";

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

const SHIMMER_WIDTH_RATIO = 0.6;
const BASE_BACKGROUND = "rgba(255, 255, 255, 0.06)";
const SWEEP_COLORS: readonly [string, string, string, string] = [
  "rgba(255,255,255,0)",
  "rgba(255,255,255,0.04)",
  "rgba(255,255,255,0.08)",
  "rgba(255,255,255,0)",
];

export type SkeletonRadius = keyof typeof radiusTokens;

export interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number | `${number}%`;
  /** Token key into `radius`. Defaults to `md`. */
  radius?: SkeletonRadius;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = "100%",
  height = 16,
  radius = "md",
  testID,
  style,
}) => {
  const [containerWidth, setContainerWidth] = useState(0);
  const translateX = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion || containerWidth === 0) {
      cancelAnimation(translateX);
      return;
    }
    translateX.value = -containerWidth;
    translateX.value = withRepeat(
      withTiming(containerWidth, {
        duration: 1400,
        easing: Easing.out(Easing.ease),
      }),
      -1,
      false,
    );
    return (): void => {
      cancelAnimation(translateX);
    };
  }, [containerWidth, reduceMotion, translateX]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const onLayout = (event: LayoutChangeEvent): void => {
    setContainerWidth(event.nativeEvent.layout.width);
  };

  const borderRadius = radiusTokens[radius];
  const shimmerWidth = Math.max(containerWidth * SHIMMER_WIDTH_RATIO, 32);

  return (
    <View
      onLayout={onLayout}
      testID={testID}
      style={[
        styles.base,
        { width, height, borderRadius },
        style,
      ]}
    >
      {!reduceMotion && containerWidth > 0 ? (
        <AnimatedLinearGradient
          colors={SWEEP_COLORS}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[
            styles.sweep,
            { width: shimmerWidth, height: "100%" },
            animatedStyle,
          ]}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    backgroundColor: BASE_BACKGROUND,
    overflow: "hidden",
  },
  sweep: {
    position: "absolute",
    top: 0,
  },
});

export default Skeleton;
