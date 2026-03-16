import React, { useRef, useCallback } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  withSpring,
  withTiming,
  interpolate,
  Extrapolate,
  runOnJS,
} from 'react-native-reanimated';
import { Icon } from './ui/Icon';
import { spacing, colors, typography, fontWeights } from '../constants/designSystem';
import { useHapticFeedback } from '../utils/hapticFeedback';


interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  refreshing: boolean;
  children: React.ReactNode;
  threshold?: number;
  refreshHeight?: number;
}

export const PullToRefresh: React.FC<PullToRefreshProps> = ({
  onRefresh,
  refreshing,
  children,
  threshold = 80,
  refreshHeight = 60,
}) => {
  const haptic = useHapticFeedback();
  const scrollY = useSharedValue(0);
  const isRefreshing = useSharedValue(false);
  const hasTriggeredHaptic = useRef(false);

  const triggerRefresh = useCallback(async () => {
    if (isRefreshing.value) return;

    isRefreshing.value = true;
    haptic.pullToRefresh();

    try {
      await onRefresh();
    } finally {
      isRefreshing.value = false;
    }
  }, [onRefresh, haptic]);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      const { contentOffset } = event;
      scrollY.value = contentOffset.y;
      
      // Trigger haptic when threshold is reached
      if (contentOffset.y < -threshold && !hasTriggeredHaptic.current) {
        hasTriggeredHaptic.current = true;
        runOnJS(haptic.light)();
      } else if (contentOffset.y > -threshold) {
        hasTriggeredHaptic.current = false;
      }
    },
    onEndDrag: (event) => {
      const { contentOffset } = event;
      if (contentOffset.y < -threshold && !isRefreshing.value) {
        runOnJS(triggerRefresh)();
      }
    },
  });

  const refreshIndicatorStyle = useAnimatedStyle(() => {
    const translateY = interpolate(
      scrollY.value,
      [-threshold, 0],
      [0, -refreshHeight],
      Extrapolate.CLAMP
    );

    const opacity = interpolate(
      scrollY.value,
      [-threshold, -threshold / 2, 0],
      [1, 0.5, 0],
      Extrapolate.CLAMP
    );

    const scale = interpolate(
      scrollY.value,
      [-threshold, -threshold / 2, 0],
      [1, 0.8, 0.6],
      Extrapolate.CLAMP
    );

    return {
      transform: [
        { translateY },
        { scale },
      ],
      opacity,
    };
  });

  const spinnerStyle = useAnimatedStyle(() => {
    const rotation = interpolate(
      scrollY.value,
      [-threshold, 0],
      [360, 0],
      Extrapolate.CLAMP
    );

    return {
      transform: [{ rotate: `${rotation}deg` }],
    };
  });

  const refreshingSpinnerStyle = useAnimatedStyle(() => {
    const rotation = isRefreshing.value
      ? withTiming(360, { duration: 1000 })
      : withTiming(0, { duration: 0 });

    return {
      transform: [{ rotate: `${rotation}deg` }],
    };
  });

  return (
    <View style={styles.container}>
      {/* Refresh Indicator */}
      <Animated.View style={[styles.refreshIndicator, refreshIndicatorStyle]}>
        <View style={styles.refreshContent}>
          {refreshing ? (
            <Animated.View style={refreshingSpinnerStyle}>
              <Icon
                name="refresh"
                size={24}
                color={colors.primary[500]}
              />
            </Animated.View>
          ) : (
            <Animated.View style={spinnerStyle}>
              <Icon
                name="arrow-down"
                size={24}
                color={colors.primary[500]}
              />
            </Animated.View>
          )}
          <Animated.Text style={styles.refreshText}>
            {refreshing ? 'Refreshing...' : 'Pull to refresh'}
          </Animated.Text>
        </View>
      </Animated.View>

      {/* Scrollable Content */}
      <Animated.ScrollView
        style={styles.scrollView}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        bounces={true}
        bouncesZoom={false}
      >
        {children}
      </Animated.ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  refreshIndicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    backgroundColor: colors.background.primary,
  },
  refreshContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  refreshText: {
    ...typography.sm,
    fontWeight: fontWeights.medium,
    color: colors.text.secondary,
    marginLeft: spacing.sm,
  },
});
