import React, { useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { spacing, radius, shadows } from '../../constants/designSystem';
import { vs, ms } from '../../utils/responsive';

const AUTO_DISMISS_MS = 15_000;
const SWIPE_UP_THRESHOLD = -30;
const SLIDE_OUT_DURATION = 200;

interface OtaUpdateBannerProps {
  isVisible: boolean;
  onApply: () => void;
  onDismiss: () => void;
}

export const OtaUpdateBanner: React.FC<OtaUpdateBannerProps> = ({
  isVisible,
  onApply,
  onDismiss,
}) => {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(-120)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const autoDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAnimatingOut = useRef(false);

  const slideOut = useCallback((callback?: () => void): void => {
    if (isAnimatingOut.current) return;
    isAnimatingOut.current = true;

    if (autoDismissTimer.current) {
      clearTimeout(autoDismissTimer.current);
      autoDismissTimer.current = null;
    }

    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: -120,
        duration: SLIDE_OUT_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: SLIDE_OUT_DURATION,
        useNativeDriver: true,
      }),
    ]).start(() => {
      isAnimatingOut.current = false;
      callback?.();
    });
  }, [slideAnim, opacityAnim]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gestureState) =>
        Math.abs(gestureState.dy) > 10 && gestureState.dy < 0,
      onPanResponderRelease: (_evt, gestureState) => {
        if (gestureState.dy < SWIPE_UP_THRESHOLD) {
          slideOut(onDismiss);
        }
      },
    }),
  ).current;

  useEffect(() => {
    if (isVisible) {
      isAnimatingOut.current = false;

      // Slide in
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 50,
          friction: 7,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto-dismiss after 15s
      autoDismissTimer.current = setTimeout(() => {
        slideOut(onDismiss);
      }, AUTO_DISMISS_MS);

      return () => {
        if (autoDismissTimer.current) {
          clearTimeout(autoDismissTimer.current);
          autoDismissTimer.current = null;
        }
      };
    } else {
      slideOut();
    }
  }, [isVisible, slideAnim, opacityAnim, slideOut, onDismiss]);

  if (!isVisible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          top: insets.top,
          transform: [{ translateY: slideAnim }],
          opacity: opacityAnim,
        },
      ]}
      {...panResponder.panHandlers}
    >
      <TouchableOpacity
        style={styles.banner}
        onPress={onApply}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="App update available. Tap to refresh the app."
        accessibilityHint="Double tap to apply the update and restart the app"
      >
        <Ionicons name="cloud-download-outline" size={ms(18)} color="#ffffff" />
        <Text style={styles.text}>New update ready — tap to refresh</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: 9999,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    height: vs(44),
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primary,
    borderBottomLeftRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
    ...shadows.sm,
  },
  text: {
    color: '#ffffff',
    fontSize: ms(13),
    fontWeight: '600',
    marginLeft: spacing.sm,
    flex: 1,
  },
});
