/**
 * Spinner — indeterminate loading affordance.
 *
 * Three sizes (24/36/48) animate a 3/4-arc circle 360° per second. With
 * reduce-motion enabled, rotation collapses to a 600ms opacity cycle.
 */

import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

import { accent } from "../../constants/designSystem";

export type SpinnerSize = 24 | 36 | 48;

export interface SpinnerProps {
  /** Diameter in pixels. Defaults to 24. */
  size?: SpinnerSize;
  /** Stroke colour. Defaults to `accent.warm`. */
  color?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const STROKE_WIDTH = 3;
const VIEW_BOX = 24;

export const Spinner: React.FC<SpinnerProps> = ({
  size = 24,
  color = accent.warm,
  testID,
  style,
}) => {
  const rotation = useSharedValue(0);
  const opacity = useSharedValue(1);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = withRepeat(
        withTiming(0.6, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else {
      rotation.value = withRepeat(
        withTiming(360, { duration: 1000, easing: Easing.linear }),
        -1,
        false,
      );
    }
    return (): void => {
      cancelAnimation(rotation);
      cancelAnimation(opacity);
    };
  }, [opacity, reduceMotion, rotation]);

  const animatedStyle = useAnimatedStyle(() => {
    if (reduceMotion) {
      return { opacity: opacity.value };
    }
    return {
      transform: [{ rotate: `${rotation.value}deg` }],
    };
  });

  const radius = (VIEW_BOX - STROKE_WIDTH) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * 0.75;
  const gap = circumference - dash;

  return (
    <View style={[{ width: size, height: size }, style]} testID={testID}>
      <Animated.View style={[styles.fill, animatedStyle]}>
        <Svg width={size} height={size} viewBox={`0 0 ${VIEW_BOX} ${VIEW_BOX}`} fill="none">
          <Circle
            cx={VIEW_BOX / 2}
            cy={VIEW_BOX / 2}
            r={radius}
            stroke={color}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${gap}`}
          />
        </Svg>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  fill: {
    width: "100%",
    height: "100%",
  },
});

export default Spinner;
