import { useEffect, useRef } from 'react';
import { Animated, Easing, AccessibilityInfo, ViewStyle } from 'react-native';
import { useCoachMarkContext } from '../contexts/CoachMarkContext';

interface UseCoachMarkResult {
  /** true if this component is the current coach target */
  isActive: boolean;
  /** Animated style to spread on the target element when active */
  highlightStyle: Animated.WithAnimatedObject<ViewStyle> | null;
}

/**
 * Hook for target components to check if they should highlight.
 *
 * Usage:
 *   const { isActive, highlightStyle } = useCoachMark(2);
 *   return <View style={[styles.container, isActive && highlightStyle]} />;
 */
export function useCoachMark(stepId: number): UseCoachMarkResult {
  const { currentStep } = useCoachMarkContext();
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  const isActive = currentStep === stepId;

  useEffect(() => {
    if (!isActive) {
      // Reset and stop animation
      if (animRef.current) {
        animRef.current.stop();
        animRef.current = null;
      }
      pulseAnim.setValue(1);
      return;
    }

    // Check reduced motion
    AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (reduceMotion) {
        pulseAnim.setValue(1);
        return;
      }

      // Start pulse animation: opacity 0.4 → 1.0 → 0.4 over 2000ms
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.4,
            duration: 1000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      );

      animRef.current = animation;
      animation.start();
    });

    return () => {
      if (animRef.current) {
        animRef.current.stop();
        animRef.current = null;
      }
    };
  }, [isActive, pulseAnim]);

  if (!isActive) {
    return { isActive: false, highlightStyle: null };
  }

  // The highlight style uses opacity animation on the border/shadow
  // We apply a static border and animate a wrapper's opacity instead
  // But since useNativeDriver can only animate opacity/transform,
  // we use an Animated.View wrapper approach via the opacity value
  const highlightStyle: Animated.WithAnimatedObject<ViewStyle> = {
    borderWidth: 2,
    borderColor: 'rgba(235, 120, 37, 0.7)',
    shadowColor: '#eb7825',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: pulseAnim.interpolate({
      inputRange: [0.4, 1],
      outputRange: [0.1, 0.25],
    }) as unknown as number,
    shadowRadius: 8,
    elevation: 4,
  };

  return { isActive: true, highlightStyle };
}
