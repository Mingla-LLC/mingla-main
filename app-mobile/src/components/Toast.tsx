import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { TrackedTouchableOpacity } from './TrackedTouchableOpacity';
import { Icon } from './ui/Icon';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withSpring, 
  withTiming,
  runOnJS,
  interpolate,
  Extrapolate
} from 'react-native-reanimated';
import { spacing, colors, typography, fontWeights, radius, shadows } from '../constants/designSystem';
import { useHapticFeedback } from '../utils/hapticFeedback';

interface ToastProps {
  id: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  position?: 'top' | 'bottom';
  onHide: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({
  id,
  message,
  type,
  position = 'top',
  onHide,
}) => {
  const haptic = useHapticFeedback();
  const translateY = useSharedValue(position === 'top' ? -100 : 100);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.8);
  const progress = useSharedValue(0);

  useEffect(() => {
    // Haptic feedback based on type
    switch (type) {
      case 'success':
        haptic.success();
        break;
      case 'error':
        haptic.error();
        break;
      case 'warning':
        haptic.warning();
        break;
      case 'info':
        haptic.light();
        break;
    }

    // Animate in
    translateY.value = withSpring(0, {
      damping: 15,
      stiffness: 150,
    });
    opacity.value = withTiming(1, { duration: 300 });
    scale.value = withSpring(1, {
      damping: 12,
      stiffness: 200,
    });

    // Progress animation for auto-hide
    progress.value = withTiming(1, { duration: 3000 });

    // Auto-hide after 3 seconds
    const timer = setTimeout(() => {
      hideToast();
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  const hideToast = () => {
    translateY.value = withTiming(
      position === 'top' ? -100 : 100,
      { duration: 250 },
      () => {
        runOnJS(onHide)(id);
      }
    );
    opacity.value = withTiming(0, { duration: 250 });
    scale.value = withTiming(0.8, { duration: 250 });
  };

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateY: translateY.value },
        { scale: scale.value },
      ],
      opacity: opacity.value,
    };
  });

  const progressStyle = useAnimatedStyle(() => {
    const width = interpolate(
      progress.value,
      [0, 1],
      ['100%', '0%'],
      Extrapolate.CLAMP
    );

    return {
      width,
    };
  });

  const getToastConfig = () => {
    switch (type) {
      case 'success':
        return {
          backgroundColor: colors.success[500],
          icon: 'checkmark-circle' as const,
          iconColor: colors.text.inverse,
        };
      case 'error':
        return {
          backgroundColor: colors.error[500],
          icon: 'alert-circle' as const,
          iconColor: colors.text.inverse,
        };
      case 'warning':
        return {
          backgroundColor: colors.warning[500],
          icon: 'warning' as const,
          iconColor: colors.text.inverse,
        };
      case 'info':
        return {
          backgroundColor: colors.primary[500],
          icon: 'information-circle' as const,
          iconColor: colors.text.inverse,
        };
      default:
        return {
          backgroundColor: colors.gray[500],
          icon: 'information-circle' as const,
          iconColor: colors.text.inverse,
        };
    }
  };

  const config = getToastConfig();

  return (
    <Animated.View
      style={[
        styles.container,
        position === 'top' ? styles.topContainer : styles.bottomContainer,
        animatedStyle,
      ]}
    >
      <TrackedTouchableOpacity logComponent="Toast"
        style={[styles.toast, { backgroundColor: config.backgroundColor }]}
        onPress={hideToast}
        activeOpacity={0.8}
      >
        <View style={styles.content}>
          <Icon
            name={config.icon}
            size={20}
            color={config.iconColor}
            style={styles.icon}
          />
          <Text style={styles.message} numberOfLines={2}>
            {message}
          </Text>
        </View>
        
        {/* Progress bar */}
        <View style={styles.progressContainer}>
          <Animated.View
            style={[
              styles.progressBar,
              { backgroundColor: config.iconColor },
              progressStyle,
            ]}
          />
        </View>
      </TrackedTouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 1000,
  },
  topContainer: {
    top: 60, // Account for status bar
  },
  bottomContainer: {
    bottom: 100, // Account for tab bar
  },
  toast: {
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.lg,
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  icon: {
    marginRight: spacing.sm,
  },
  message: {
    ...typography.md,
    fontWeight: fontWeights.medium,
    color: colors.text.inverse,
    flex: 1,
  },
  progressContainer: {
    height: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 1,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 1,
  },
});
