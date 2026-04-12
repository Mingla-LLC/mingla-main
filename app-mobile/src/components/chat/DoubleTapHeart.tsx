import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
  withTiming,
  withSequence,
  runOnJS,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Icon } from '../ui/Icon';

interface DoubleTapHeartProps {
  children: React.ReactNode;
  onDoubleTap: () => void;
  enabled?: boolean;
}

/**
 * Wraps a message bubble with double-tap-to-heart detection.
 * Shows an animated orange heart pop on double-tap.
 */
export function DoubleTapHeart({
  children,
  onDoubleTap,
  enabled = true,
}: DoubleTapHeartProps): React.ReactElement {
  const heartScale = useSharedValue(0);
  const heartOpacity = useSharedValue(0);

  const triggerHeart = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onDoubleTap();
  }, [onDoubleTap]);

  const doubleTap = Gesture.Tap()
    .enabled(enabled)
    .numberOfTaps(2)
    .maxDuration(300)
    .onEnd(() => {
      // Animate heart pop
      heartOpacity.value = 1;
      heartScale.value = withSpring(1.2, { damping: 12, stiffness: 180 });

      // Hold then fade
      heartOpacity.value = withDelay(
        400,
        withTiming(0, { duration: 300 })
      );
      heartScale.value = withDelay(
        400,
        withTiming(1.4, { duration: 300 })
      );

      // Reset after animation
      heartScale.value = withDelay(700, withTiming(0, { duration: 0 }));

      runOnJS(triggerHeart)();
    });

  const heartStyle = useAnimatedStyle(() => ({
    opacity: heartOpacity.value,
    transform: [{ scale: heartScale.value }],
  }));

  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <GestureDetector gesture={doubleTap}>
      <Animated.View>
        {children}
        {/* Heart overlay */}
        <Animated.View style={[styles.heartOverlay, heartStyle]} pointerEvents="none">
          <Icon name="heart" size={44} color="#eb7825" strokeWidth={0} />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  heartOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
});
