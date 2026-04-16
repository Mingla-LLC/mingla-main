/**
 * ORCH-0437: Loading skeleton cards for the leaderboard.
 * 3 pulsing glass cards that match the LeaderboardCard dimensions.
 */

import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useReducedMotion,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { glass } from '../../constants/designSystem';

function SkeletonCard(): React.ReactElement {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(reducedMotion ? 0.5 : 0.3);

  useEffect(() => {
    if (reducedMotion) return;
    opacity.value = withRepeat(
      withTiming(0.7, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [reducedMotion, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[styles.card, animatedStyle]}>
      <View style={styles.avatar} />
      <View style={styles.textArea}>
        <View style={styles.lineLarge} />
        <View style={styles.lineMedium} />
        <View style={styles.lineSmall} />
      </View>
    </Animated.View>
  );
}

export function LeaderboardSkeleton(): React.ReactElement {
  return (
    <View style={styles.container}>
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    gap: 10,
  },
  card: {
    height: 88,
    ...glass.leaderboard.card,
    ...glass.shadowLight,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e5e7eb',
  },
  textArea: {
    flex: 1,
    gap: 6,
  },
  lineLarge: {
    width: 120,
    height: 14,
    borderRadius: 6,
    backgroundColor: '#e5e7eb',
  },
  lineMedium: {
    width: 160,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#e5e7eb',
  },
  lineSmall: {
    width: 100,
    height: 10,
    borderRadius: 6,
    backgroundColor: '#e5e7eb',
  },
});
