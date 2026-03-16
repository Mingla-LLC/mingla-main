import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Text } from 'react-native';
import { Icon } from './ui/Icon';
import { spacing, radius, colors, typography, fontWeights, animations } from '../constants/designSystem';

interface SuccessAnimationProps {
  message?: string;
  icon?: string;
  onComplete?: () => void;
  duration?: number;
}

export const SuccessAnimation: React.FC<SuccessAnimationProps> = ({
  message = 'Success!',
  icon = 'checkmark-circle',
  onComplete,
  duration = 2000,
}) => {
  const scaleAnimation = useRef(new Animated.Value(0)).current;
  const opacityAnimation = useRef(new Animated.Value(0)).current;
  const messageOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = () => {
      // Start with icon animation
      Animated.parallel([
        Animated.spring(scaleAnimation, {
          toValue: 1,
          tension: 100,
          friction: 8,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnimation, {
          toValue: 1,
          duration: animations.duration.fast,
          useNativeDriver: true,
        }),
      ]).start();

      // Show message after icon appears
      setTimeout(() => {
        Animated.timing(messageOpacity, {
          toValue: 1,
          duration: animations.duration.fast,
          useNativeDriver: true,
        }).start();
      }, 300);

      // Auto-hide after duration
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(opacityAnimation, {
            toValue: 0,
            duration: animations.duration.fast,
            useNativeDriver: true,
          }),
          Animated.timing(messageOpacity, {
            toValue: 0,
            duration: animations.duration.fast,
            useNativeDriver: true,
          }),
        ]).start(() => {
          onComplete?.();
        });
      }, duration);
    };

    animate();
  }, [scaleAnimation, opacityAnimation, messageOpacity, duration, onComplete]);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.animationContainer,
          {
            opacity: opacityAnimation,
            transform: [{ scale: scaleAnimation }],
          },
        ]}
      >
        <View style={styles.iconContainer}>
          <Icon
            name={icon}
            size={64}
            color={colors.success[500]}
          />
        </View>
        
        <Animated.View
          style={[
            styles.messageContainer,
            { opacity: messageOpacity },
          ]}
        >
          <Text style={styles.message}>{message}</Text>
        </Animated.View>
      </Animated.View>
    </View>
  );
};

// Specific success animations for common actions
export const LikeSuccessAnimation: React.FC<{ onComplete?: () => void }> = ({ onComplete }) => (
  <SuccessAnimation
    message="Added to favorites!"
    icon="heart"
    onComplete={onComplete}
    duration={1500}
  />
);

export const SaveSuccessAnimation: React.FC<{ onComplete?: () => void }> = ({ onComplete }) => (
  <SuccessAnimation
    message="Preferences saved!"
    icon="checkmark-circle"
    onComplete={onComplete}
    duration={1500}
  />
);

export const ShareSuccessAnimation: React.FC<{ onComplete?: () => void }> = ({ onComplete }) => (
  <SuccessAnimation
    message="Shared successfully!"
    icon="share"
    onComplete={onComplete}
    duration={1500}
  />
);

// Toast notification component
interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
  onComplete?: () => void;
}

export const Toast: React.FC<ToastProps> = ({
  message,
  type = 'success',
  duration = 3000,
  onComplete,
}) => {
  const slideAnimation = useRef(new Animated.Value(-100)).current;
  const opacityAnimation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const showToast = () => {
      Animated.parallel([
        Animated.timing(slideAnimation, {
          toValue: 0,
          duration: animations.duration.normal,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnimation, {
          toValue: 1,
          duration: animations.duration.normal,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto-hide
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(slideAnimation, {
            toValue: -100,
            duration: animations.duration.normal,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnimation, {
            toValue: 0,
            duration: animations.duration.normal,
            useNativeDriver: true,
          }),
        ]).start(() => {
          onComplete?.();
        });
      }, duration);
    };

    showToast();
  }, [slideAnimation, opacityAnimation, duration, onComplete]);

  const getToastStyle = () => {
    switch (type) {
      case 'success':
        return { backgroundColor: colors.success[500] };
      case 'error':
        return { backgroundColor: colors.error[500] };
      case 'warning':
        return { backgroundColor: colors.warning[500] };
      case 'info':
        return { backgroundColor: colors.primary[500] };
      default:
        return { backgroundColor: colors.success[500] };
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'success':
        return 'checkmark-circle';
      case 'error':
        return 'alert-circle';
      case 'warning':
        return 'warning';
      case 'info':
        return 'information-circle';
      default:
        return 'checkmark-circle';
    }
  };

  return (
    <Animated.View
      style={[
        styles.toast,
        getToastStyle(),
        {
          opacity: opacityAnimation,
          transform: [{ translateY: slideAnimation }],
        },
      ]}
    >
      <Icon
        name={getIcon()}
        size={20}
        color={colors.text.inverse}
        style={styles.toastIcon}
      />
      <Text style={styles.toastMessage}>{message}</Text>
    </Animated.View>
  );
};

// Loading spinner component
interface LoadingSpinnerProps {
  size?: number;
  color?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 24,
  color = colors.primary[500],
}) => {
  const rotationAnimation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const rotate = () => {
      Animated.loop(
        Animated.timing(rotationAnimation, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        })
      ).start();
    };

    rotate();
  }, [rotationAnimation]);

  const rotateInterpolate = rotationAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View
      style={[
        styles.spinner,
        {
          width: size,
          height: size,
          borderColor: color,
          borderTopColor: 'transparent',
          transform: [{ rotate: rotateInterpolate }],
        },
      ]}
    />
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 1000,
  },
  animationContainer: {
    alignItems: 'center',
    backgroundColor: colors.background.primary,
    padding: spacing.xl,
    borderRadius: radius.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  iconContainer: {
    marginBottom: spacing.md,
  },
  messageContainer: {
    alignItems: 'center',
  },
  message: {
    ...typography.lg,
    fontWeight: fontWeights.medium,
    color: colors.text.primary,
    textAlign: 'center',
  },
  toast: {
    position: 'absolute',
    top: 60,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
    zIndex: 1000,
  },
  toastIcon: {
    marginRight: spacing.sm,
  },
  toastMessage: {
    ...typography.md,
    fontWeight: fontWeights.medium,
    color: colors.text.inverse,
    flex: 1,
  },
  spinner: {
    borderWidth: 2,
    borderRadius: 50,
  },
});
