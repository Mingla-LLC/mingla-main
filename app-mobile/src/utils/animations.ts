import { Animated, Easing } from 'react-native';
import { animations } from '../constants/designSystem';

// Animation utility functions for consistent, smooth animations
export class AnimationUtils {
  // Spring animation with consistent physics
  static spring(
    value: Animated.Value,
    toValue: number,
    config: {
      tension?: number;
      friction?: number;
      useNativeDriver?: boolean;
    } = {}
  ) {
    return Animated.spring(value, {
      toValue,
      tension: config.tension || 100,
      friction: config.friction || 8,
      useNativeDriver: config.useNativeDriver !== false,
      ...config,
    });
  }

  // Timing animation with consistent easing
  static timing(
    value: Animated.Value,
    toValue: number,
    config: {
      duration?: number;
      easing?: (value: number) => number;
      useNativeDriver?: boolean;
    } = {}
  ) {
    return Animated.timing(value, {
      toValue,
      duration: config.duration || animations.duration.normal,
      easing: config.easing || Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: config.useNativeDriver !== false,
      ...config,
    });
  }

  // Button press animation (scale down and back up)
  static buttonPress(
    scaleValue: Animated.Value,
    config: {
      pressScale?: number;
      duration?: number;
    } = {}
  ) {
    const pressScale = config.pressScale || 0.95;
    const duration = config.duration || animations.duration.fast;

    return Animated.sequence([
      Animated.timing(scaleValue, {
        toValue: pressScale,
        duration: duration / 2,
        useNativeDriver: true,
      }),
      Animated.timing(scaleValue, {
        toValue: 1,
        duration: duration / 2,
        useNativeDriver: true,
      }),
    ]);
  }

  // Fade in animation
  static fadeIn(
    opacityValue: Animated.Value,
    config: {
      duration?: number;
      delay?: number;
    } = {}
  ) {
    return Animated.timing(opacityValue, {
      toValue: 1,
      duration: config.duration || animations.duration.normal,
      delay: config.delay || 0,
      useNativeDriver: true,
    });
  }

  // Fade out animation
  static fadeOut(
    opacityValue: Animated.Value,
    config: {
      duration?: number;
      delay?: number;
    } = {}
  ) {
    return Animated.timing(opacityValue, {
      toValue: 0,
      duration: config.duration || animations.duration.normal,
      delay: config.delay || 0,
      useNativeDriver: true,
    });
  }

  // Slide in from bottom animation
  static slideInFromBottom(
    translateYValue: Animated.Value,
    config: {
      duration?: number;
      delay?: number;
    } = {}
  ) {
    return Animated.timing(translateYValue, {
      toValue: 0,
      duration: config.duration || animations.duration.normal,
      delay: config.delay || 0,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
  }

  // Slide out to bottom animation
  static slideOutToBottom(
    translateYValue: Animated.Value,
    config: {
      duration?: number;
      delay?: number;
    } = {}
  ) {
    return Animated.timing(translateYValue, {
      toValue: 300,
      duration: config.duration || animations.duration.normal,
      delay: config.delay || 0,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    });
  }

  // Bounce animation for success feedback
  static bounce(
    scaleValue: Animated.Value,
    config: {
      bounceScale?: number;
      duration?: number;
    } = {}
  ) {
    const bounceScale = config.bounceScale || 1.2;
    const duration = config.duration || animations.duration.normal;

    return Animated.sequence([
      Animated.timing(scaleValue, {
        toValue: bounceScale,
        duration: duration * 0.3,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(scaleValue, {
        toValue: 1,
        duration: duration * 0.7,
        easing: Easing.elastic(1),
        useNativeDriver: true,
      }),
    ]);
  }

  // Shake animation for error feedback
  static shake(
    translateXValue: Animated.Value,
    config: {
      shakeDistance?: number;
      duration?: number;
    } = {}
  ) {
    const shakeDistance = config.shakeDistance || 10;
    const duration = config.duration || animations.duration.normal;

    return Animated.sequence([
      Animated.timing(translateXValue, {
        toValue: shakeDistance,
        duration: duration * 0.1,
        useNativeDriver: true,
      }),
      Animated.timing(translateXValue, {
        toValue: -shakeDistance,
        duration: duration * 0.1,
        useNativeDriver: true,
      }),
      Animated.timing(translateXValue, {
        toValue: shakeDistance,
        duration: duration * 0.1,
        useNativeDriver: true,
      }),
      Animated.timing(translateXValue, {
        toValue: -shakeDistance,
        duration: duration * 0.1,
        useNativeDriver: true,
      }),
      Animated.timing(translateXValue, {
        toValue: 0,
        duration: duration * 0.1,
        useNativeDriver: true,
      }),
    ]);
  }

  // Pulse animation for loading states
  static pulse(
    scaleValue: Animated.Value,
    config: {
      minScale?: number;
      maxScale?: number;
      duration?: number;
    } = {}
  ) {
    const minScale = config.minScale || 0.8;
    const maxScale = config.maxScale || 1.2;
    const duration = config.duration || 1000;

    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(scaleValue, {
          toValue: maxScale,
          duration: duration / 2,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scaleValue, {
          toValue: minScale,
          duration: duration / 2,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    return pulseAnimation;
  }

  // Stagger animation for multiple elements
  static stagger(
    animations: Animated.CompositeAnimation[],
    config: {
      delay?: number;
    } = {}
  ) {
    const delay = config.delay || 100;
    
    return Animated.stagger(
      delay,
      animations
    );
  }

  // Parallel animation for simultaneous effects
  static parallel(animations: Animated.CompositeAnimation[]) {
    return Animated.parallel(animations);
  }

  // Sequence animation for sequential effects
  static sequence(animations: Animated.CompositeAnimation[]) {
    return Animated.sequence(animations);
  }
}

// Pre-configured animation presets for common use cases
export const AnimationPresets = {
  // Button press with haptic feedback
  buttonPress: (scaleValue: Animated.Value) => 
    AnimationUtils.buttonPress(scaleValue, { pressScale: 0.95, duration: 150 }),

  // Success feedback with bounce
  success: (scaleValue: Animated.Value) => 
    AnimationUtils.bounce(scaleValue, { bounceScale: 1.1, duration: 400 }),

  // Error feedback with shake
  error: (translateXValue: Animated.Value) => 
    AnimationUtils.shake(translateXValue, { shakeDistance: 8, duration: 300 }),

  // Loading pulse
  loading: (scaleValue: Animated.Value) => 
    AnimationUtils.pulse(scaleValue, { minScale: 0.9, maxScale: 1.1, duration: 800 }),

  // Modal slide in
  modalSlideIn: (translateYValue: Animated.Value) => 
    AnimationUtils.slideInFromBottom(translateYValue, { duration: 300 }),

  // Modal slide out
  modalSlideOut: (translateYValue: Animated.Value) => 
    AnimationUtils.slideOutToBottom(translateYValue, { duration: 250 }),

  // Fade in with delay
  fadeInDelayed: (opacityValue: Animated.Value, delay: number = 200) => 
    AnimationUtils.fadeIn(opacityValue, { duration: 300, delay }),
};
