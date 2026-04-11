import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, typography, fontWeights, radius } from '../../constants/designSystem';

interface TypingIndicatorProps {
  isVisible: boolean;
  label?: string; // e.g., "typing" or "Alex is typing"
}

export function TypingIndicator({ isVisible, label }: TypingIndicatorProps) {
  const { t } = useTranslation(['chat', 'common']);
  const resolvedLabel = label ?? t('chat:typing');
  const opacity = useRef(new Animated.Value(0)).current;
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (isVisible) {
      // Fade in
      Animated.timing(opacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }).start();

      // Start dot bounce animation
      const createBounce = (dot: Animated.Value) =>
        Animated.sequence([
          Animated.timing(dot, {
            toValue: -3,
            duration: 200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: 200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]);

      const animation = Animated.loop(
        Animated.stagger(133, [
          createBounce(dot1),
          createBounce(dot2),
          createBounce(dot3),
        ])
      );
      animationRef.current = animation;
      animation.start();
    } else {
      // Fade out
      Animated.timing(opacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start();

      // Stop animation
      if (animationRef.current) {
        animationRef.current.stop();
        animationRef.current = null;
      }
      dot1.setValue(0);
      dot2.setValue(0);
      dot3.setValue(0);
    }

    return () => {
      if (animationRef.current) {
        animationRef.current.stop();
      }
    };
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <Animated.View style={[styles.container, { opacity }]} accessibilityLabel={resolvedLabel}>
      <Text style={styles.text}>{resolvedLabel}</Text>
      <View style={styles.dotsContainer}>
        <Animated.View style={[styles.dot, { transform: [{ translateY: dot1 }] }]} />
        <Animated.View style={[styles.dot, { transform: [{ translateY: dot2 }] }]} />
        <Animated.View style={[styles.dot, { transform: [{ translateY: dot3 }] }]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  text: {
    fontSize: typography.xs.fontSize,
    lineHeight: typography.xs.lineHeight,
    fontWeight: fontWeights.medium,
    color: colors.primary[500],
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingTop: 1,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: radius.full,
    backgroundColor: colors.primary[500],
  },
});
