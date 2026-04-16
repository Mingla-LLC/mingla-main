/**
 * ORCH-0437: SVG circular progress ring around avatars.
 * Shows cumulative swipe activity as a fill level.
 */

import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  withRepeat,
  withSequence,
  useReducedMotion,
  Easing,
} from 'react-native-reanimated';
import { colors } from '../../constants/designSystem';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface ActivityRingProps {
  size: number;          // 44 for cards, 48 for header
  strokeWidth?: number;  // default 2
  swipeCount: number;    // cumulative swipes → fill %
  isActive?: boolean;    // currently swiping → heartbeat pulse
  children?: React.ReactNode; // avatar rendered inside
}

function swipeCountToFill(count: number): number {
  if (count <= 0) return 0;
  if (count <= 5) return 0.2;
  if (count <= 15) return 0.4;
  if (count <= 30) return 0.6;
  if (count <= 50) return 0.8;
  return 1.0;
}

export function ActivityRing({
  size,
  strokeWidth = 2,
  swipeCount,
  isActive = false,
  children,
}: ActivityRingProps): React.ReactElement {
  const reducedMotion = useReducedMotion();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const fillTarget = swipeCountToFill(swipeCount);

  const fillProgress = useSharedValue(0);
  const pulseOpacity = useSharedValue(1);

  useEffect(() => {
    fillProgress.value = withTiming(fillTarget, { duration: reducedMotion ? 0 : 400, easing: Easing.out(Easing.ease) });
  }, [fillTarget, reducedMotion, fillProgress]);

  useEffect(() => {
    if (isActive && !reducedMotion) {
      pulseOpacity.value = withRepeat(
        withSequence(
          withTiming(0.6, { duration: 750, easing: Easing.inOut(Easing.sin) }),
          withTiming(1, { duration: 750, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
      );
    } else {
      pulseOpacity.value = withTiming(1, { duration: 200 });
    }
  }, [isActive, reducedMotion, pulseOpacity]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - fillProgress.value),
    opacity: pulseOpacity.value,
  }));

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size} style={styles.svg}>
        {/* Background track */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.gray[200]}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Animated fill */}
        {fillTarget > 0 && (
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={colors.accent}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${circumference}`}
            animatedProps={animatedProps}
            strokeLinecap="round"
            rotation={-90}
            origin={`${size / 2}, ${size / 2}`}
          />
        )}
      </Svg>
      <View style={styles.childContainer}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  svg: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  childContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
