import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Icon } from '../ui/Icon';
import { colors } from '../../constants/designSystem';

const TRIGGER_THRESHOLD = 60;
const MAX_TRANSLATE = 80;

interface SwipeableMessageProps {
  children: React.ReactNode;
  onReply: () => void;
  enabled?: boolean;
}

/**
 * Wraps a message bubble with a swipe-right-to-reply gesture.
 * Shows a reply icon that scales in as the user swipes.
 * Uses Reanimated worklets for native-thread performance.
 */
export function SwipeableMessage({
  children,
  onReply,
  enabled = true,
}: SwipeableMessageProps): React.ReactElement {
  const translateX = useSharedValue(0);
  const triggered = useSharedValue(false);

  const triggerReply = (): void => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onReply();
  };

  const triggerHaptic = (): void => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX([-1000, 10]) // Only activate on rightward swipe (positive X)
    .failOffsetY([-15, 15]) // Cancel if vertical movement exceeds 15px
    .onUpdate((e) => {
      // Only allow rightward swipe (positive translateX)
      const clamped = Math.min(Math.max(e.translationX, 0), MAX_TRANSLATE);
      translateX.value = clamped;

      // Haptic at threshold
      if (clamped >= TRIGGER_THRESHOLD && !triggered.value) {
        triggered.value = true;
        runOnJS(triggerHaptic)();
      } else if (clamped < TRIGGER_THRESHOLD) {
        triggered.value = false;
      }
    })
    .onEnd(() => {
      if (translateX.value >= TRIGGER_THRESHOLD) {
        runOnJS(triggerReply)();
      }
      translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
      triggered.value = false;
    });

  const messageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const iconStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      translateX.value,
      [0, 40],
      [0, 1],
      Extrapolation.CLAMP
    );
    const scale = interpolate(
      translateX.value,
      [0, TRIGGER_THRESHOLD, MAX_TRANSLATE],
      [0.5, 1, 1.15],
      Extrapolation.CLAMP
    );
    return { opacity, transform: [{ scale }] };
  });

  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <View style={styles.container}>
      {/* Reply icon — visible behind the message as it slides */}
      <Animated.View style={[styles.iconContainer, iconStyle]}>
        <View style={styles.iconCircle}>
          <Icon name="arrow-undo-outline" size={18} color={colors.gray[600]} />
        </View>
      </Animated.View>

      {/* Message content — slides right */}
      <GestureDetector gesture={pan}>
        <Animated.View style={messageStyle}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  iconContainer: {
    position: 'absolute',
    left: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    zIndex: -1,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
});
